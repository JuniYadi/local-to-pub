import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { combineReleaseNotes } from "./compose-release-notes";

const workflow = readFileSync(".github/workflows/release.yml", "utf8");

describe("release workflow", () => {
  test("preserves generated release notes when adding checksums", () => {
    expect(workflow).toContain("releases/generate-notes");
    expect(workflow).not.toContain("body: ${{ steps.checksums.outputs.body }}");
  });

  test("supports rerunning a tag release without failing on existing releases", () => {
    expect(workflow).toContain("gh release view");
    expect(workflow).toContain("gh release edit");
  });
});

describe("combineReleaseNotes", () => {
  test("appends checksum notes after generated release notes", () => {
    const result = combineReleaseNotes("## What's Changed\n- Fix redirect", "## 📦 Checksums\n- abc");

    expect(result).toContain("## What's Changed");
    expect(result).toContain("## 📦 Checksums");
    expect(result.indexOf("## What's Changed")).toBeLessThan(result.indexOf("## 📦 Checksums"));
  });
});
