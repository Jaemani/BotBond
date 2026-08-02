from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest

from app.compiler import canonical_json, canonical_sha256
from app.models import AccessPolicy

FIXTURE = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "contracts"
    / "fixtures"
    / "golden-policy.json"
)
HASH_FIXTURE = FIXTURE.with_suffix(".sha256")
EXPECTED_CANONICAL_SHA256 = (
    "sha256:120cece73bb7e5229db531c96d82b9d210a419ac9a901a34ccf72b136d346feb"
)


def test_shared_golden_policy_canonical_sha256() -> None:
    if not FIXTURE.exists():
        pytest.skip(
            "parent-owned packages/contracts/fixtures/golden-policy.json is temporarily absent"
        )

    fixture: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    if "policy" in fixture:
        policy_data = fixture["policy"]
        expected = fixture.get("policyHash") or fixture.get("canonicalSha256")
    else:
        policy_data = {
            key: value
            for key, value in fixture.items()
            if key not in {"policyHash", "canonicalSha256"}
        }
        expected = fixture.get("policyHash") or fixture.get("canonicalSha256")

    policy = AccessPolicy.model_validate(policy_data)
    digest = canonical_sha256(policy)
    independently_computed = "sha256:" + hashlib.sha256(
        json.dumps(
            policy_data,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()

    assert canonical_json(policy) == canonical_json(policy_data)
    assert digest == independently_computed
    assert digest == EXPECTED_CANONICAL_SHA256
    if HASH_FIXTURE.exists():
        assert digest == HASH_FIXTURE.read_text(encoding="utf-8").strip()
    if expected is not None:
        assert digest == expected
