import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson, type SettlementAuthorizationEvidence } from "@botbond/contracts";

export interface SettlementEvidenceInput {
  sessionId: string;
  policyHash: string;
  reservationId?: string;
  outcome: "VALID_CLOSE" | "EXPIRED_RESERVATION";
  usageChargedAtomic: string;
  penaltyAtomic: string;
  bondRefundedAtomic: string;
  nonce: string;
  issuedAt: string;
  authority: string;
}

function evidencePayload(input: SettlementEvidenceInput): Omit<SettlementAuthorizationEvidence, "evidenceHash" | "signature"> {
  return { version: "botbond-settlement-evidence/v1", ...input };
}

export function createSettlementEvidence(input: SettlementEvidenceInput, signingSecret: string): SettlementAuthorizationEvidence {
  if (!signingSecret) throw new Error("SETTLEMENT_SIGNING_SECRET_REQUIRED");
  const payload = evidencePayload(input);
  const evidenceHash = `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
  const signature = `hmac-sha256:${createHmac("sha256", signingSecret).update(evidenceHash).digest("hex")}`;
  return { ...payload, evidenceHash, signature };
}

export function verifySettlementEvidence(evidence: SettlementAuthorizationEvidence, signingSecret: string): boolean {
  const { evidenceHash, signature, ...payload } = evidence;
  const expectedHash = `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
  const expectedSignature = `hmac-sha256:${createHmac("sha256", signingSecret).update(expectedHash).digest("hex")}`;
  const hashMatches = Buffer.byteLength(evidenceHash) === Buffer.byteLength(expectedHash) && timingSafeEqual(Buffer.from(evidenceHash), Buffer.from(expectedHash));
  const signatureMatches = Buffer.byteLength(signature) === Buffer.byteLength(expectedSignature) && timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  return hashMatches && signatureMatches;
}
