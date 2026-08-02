import { createHash } from "node:crypto";
import { canonicalJson, type AccessPolicy, type MerchantCapabilityCatalog } from "@botbond/contracts";
import type { Clock } from "./clock.js";

export interface CompileIntentInput {
  task: string;
  merchantCapabilityCatalog: MerchantCapabilityCatalog;
  agentWallet: string;
  budget: { usageCapAtomic: string; bondCapAtomic: string };
}
export interface CompileIntentOutput {
  policy: AccessPolicy;
  explanation: string[];
  excludedPermissions: string[];
  validationMetadata: {
    valid: boolean;
    repairsAttempted: number;
    clamped: string[];
    compilerMode: "FAKE" | "VERTEX_AI";
    fixtureMarker?: "FAKE_COMPILER_FIXTURE";
  };
}
export interface IntentCompiler {
  compile(input: CompileIntentInput): Promise<CompileIntentOutput>;
}

export class HttpIntentCompiler implements IntentCompiler {
  constructor(private readonly baseUrl: string) {}
  async compile(input: CompileIntentInput): Promise<CompileIntentOutput> {
    const response = await fetch(`${this.baseUrl}/v1/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task: input.task,
        agentWallet: input.agentWallet,
        catalog: input.merchantCapabilityCatalog,
        budget: input.budget,
      }),
    });
    if (!response.ok) throw new Error(`INTENT_COMPILER_FAILED:${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    if (!body || typeof body !== "object" || !body.policy || !Array.isArray(body.explanation) || !Array.isArray(body.excludedPermissions) || !body.validationMetadata) {
      throw new Error("INTENT_COMPILER_CONTRACT_INVALID");
    }
    return body as unknown as CompileIntentOutput;
  }
}

export class FakeIntentCompiler implements IntentCompiler {
  constructor(private readonly clock: Clock) {}

  async compile(input: CompileIntentInput): Promise<CompileIntentOutput> {
    const task = input.task.toLowerCase();
    const wantsReservation = /reserve|reservation|예약/.test(task);
    const wantsSellerContacts = /seller contact|contact information|판매자.*연락/.test(task);
    const catalog = input.merchantCapabilityCatalog;
    const selectedIds = new Set(["search-products", "get-inventory"]);
    if (wantsReservation) {
      selectedIds.add("reserve-inventory");
      selectedIds.add("release-reservation");
      selectedIds.add("expire-reservation");
    }
    const selected = catalog.operations.filter((operation) => selectedIds.has(operation.id));
    const maxRequested = Number(task.match(/(?:compare|비교)\D{0,5}(\d+)/)?.[1] ?? 20);
    const clamped: string[] = [];
    const allowedOperations = selected.map((operation) => {
      const desired = operation.id === "get-inventory" ? maxRequested : operation.maxCalls;
      const maxCalls = Math.max(1, Math.min(desired, operation.maxCalls));
      if (desired > operation.maxCalls) clamped.push(`${operation.id}.maxCalls`);
      return {
        method: operation.method,
        pathTemplate: operation.pathTemplate,
        allowedResponseFields: [...operation.fields],
        maxCalls,
      };
    });
    const merchantUsageMax = 200000n;
    const merchantBondMax = wantsReservation ? 1000000n : 0n;
    const usage = BigInt(input.budget.usageCapAtomic) > merchantUsageMax ? merchantUsageMax : BigInt(input.budget.usageCapAtomic);
    const bond = BigInt(input.budget.bondCapAtomic) > merchantBondMax ? merchantBondMax : BigInt(input.budget.bondCapAtomic);
    if (BigInt(input.budget.usageCapAtomic) > merchantUsageMax) clamped.push("constraints.usageCapAtomic");
    if (BigInt(input.budget.bondCapAtomic) > merchantBondMax) clamped.push("constraints.bondAmountAtomic");
    const penalty = bond < 200000n ? bond : 200000n;
    const expiresAt = new Date(this.clock.now().getTime() + 5 * 60_000).toISOString();
    const policySeed = { merchantId: catalog.merchantId, agentWallet: input.agentWallet, purpose: input.task, allowedOperations, expiresAt };
    const deterministicId = createHash("sha256").update(canonicalJson(policySeed)).digest("hex").slice(0, 24);
    const policy: AccessPolicy = {
      version: "botbond-policy/v1",
      policyId: `pol_${deterministicId}`,
      merchantId: catalog.merchantId,
      agentWallet: input.agentWallet,
      purpose: input.task,
      allowedOperations,
      constraints: {
        maxTotalCalls: allowedOperations.reduce((sum, operation) => sum + operation.maxCalls, 0),
        maxRequestsPerMinute: 20,
        expiresAt,
        usageCapAtomic: usage.toString(),
        bondAmountAtomic: bond.toString(),
        maxPenaltyAtomic: penalty.toString(),
      },
      bondedActions: wantsReservation && bond > 0n ? [{ operationId: "reserve-inventory", maxActive: 1, ttlSeconds: 60, expiryPenaltyAtomic: penalty.toString() }] : [],
      settlement: {
        validClose: "REFUND_BOND",
        scopeViolation: "BOUNDED_PENALTY_AND_REFUND_REMAINDER",
        expiry: "RECLAIM_AFTER_GRACE_PERIOD",
      },
      catalogVersion: catalog.version,
    };
    return {
      policy,
      explanation: [
        "Product and inventory reads selected from merchant catalog.",
        ...(wantsReservation ? ["One 60-second bonded reservation allowed."] : ["No bonded action requested."]),
        ...(wantsSellerContacts ? ["Seller-contact access excluded because merchant catalog forbids it."] : []),
      ],
      excludedPermissions: wantsSellerContacts ? ["/seller-contacts"] : [],
      validationMetadata: { valid: true, repairsAttempted: 0, clamped, compilerMode: "FAKE", fixtureMarker: "FAKE_COMPILER_FIXTURE" },
    };
  }
}
