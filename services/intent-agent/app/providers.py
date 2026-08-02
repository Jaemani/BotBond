from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from typing import Any

from pydantic import ValidationError

from .models import CompileRequest, PolicyProposal, RiskTier

SYSTEM_PROMPT = """You are BotBond's least-privilege intent compiler.
Return only JSON matching the supplied schema. Select only operationId values and fields
that exist in the merchant catalog. Never invent an endpoint, field, operation, price,
or monetary fact. Include only capabilities needed by the task. Treat forbidden paths as
unavailable. Respect all catalog and user maxima. Bonded actions may reference only
selected BONDED operations. You propose policy scope; you never activate a session or
move, settle, or slash money.
"""


class ProposalProviderError(RuntimeError):
    """The configured proposal provider could not return structured output."""


class ProposalProvider(ABC):
    mode: str

    @abstractmethod
    async def propose(
        self,
        request: CompileRequest,
        *,
        repair_feedback: str | None = None,
    ) -> dict[str, Any]:
        """Return an untrusted policy proposal mapping."""


class FakeProposalProvider(ProposalProvider):
    """Deterministic local/CI compiler; it is intentionally and visibly fake."""

    mode = "FAKE"

    async def propose(
        self,
        request: CompileRequest,
        *,
        repair_feedback: str | None = None,
    ) -> dict[str, Any]:
        del repair_feedback
        task = request.task.casefold()
        reserve_requested = any(
            word in task
            for word in (
                "reserve",
                "reservation",
                "hold",
                "예약",
            )
        )
        stock_requested = any(
            word in task for word in ("stock", "inventory", "재고")
        )
        price_requested = any(
            word in task for word in ("price", "가격", "cost", "compare", "비교")
        )
        shipping_requested = any(word in task for word in ("shipping", "배송"))

        selected: list[dict[str, Any]] = []
        bonded: list[dict[str, Any]] = []
        explanations: list[str] = []

        for operation in request.catalog.operations:
            op_id = operation.id.casefold()
            should_select = False
            desired_fields: list[str] = []
            if operation.riskTier is RiskTier.BONDED:
                should_select = reserve_requested and "reserv" in op_id
                response_fields = {"reservationId", "productId", "quantity", "expiresAt", "state"}
                desired_fields = [field for field in operation.fields if field in response_fields]
            elif any(term in op_id for term in ("release", "consume", "expire")):
                should_select = reserve_requested
                desired_fields = [
                    field for field in operation.fields if field in {"reservationId", "state"}
                ]
            elif "inventory" in op_id:
                should_select = stock_requested
                desired_fields = [
                    field for field in operation.fields if field in {"stock", "updatedAt"}
                ]
            elif "search" in op_id or "product" in op_id:
                should_select = price_requested or stock_requested
                wanted = {"id", "name"}
                if price_requested:
                    wanted.add("price")
                if stock_requested:
                    wanted.add("stock")
                if shipping_requested:
                    wanted.add("shipping")
                desired_fields = [field for field in operation.fields if field in wanted]

            if not should_select:
                continue
            if not desired_fields:
                desired_fields = operation.fields[:1]
            selected.append(
                {
                    "operationId": operation.id,
                    "allowedResponseFields": desired_fields,
                    "maxCalls": operation.maxCalls,
                }
            )
            if operation.riskTier is RiskTier.BONDED:
                bonded.append(
                    {
                        "operationId": operation.id,
                        "maxActive": 1,
                        "ttlSeconds": min(
                            request.budget.maxSessionTtlSeconds or 60,
                            request.catalog.maxSessionTtlSeconds or 60,
                            60,
                        ),
                        "expiryPenaltyAtomic": request.catalog.defaultExpiryPenaltyAtomic,
                    }
                )

        if not selected:
            raise ProposalProviderError(
                "FAKE compiler found no permitted catalog capability required by the task"
            )

        explanations.append("FAKE compiler selected only catalog capabilities required by the task")
        if any(path.casefold() in task for path in request.catalog.forbiddenPaths):
            explanations.append("Forbidden catalog paths were excluded")

        max_calls = sum(operation["maxCalls"] for operation in selected)
        bond_cap = int(request.budget.bondCapAtomic)
        has_bonded_action = bool(bonded)
        max_bond = int(request.catalog.maxBondAmountAtomic or bond_cap)
        bond_amount = min(bond_cap, max_bond) if has_bonded_action else 0
        max_penalty = min(
            bond_amount,
            int(request.catalog.maxPenaltyAtomic or bond_amount),
        )
        for action in bonded:
            action["expiryPenaltyAtomic"] = str(
                min(int(action["expiryPenaltyAtomic"]), max_penalty)
            )

        return {
            "purpose": request.task,
            "operations": selected,
            "maxTotalCalls": max_calls,
            "maxRequestsPerMinute": max_calls,
            "sessionTtlSeconds": request.budget.maxSessionTtlSeconds or 300,
            "usageCapAtomic": request.budget.usageCapAtomic,
            "bondAmountAtomic": str(bond_amount),
            "maxPenaltyAtomic": str(max_penalty),
            "bondedActions": bonded,
            "explanation": explanations,
        }


