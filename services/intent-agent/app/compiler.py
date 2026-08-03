from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from pydantic import ValidationError

from .models import (
    AccessPolicy,
    AllowedOperation,
    BondedAction,
    CompileRequest,
    CompileResponse,
    PolicyConstraints,
    PolicyProposal,
    RiskTier,
    Settlement,
)
from .providers import ProposalProvider, ProposalProviderError, validation_feedback

MAX_REPAIR_ATTEMPTS = 2
DEFAULT_MAX_REQUESTS_PER_MINUTE = 60
DEFAULT_SESSION_TTL_SECONDS = 300


class InvalidCompilerOutputError(RuntimeError):
    def __init__(self, attempts: int, errors: list[str]) -> None:
        self.attempts = attempts
        self.errors = errors
        super().__init__(
            f"compiler output invalid after {attempts} attempts: {errors[-1]}"
        )


def canonical_json(value: AccessPolicy | dict[str, Any]) -> bytes:
    raw = value.model_dump(mode="json") if isinstance(value, AccessPolicy) else value
    return json.dumps(
        raw,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def canonical_sha256(value: AccessPolicy | dict[str, Any]) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value)).hexdigest()


def _record_clamp(clamped: list[str], name: str, proposed: int, built: int) -> int:
    if built < proposed and name not in clamped:
        clamped.append(name)
    return built


def _clamp_int(
    value: int,
    *caps: int | None,
    clamped: list[str],
    name: str,
) -> int:
    built = min(value, *(cap for cap in caps if cap is not None))
    return _record_clamp(clamped, name, value, built)


def _clamp_atomic(
    value: str,
    *caps: str | None,
    clamped: list[str],
    name: str,
) -> str:
    built = min(int(value), *(int(cap) for cap in caps if cap is not None))
    _record_clamp(clamped, name, int(value), built)
    return str(built)


def _normalized_permission_terms(value: str) -> set[str]:
    """Return comparable path/phrase terms, ignoring punctuation and simple plurals."""

    terms = re.findall(r"[^\W_]+", value.casefold())
    return {term[:-1] if len(term) > 3 and term.endswith("s") else term for term in terms}


def _requested_forbidden_paths(request: CompileRequest) -> list[str]:
    """Find forbidden catalog paths requested by path or natural-language phrase."""

    task_terms = _normalized_permission_terms(request.task)
    excluded: list[str] = []
    for path in request.catalog.forbiddenPaths:
        path_terms = _normalized_permission_terms(path)
        if path.casefold() in request.task.casefold() or (
            path_terms and path_terms.issubset(task_terms)
        ):
            excluded.append(path)
    return excluded


