from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.compiler import IntentCompiler, InvalidCompilerOutputError
from app.main import create_app
from app.models import CompileRequest
from app.providers import FakeProposalProvider, ProposalProvider

FIXED_NOW = datetime(2026, 8, 1, 10, 0, tzinfo=timezone.utc)


@pytest.fixture
def catalog() -> dict[str, Any]:
    return {
        "version": "merchant-catalog/v1",
        "merchantId": "demo-commerce",
        "operations": [
            {
                "id": "search-products",
                "method": "GET",
                "pathTemplate": "/products",
                "fields": ["id", "name", "price", "stock", "shipping"],
                "maxCalls": 10,
                "riskTier": "LOW",
            },
            {
                "id": "get-inventory",
                "method": "GET",
                "pathTemplate": "/products/{id}/inventory",
                "fields": ["stock", "updatedAt"],
                "maxCalls": 25,
                "riskTier": "LOW",
            },
            {
                "id": "reserve-inventory",
                "method": "POST",
                "pathTemplate": "/reservations",
                "fields": ["productId", "quantity", "expiresAt"],
                "maxCalls": 1,
                "riskTier": "BONDED",
            },
        ],
        "forbiddenPaths": ["/seller-contacts", "/users", "/admin"],
        "maxTotalCalls": 20,
        "maxRequestsPerMinute": 12,
        "maxSessionTtlSeconds": 600,
        "maxUsageCapAtomic": "150000",
        "maxBondAmountAtomic": "800000",
        "maxPenaltyAtomic": "100000",
        "defaultExpiryPenaltyAtomic": "20000",
    }


def make_request(catalog: dict[str, Any], task: str) -> CompileRequest:
    return CompileRequest.model_validate(
        {
            "agentWallet": "agent-wallet-1",
            "task": task,
            "catalog": catalog,
            "budget": {
                "usageCapAtomic": "200000",
                "bondCapAtomic": "1000000",
                "maxTotalCalls": 15,
                "maxRequestsPerMinute": 10,
                "maxSessionTtlSeconds": 300,
            },
        }
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("task", "expected_paths", "expected_fields", "bonded"),
    [
        (
            "Compare laptop price and stock only",
            {"/products", "/products/{id}/inventory"},
            {"id", "name", "price", "stock", "updatedAt"},
            False,
        ),
        (
            "Compare price and stock, then reserve the best item for 60 seconds",
            {"/products", "/products/{id}/inventory", "/reservations"},
            {
                "id",
                "name",
                "price",
                "stock",
                "updatedAt",
                "productId",
                "quantity",
                "expiresAt",
            },
            True,
        ),
        (
            "Find price and stock and fetch seller contacts and /admin users",
            {"/products", "/products/{id}/inventory"},
            {"id", "name", "price", "stock", "updatedAt"},
            False,
        ),
        (
            "Show laptop shipping and price only",
            {"/products"},
            {"id", "name", "price", "shipping"},
            False,
        ),
    ],
    ids=["price-stock", "one-reservation", "forbidden-excluded", "minimal-fields"],
)
async def test_four_eval_cases(
    catalog: dict[str, Any],
    task: str,
    expected_paths: set[str],
    expected_fields: set[str],
    bonded: bool,
) -> None:
    compiler = IntentCompiler(FakeProposalProvider(), now=lambda: FIXED_NOW)
    result = await compiler.compile(make_request(catalog, task))

    assert result.compilerMode == "FAKE"
    assert result.fake is True
    assert result.validationMetadata.valid is True
    assert result.validationMetadata.repairsAttempted == 0
    assert result.validationMetadata.compilerMode == "FAKE"
    assert result.validationMetadata.fixtureMarker == "FAKE_COMPILER_FIXTURE"
    assert {operation.pathTemplate for operation in result.policy.allowedOperations} == expected_paths
    assert {
        field
        for operation in result.policy.allowedOperations
        for field in operation.allowedResponseFields
    } == expected_fields
    assert bool(result.policy.bondedActions) is bonded
    assert all(
        operation.pathTemplate not in catalog["forbiddenPaths"]
        for operation in result.policy.allowedOperations
    )
    if "seller contact" in task.casefold():
        assert result.excludedPermissions == [
            "/seller-contacts",
            "/users",
            "/admin",
        ]
        assert result.explanation[-1] == (
            "Excluded requested forbidden permissions: "
            "/seller-contacts, /users, /admin."
        )


class SequenceProvider(ProposalProvider):
    mode = "VERTEX_AI"

    def __init__(self, outputs: list[dict[str, Any]]) -> None:
        self.outputs = outputs
        self.feedback: list[str | None] = []

    async def propose(
        self,
        request: CompileRequest,
        *,
        repair_feedback: str | None = None,
    ) -> dict[str, Any]:
        del request
        self.feedback.append(repair_feedback)
        return self.outputs[min(len(self.feedback) - 1, len(self.outputs) - 1)]