class VertexGeminiProvider(ProposalProvider):
    """Gemini structured-output boundary backed by Vertex AI.

    The optional google-cloud-aiplatform dependency is imported only when a call is made,
    so local fake mode and unit tests need no Google SDK or credentials.
    """

    mode = "VERTEX_AI"

    def __init__(
        self,
        *,
        project: str,
        location: str,
        model_name: str = "gemini-2.0-flash",
        temperature: float = 0.1,
    ) -> None:
        if not 0 <= temperature <= 0.2:
            raise ValueError("intent compiler temperature must be between 0 and 0.2")
        self.project = project
        self.location = location
        self.model_name = model_name
        self.temperature = temperature

    async def propose(
        self,
        request: CompileRequest,
        *,
        repair_feedback: str | None = None,
    ) -> dict[str, Any]:
        try:
            import vertexai
            from vertexai.generative_models import GenerationConfig, GenerativeModel
        except ImportError as exc:
            raise ProposalProviderError(
                "Vertex mode requires the optional 'vertex' dependency"
            ) from exc

        vertexai.init(project=self.project, location=self.location)
        model = GenerativeModel(self.model_name, system_instruction=SYSTEM_PROMPT)
        payload = {
            "task": request.task,
            "agentWallet": request.agentWallet,
            "budget": request.budget.model_dump(mode="json"),
            "catalog": request.catalog.model_dump(mode="json"),
        }
        prompt = "Compile this request:\n" + json.dumps(
            payload, ensure_ascii=False, separators=(",", ":")
        )
        if repair_feedback:
            prompt += (
                "\nPrevious output was rejected. Correct it without adding capabilities. "
                f"Validation feedback: {repair_feedback}"
            )
        try:
            response = await model.generate_content_async(
                prompt,
                generation_config=GenerationConfig(
                    temperature=self.temperature,
                    response_mime_type="application/json",
                    response_schema=PolicyProposal.model_json_schema(),
                ),
            )
            parsed = json.loads(response.text)
        except (AttributeError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ProposalProviderError(f"Gemini returned invalid JSON: {exc}") from exc
        if not isinstance(parsed, dict):
            raise ProposalProviderError("Gemini structured output must be a JSON object")
        return parsed


def provider_from_env() -> ProposalProvider:
    mode = os.getenv("INTENT_COMPILER_PROVIDER", "fake").strip().casefold()
    if mode == "fake":
        return FakeProposalProvider()
    if mode != "vertex":
        raise RuntimeError("INTENT_COMPILER_PROVIDER must be 'fake' or 'vertex'")
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    if not project:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT is required in vertex mode")
    try:
        temperature = float(os.getenv("GEMINI_TEMPERATURE", "0.1"))
    except ValueError as exc:
        raise RuntimeError("GEMINI_TEMPERATURE must be a number") from exc
    return VertexGeminiProvider(
        project=project,
        location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
        model_name=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
        temperature=temperature,
    )


def validation_feedback(error: ValidationError | ValueError) -> str:
    if isinstance(error, ValidationError):
        return "; ".join(
            f"{'.'.join(map(str, item['loc']))}: {item['msg']}"
            for item in error.errors(include_url=False)
        )[:2000]
    return str(error)[:2000]