def _validate_and_build_policy(
    request: CompileRequest,
    proposal: PolicyProposal,
    *,
    now: datetime,
) -> tuple[AccessPolicy, list[str]]:
    catalog_by_id = {operation.id: operation for operation in request.catalog.operations}
    allowed_operations: list[AllowedOperation] = []
    selected_by_id: dict[str, Any] = {}
    clamped: list[str] = []

    for proposed in proposal.operations:
        catalog_operation = catalog_by_id.get(proposed.operationId)
        if catalog_operation is None:
            raise ValueError(
                f"operationId {proposed.operationId!r} is not in the merchant catalog"
            )
        invented_fields = set(proposed.allowedResponseFields) - set(
            catalog_operation.fields
        )
        if invented_fields:
            raise ValueError(
                f"operation {proposed.operationId!r} invented fields: "
                + ", ".join(sorted(invented_fields))
            )
        max_calls = _clamp_int(
            proposed.maxCalls,
            catalog_operation.maxCalls,
            clamped=clamped,
            name=f"{proposed.operationId}.maxCalls",
        )
        allowed_operations.append(
            AllowedOperation(
                method=catalog_operation.method,
                pathTemplate=catalog_operation.pathTemplate,
                allowedResponseFields=proposed.allowedResponseFields,
                maxCalls=max_calls,
            )
        )
        selected_by_id[proposed.operationId] = (catalog_operation, max_calls)

    # A bonded reservation is unsafe unless the policy can also release it and
    # deterministically process expiry. These are lifecycle controls, not extra
    # business permissions, so enforce them from the merchant catalog even when
    # the model omits them from its proposal.
    if "reserve-inventory" in selected_by_id:
        for lifecycle_id in ("release-reservation", "expire-reservation"):
            if lifecycle_id in selected_by_id:
                continue
            lifecycle_operation = catalog_by_id.get(lifecycle_id)
            if lifecycle_operation is None:
                continue
            allowed_operations.append(
                AllowedOperation(
                    method=lifecycle_operation.method,
                    pathTemplate=lifecycle_operation.pathTemplate,
                    allowedResponseFields=list(lifecycle_operation.fields),
                    maxCalls=lifecycle_operation.maxCalls,
                )
            )
            selected_by_id[lifecycle_id] = (
                lifecycle_operation,
                lifecycle_operation.maxCalls,
            )

    sum_operation_calls = sum(operation.maxCalls for operation in allowed_operations)
    max_total_calls = _clamp_int(
        proposal.maxTotalCalls,
        sum_operation_calls,
        request.catalog.maxTotalCalls,
        request.budget.maxTotalCalls,
        clamped=clamped,
        name="constraints.maxTotalCalls",
    )
    max_requests_per_minute = _clamp_int(
        proposal.maxRequestsPerMinute,
        max_total_calls,
        request.catalog.maxRequestsPerMinute,
        request.budget.maxRequestsPerMinute,
        DEFAULT_MAX_REQUESTS_PER_MINUTE,
        clamped=clamped,
        name="constraints.maxRequestsPerMinute",
    )
    ttl_seconds = _clamp_int(
        proposal.sessionTtlSeconds,
        request.catalog.maxSessionTtlSeconds,
        request.budget.maxSessionTtlSeconds,
        DEFAULT_SESSION_TTL_SECONDS,
        clamped=clamped,
        name="constraints.sessionTtlSeconds",
    )
    usage_cap = _clamp_atomic(
        proposal.usageCapAtomic,
        request.budget.usageCapAtomic,
        request.catalog.maxUsageCapAtomic,
        clamped=clamped,
        name="constraints.usageCapAtomic",
    )
    bond_amount = _clamp_atomic(
        proposal.bondAmountAtomic,
        request.budget.bondCapAtomic,
        request.catalog.maxBondAmountAtomic,
        clamped=clamped,
        name="constraints.bondAmountAtomic",
    )
    max_penalty = _clamp_atomic(
        proposal.maxPenaltyAtomic,
        bond_amount,
        request.catalog.maxPenaltyAtomic,
        clamped=clamped,
        name="constraints.maxPenaltyAtomic",
    )

    bonded_actions: list[BondedAction] = []
    for proposed_action in proposal.bondedActions:
        selection = selected_by_id.get(proposed_action.operationId)
        if selection is None:
            raise ValueError(
                f"bonded action {proposed_action.operationId!r} is not a selected operation"
            )
        catalog_operation, selected_max_calls = selection
        if catalog_operation.riskTier is not RiskTier.BONDED:
            raise ValueError(
                f"operation {proposed_action.operationId!r} is not BONDED in the catalog"
            )
        max_active = _clamp_int(
            proposed_action.maxActive,
            selected_max_calls,
            clamped=clamped,
            name=f"bondedActions.{proposed_action.operationId}.maxActive",
        )
        action_ttl = _clamp_int(
            proposed_action.ttlSeconds,
            ttl_seconds,
            clamped=clamped,
            name=f"bondedActions.{proposed_action.operationId}.ttlSeconds",
        )
        expiry_penalty = _clamp_atomic(
            proposed_action.expiryPenaltyAtomic,
            max_penalty,
            request.catalog.defaultExpiryPenaltyAtomic,
            clamped=clamped,
            name=f"bondedActions.{proposed_action.operationId}.expiryPenaltyAtomic",
        )
        bonded_actions.append(
            BondedAction(
                operationId=proposed_action.operationId,
                maxActive=max_active,
                ttlSeconds=action_ttl,
                expiryPenaltyAtomic=expiry_penalty,
            )
        )

    selected_bonded_ids = {
        operation_id
        for operation_id, (operation, _) in selected_by_id.items()
        if operation.riskTier is RiskTier.BONDED
    }
    proposed_bonded_ids = {action.operationId for action in bonded_actions}
    if selected_bonded_ids != proposed_bonded_ids:
        missing = selected_bonded_ids - proposed_bonded_ids
        raise ValueError(
            "every selected BONDED operation needs a bonded action; missing: "
            + ", ".join(sorted(missing))
        )
    if not bonded_actions:
        _record_clamp(
            clamped,
            "constraints.bondAmountAtomic",
            int(bond_amount),
            0,
        )
        _record_clamp(
            clamped,
            "constraints.maxPenaltyAtomic",
            int(max_penalty),
            0,
        )
        bond_amount = "0"
        max_penalty = "0"

    expires_at = (now.astimezone(timezone.utc) + timedelta(seconds=ttl_seconds)).replace(
        microsecond=0
    )
    policy_seed = {
        "merchantId": request.catalog.merchantId,
        "agentWallet": request.agentWallet,
        "purpose": proposal.purpose,
        "operations": [operation.model_dump(mode="json") for operation in allowed_operations],
        "catalogVersion": request.catalog.version,
    }
    policy_id = "pol_" + hashlib.sha256(canonical_json(policy_seed)).hexdigest()[:24]

    policy = AccessPolicy(
        version="botbond-policy/v1",
        policyId=policy_id,
        merchantId=request.catalog.merchantId,
        agentWallet=request.agentWallet,
        purpose=proposal.purpose,
        allowedOperations=allowed_operations,
        constraints=PolicyConstraints(
            maxTotalCalls=max_total_calls,
            maxRequestsPerMinute=max_requests_per_minute,
            expiresAt=expires_at.isoformat().replace("+00:00", "Z"),
            usageCapAtomic=usage_cap,
            bondAmountAtomic=bond_amount,
            maxPenaltyAtomic=max_penalty,
        ),
        bondedActions=bonded_actions,
        settlement=Settlement(),
        catalogVersion=request.catalog.version,
    )
    return policy, clamped