def proposal(operation_id: str = "search-products") -> dict[str, Any]:
    return {
        "purpose": "Compare price",
        "operations": [
            {
                "operationId": operation_id,
                "allowedResponseFields": ["id", "price"],
                "maxCalls": 999,
            }
        ],
        "maxTotalCalls": 999,
        "maxRequestsPerMinute": 999,
        "sessionTtlSeconds": 9999,
        "usageCapAtomic": "9999999",
        "bondAmountAtomic": "9999999",
        "maxPenaltyAtomic": "9999999",
        "bondedActions": [],
        "explanation": ["Price is required"],
    }


@pytest.mark.asyncio
async def test_caps_are_clamped_by_catalog_and_user(catalog: dict[str, Any]) -> None:
    compiler = IntentCompiler(
        SequenceProvider([proposal()]),
        now=lambda: FIXED_NOW,
    )
    result = await compiler.compile(make_request(catalog, "Compare price"))

    operation = result.policy.allowedOperations[0]
    assert operation.maxCalls == 10
    assert result.policy.constraints.maxTotalCalls == 10
    assert result.policy.constraints.maxRequestsPerMinute == 10
    assert result.policy.constraints.expiresAt == "2026-08-01T10:05:00Z"
    assert result.policy.constraints.usageCapAtomic == "150000"
    assert result.policy.constraints.bondAmountAtomic == "0"
    assert result.policy.constraints.maxPenaltyAtomic == "0"
    assert result.validationMetadata.clamped == [
        "search-products.maxCalls",
        "constraints.maxTotalCalls",
        "constraints.maxRequestsPerMinute",
        "constraints.sessionTtlSeconds",
        "constraints.usageCapAtomic",
        "constraints.bondAmountAtomic",
        "constraints.maxPenaltyAtomic",
    ]
    assert result.validationMetadata.compilerMode == "VERTEX_AI"
    assert result.validationMetadata.repairsAttempted == 0
    assert not hasattr(result.validationMetadata, "fixtureMarker")


@pytest.mark.asyncio
async def test_catalog_external_endpoint_repairs_then_fails(catalog: dict[str, Any]) -> None:
    provider = SequenceProvider([proposal("invented-admin")])
    compiler = IntentCompiler(provider, now=lambda: FIXED_NOW)

    with pytest.raises(InvalidCompilerOutputError) as caught:
        await compiler.compile(make_request(catalog, "Read admin data"))

    assert caught.value.attempts == 3
    assert len(provider.feedback) == 3
    assert provider.feedback[0] is None
    assert all("not in the merchant catalog" in item for item in provider.feedback[1:])


@pytest.mark.asyncio
async def test_repair_succeeds_on_second_call(catalog: dict[str, Any]) -> None:
    provider = SequenceProvider([proposal("invented-admin"), proposal()])
    result = await IntentCompiler(provider, now=lambda: FIXED_NOW).compile(
        make_request(catalog, "Compare price")
    )

    assert len(provider.feedback) == 2
    assert result.policy.allowedOperations[0].pathTemplate == "/products"
    assert result.validationMetadata.repairsAttempted == 1
    assert result.validationMetadata.valid is True
    assert result.validationMetadata.compilerMode == "VERTEX_AI"


@pytest.mark.asyncio
async def test_api_marks_fake_mode_visibly(catalog: dict[str, Any]) -> None:
    app = create_app(FakeProposalProvider())
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        async with app.router.lifespan_context(app):
            health = await client.get("/healthz")
            response = await client.post(
                "/v1/compile",
                json=make_request(catalog, "Compare price").model_dump(mode="json"),
            )

    assert health.status_code == 200
    assert health.json()["fake"] is True
    assert health.json()["warning"].startswith("FAKE INTENT COMPILER")
    assert response.status_code == 200
    assert response.json()["compilerMode"] == "FAKE"
    assert response.json()["fake"] is True
    assert response.json()["excludedPermissions"] == []
    assert response.json()["validationMetadata"] == {
        "valid": True,
        "repairsAttempted": 0,
        "clamped": ["constraints.usageCapAtomic"],
        "compilerMode": "FAKE",
        "fixtureMarker": "FAKE_COMPILER_FIXTURE",
    }


@pytest.mark.asyncio
async def test_api_returns_explicit_invalid_output_error(catalog: dict[str, Any]) -> None:
    app = create_app(SequenceProvider([proposal("invented-admin")]))
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        async with app.router.lifespan_context(app):
            response = await client.post(
                "/v1/compile",
                json=make_request(catalog, "Read admin data").model_dump(mode="json"),
            )

    assert response.status_code == 422
    assert response.json()["error"] == "INVALID_COMPILER_OUTPUT"
    assert response.json()["attempts"] == 3
