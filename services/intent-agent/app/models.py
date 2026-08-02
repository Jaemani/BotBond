from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

StrictText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
AtomicAmount = Annotated[str, StringConstraints(pattern=r"^(0|[1-9][0-9]*)$")]
PathTemplate = Annotated[str, StringConstraints(pattern=r"^/(?:[^?#]*)$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class HttpMethod(str, Enum):
    GET = "GET"
    POST = "POST"


class RiskTier(str, Enum):
    LOW = "LOW"
    BONDED = "BONDED"


class CatalogOperation(StrictModel):
    id: StrictText
    method: HttpMethod = Field(strict=False)
    pathTemplate: PathTemplate
    fields: list[StrictText] = Field(min_length=1)
    maxCalls: int = Field(ge=1)
    riskTier: RiskTier = Field(strict=False)

    @field_validator("fields")
    @classmethod
    def unique_fields(cls, fields: list[str]) -> list[str]:
        if len(fields) != len(set(fields)):
            raise ValueError("catalog operation fields must be unique")
        return fields


class MerchantCatalog(StrictModel):
    version: Literal["merchant-catalog/v1"]
    merchantId: StrictText
    operations: list[CatalogOperation] = Field(min_length=1)
    forbiddenPaths: list[PathTemplate] = Field(default_factory=list)
    maxTotalCalls: int | None = Field(default=None, ge=1)
    maxRequestsPerMinute: int | None = Field(default=None, ge=1)
    maxSessionTtlSeconds: int | None = Field(default=None, ge=1)
    maxUsageCapAtomic: AtomicAmount | None = None
    maxBondAmountAtomic: AtomicAmount | None = None
    maxPenaltyAtomic: AtomicAmount | None = None
    defaultExpiryPenaltyAtomic: AtomicAmount = "0"

    @model_validator(mode="after")
    def unique_operations(self) -> MerchantCatalog:
        ids = [operation.id for operation in self.operations]
        if len(ids) != len(set(ids)):
            raise ValueError("catalog operation ids must be unique")
        capabilities = [
            (operation.method, operation.pathTemplate) for operation in self.operations
        ]
        if len(capabilities) != len(set(capabilities)):
            raise ValueError("catalog method/path capabilities must be unique")
        return self


class UserBudget(StrictModel):
    usageCapAtomic: AtomicAmount
    bondCapAtomic: AtomicAmount
    maxTotalCalls: int | None = Field(default=None, ge=1)
    maxRequestsPerMinute: int | None = Field(default=None, ge=1)
    maxSessionTtlSeconds: int | None = Field(default=None, ge=1)


class CompileRequest(StrictModel):
    agentWallet: StrictText
    task: StrictText
    catalog: MerchantCatalog
    budget: UserBudget


class ProposedOperation(StrictModel):
    operationId: StrictText
    allowedResponseFields: list[StrictText] = Field(min_length=1)
    maxCalls: int = Field(ge=1)

    @field_validator("allowedResponseFields")
    @classmethod
    def unique_fields(cls, fields: list[str]) -> list[str]:
        if len(fields) != len(set(fields)):
            raise ValueError("allowed response fields must be unique")
        return fields


class ProposedBondedAction(StrictModel):
    operationId: StrictText
    maxActive: int = Field(ge=1)
    ttlSeconds: int = Field(ge=1)
    expiryPenaltyAtomic: AtomicAmount


class PolicyProposal(StrictModel):
    purpose: StrictText
    operations: list[ProposedOperation] = Field(min_length=1)
    maxTotalCalls: int = Field(ge=1)
    maxRequestsPerMinute: int = Field(ge=1)
    sessionTtlSeconds: int = Field(ge=1)
    usageCapAtomic: AtomicAmount
    bondAmountAtomic: AtomicAmount
    maxPenaltyAtomic: AtomicAmount
    bondedActions: list[ProposedBondedAction] = Field(default_factory=list)
    explanation: list[StrictText] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_capabilities(self) -> PolicyProposal:
        operation_ids = [operation.operationId for operation in self.operations]
        if len(operation_ids) != len(set(operation_ids)):
            raise ValueError("proposal operations must be unique")
        bonded_ids = [action.operationId for action in self.bondedActions]
        if len(bonded_ids) != len(set(bonded_ids)):
            raise ValueError("proposal bonded actions must be unique")
        return self


class AllowedOperation(StrictModel):
    method: HttpMethod = Field(strict=False)
    pathTemplate: PathTemplate
    allowedResponseFields: list[StrictText] = Field(min_length=1)
    maxCalls: int = Field(ge=1)


class PolicyConstraints(StrictModel):
    maxTotalCalls: int = Field(ge=1)
    maxRequestsPerMinute: int = Field(ge=1)
    expiresAt: StrictText
    usageCapAtomic: AtomicAmount
    bondAmountAtomic: AtomicAmount
    maxPenaltyAtomic: AtomicAmount

    @field_validator("expiresAt")
    @classmethod
    def utc_timestamp(cls, value: str) -> str:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("expiresAt must be an ISO-8601 timestamp") from exc
        if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
            raise ValueError("expiresAt must be UTC")
        return value


class BondedAction(StrictModel):
    operationId: StrictText
    maxActive: int = Field(ge=1)
    ttlSeconds: int = Field(ge=1)
    expiryPenaltyAtomic: AtomicAmount


class Settlement(StrictModel):
    validClose: Literal["REFUND_BOND"] = "REFUND_BOND"
    scopeViolation: Literal[
        "BOUNDED_PENALTY_AND_REFUND_REMAINDER"
    ] = "BOUNDED_PENALTY_AND_REFUND_REMAINDER"
    expiry: Literal["RECLAIM_AFTER_GRACE_PERIOD"] = "RECLAIM_AFTER_GRACE_PERIOD"


class AccessPolicy(StrictModel):
    version: Literal["botbond-policy/v1"]
    policyId: StrictText
    merchantId: StrictText
    agentWallet: StrictText
    purpose: StrictText
    allowedOperations: list[AllowedOperation] = Field(min_length=1)
    constraints: PolicyConstraints
    bondedActions: list[BondedAction]
    settlement: Settlement
    catalogVersion: StrictText

    @model_validator(mode="after")
    def monetary_invariants(self) -> AccessPolicy:
        if int(self.constraints.maxPenaltyAtomic) > int(
            self.constraints.bondAmountAtomic
        ):
            raise ValueError("maxPenaltyAtomic cannot exceed bondAmountAtomic")
        for action in self.bondedActions:
            if int(action.expiryPenaltyAtomic) > int(
                self.constraints.maxPenaltyAtomic
            ):
                raise ValueError(
                    "expiryPenaltyAtomic cannot exceed maxPenaltyAtomic"
                )
        return self


class ValidationMetadataBase(StrictModel):
    valid: Literal[True]
    repairsAttempted: int = Field(ge=0)
    clamped: list[StrictText]


class FakeValidationMetadata(ValidationMetadataBase):
    compilerMode: Literal["FAKE"]
    fixtureMarker: Literal["FAKE_COMPILER_FIXTURE"]


class VertexValidationMetadata(ValidationMetadataBase):
    compilerMode: Literal["VERTEX_AI"]


ValidationMetadata = Annotated[
    FakeValidationMetadata | VertexValidationMetadata,
    Field(discriminator="compilerMode"),
]


class CompileResponse(StrictModel):
    policy: AccessPolicy
    explanation: list[StrictText] = Field(min_length=1)
    excludedPermissions: list[PathTemplate]
    validationMetadata: ValidationMetadata
    compilerMode: Literal["FAKE", "VERTEX_AI"]
    fake: bool

    @model_validator(mode="after")
    def compiler_mode_is_consistent(self) -> CompileResponse:
        expected_fake = self.compilerMode == "FAKE"
        if self.fake is not expected_fake:
            raise ValueError("fake must agree with compilerMode")
        if self.validationMetadata.compilerMode != self.compilerMode:
            raise ValueError("validationMetadata.compilerMode must agree with compilerMode")
        return self