class IntentCompiler:
    def __init__(
        self,
        provider: ProposalProvider,
        *,
        now: Callable[[], datetime] | None = None,
        max_repairs: int = MAX_REPAIR_ATTEMPTS,
    ) -> None:
        if max_repairs < 0 or max_repairs > MAX_REPAIR_ATTEMPTS:
            raise ValueError(f"max_repairs must be between 0 and {MAX_REPAIR_ATTEMPTS}")
        self.provider = provider
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.max_repairs = max_repairs

    async def compile(self, request: CompileRequest) -> CompileResponse:
        errors: list[str] = []
        feedback: str | None = None
        attempts = self.max_repairs + 1
        for attempt_index in range(attempts):
            try:
                raw = await self.provider.propose(
                    request,
                    repair_feedback=feedback,
                )
                proposal = PolicyProposal.model_validate(raw)
                policy, clamped = _validate_and_build_policy(
                    request,
                    proposal,
                    now=self.now(),
                )
                excluded_permissions = _requested_forbidden_paths(request)
                explanation = list(proposal.explanation)
                if excluded_permissions:
                    explanation.append(
                        "Excluded requested forbidden permissions: "
                        + ", ".join(excluded_permissions)
                        + "."
                    )
                compiler_mode = self.provider.mode
                validation_metadata: dict[str, Any] = {
                    "valid": True,
                    "repairsAttempted": attempt_index,
                    "clamped": clamped,
                    "compilerMode": compiler_mode,
                }
                if compiler_mode == "FAKE":
                    validation_metadata["fixtureMarker"] = "FAKE_COMPILER_FIXTURE"
                return CompileResponse.model_validate(
                    {
                        "policy": policy,
                        "explanation": explanation,
                        "excludedPermissions": excluded_permissions,
                        "validationMetadata": validation_metadata,
                        "compilerMode": compiler_mode,
                        "fake": compiler_mode == "FAKE",
                    }
                )
            except (ValidationError, ValueError, ProposalProviderError) as exc:
                feedback = validation_feedback(exc)
                errors.append(feedback)
        raise InvalidCompilerOutputError(attempts, errors)
