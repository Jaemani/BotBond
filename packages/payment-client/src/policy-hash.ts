/**
 * AccessPolicy canonical hash — docs/03 §1 Canonicalization:
 * "key ordering이 안정적인 canonical JSON, hash는 sha256(canonical_json_bytes)".
 *
 * 규칙: 객체 key 재귀 정렬(사전순), 배열 순서 유지, 공백 없음, undefined 키 생략(JSON.stringify 동치).
 * golden fixture(`packages/contracts/fixtures/golden-policy.json` — B 저장소)와의 정확 패리티는
 * 병합 시 tests/policy-hash.test.ts의 GOLDEN 블록으로 확정한다 (기대값 sha256:120cece7…).
 */
import { createHash } from "crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (value === undefined) throw new Error("undefined is not representable in canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** `sha256:<hex>` 형식 — docs/03 policyHash 표기와 동일. */
export function canonicalPolicyHash(policy: unknown): string {
  const digest = createHash("sha256")
    .update(Buffer.from(canonicalJson(policy), "utf8"))
    .digest("hex");
  return `sha256:${digest}`;
}
