// packages/server/lib/subdomain.test.ts
import { describe, test, expect } from "bun:test";
import { generateSubdomain, isValidSubdomain } from "./subdomain";

describe("Subdomain", () => {
  test("generateSubdomain returns 6 character string", () => {
    const subdomain = generateSubdomain();
    expect(subdomain.length).toBe(6);
  });

  test("generateSubdomain only contains lowercase alphanumeric", () => {
    const subdomain = generateSubdomain();
    expect(subdomain).toMatch(/^[a-z0-9]+$/);
  });

  test("generateSubdomain returns unique values", () => {
    const subdomains = new Set<string>();
    for (let i = 0; i < 100; i++) {
      subdomains.add(generateSubdomain());
    }
    expect(subdomains.size).toBe(100);
  });

  test("isValidSubdomain validates correctly", () => {
    expect(isValidSubdomain("abc123")).toBe(true);
    expect(isValidSubdomain("ABC123")).toBe(false);
    expect(isValidSubdomain("abc-123")).toBe(false);
    expect(isValidSubdomain("ab")).toBe(false);
    expect(isValidSubdomain("")).toBe(false);
  });
});
