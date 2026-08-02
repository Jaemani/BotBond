import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  policyHash,
  validateAccessPolicy,
  validateCatalog,
  validateEvent,
  validateReceipt,
  type AccessPolicy,
  type MerchantCapabilityCatalog,
} from "../src/index.js";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

describe("shared contracts", () => {
  it("validates catalog and golden policy", () => {
    const catalog = fixture("merchant-catalog.json") as MerchantCapabilityCatalog;
    const policy = fixture("golden-policy.json") as AccessPolicy;
    expect(validateCatalog(catalog)).toEqual({ valid: true, errors: [] });
    expect(validateAccessPolicy(policy, catalog)).toEqual({ valid: true, errors: [] });
  });

  it("uses stable canonical JSON and expected hash", () => {
    const policy = fixture("golden-policy.json") as AccessPolicy;
    const expected = readFileSync(new URL("../fixtures/golden-policy.sha256", import.meta.url), "utf8").trim();
    expect(policyHash(policy)).toBe(expected);
    expect(canonicalJson({ z: 1, a: { y: 2, x: 1 } })).toBe('{"a":{"x":1,"y":2},"z":1}');
  });

  it("validates Role A event fixtures", () => {
    for (const name of ["events-normal.json", "events-denied.json", "events-expired.json"]) {
      const events = fixture(name) as unknown[];
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) expect(validateEvent(event)).toEqual({ valid: true, errors: [] });
    }
  });

  it("validates Role A receipt fixtures", () => {
    for (const name of ["receipt-normal.json", "receipt-expired.json"]) {
      expect(validateReceipt(fixture(name))).toEqual({ valid: true, errors: [] });
    }
  });

  it("rejects policies above merchant maxima", () => {
    const catalog = fixture("merchant-catalog.json") as MerchantCapabilityCatalog;
    const policy = structuredClone(fixture("golden-policy.json")) as AccessPolicy;
    policy.constraints.usageCapAtomic = "200001";
    const result = validateAccessPolicy(policy, catalog);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("usageCapAtomic exceeds catalog maximum");
  });

  it("rejects catalog-external operations", () => {
    const catalog = fixture("merchant-catalog.json") as MerchantCapabilityCatalog;
    const policy = structuredClone(fixture("golden-policy.json")) as AccessPolicy;
    policy.allowedOperations.push({ method: "GET", pathTemplate: "/admin", allowedResponseFields: [], maxCalls: 1 });
    const result = validateAccessPolicy(policy, catalog);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("GET /admin is outside catalog");
  });
});
