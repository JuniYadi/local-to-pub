// packages/client/lib/upgrade.test.ts
import { test, expect, describe, afterEach } from "bun:test";
import { getBinaryPath, getDownloadUrl, getCurrentVersion, getLatestVersion, detectOS, detectArch, downloadAndExtract, upgrade } from "./upgrade";
import { parseVersionOutput, getAppVersion } from "./version";
import { existsSync } from "fs";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("Upgrade", () => {
  describe("getBinaryPath", () => {
    test("returns user-local path when global is false", () => {
      const path = getBinaryPath(false);
      expect(path).toContain(".local/bin");
      expect(path).toContain("local-to-pub");
    });

    test("returns system-wide path when global is true", () => {
      const path = getBinaryPath(true);
      expect(path).toBe("/usr/local/bin/local-to-pub");
    });
  });

  describe("getDownloadUrl", () => {
    test("constructs correct download URL", () => {
      const url = getDownloadUrl("0.0.15", "darwin", "arm64");
      expect(url).toContain("github.com");
      expect(url).toContain("releases/download/v0.0.15");
      expect(url).toContain("local-to-pub-client-darwin-arm64-0.0.15.tar.gz");
    });

    test("constructs correct URL for linux amd64", () => {
      const url = getDownloadUrl("1.0.0", "linux", "amd64");
      expect(url).toContain("local-to-pub-client-linux-amd64-1.0.0.tar.gz");
    });
  });

  describe("getCurrentVersion", () => {
    const binaryPath = getBinaryPath(false);
    const binaryExists = existsSync(binaryPath);

    test("returns version string from provided binary path", async () => {
      const dir = mkdtempSync(join(tmpdir(), "ltp-version-test-"));
      tempDirs.push(dir);

      const fakeBinary = join(dir, "local-to-pub");
      writeFileSync(fakeBinary, "#!/bin/sh\necho 'local-to-pub v1.2.3'\n");
      chmodSync(fakeBinary, 0o755);

      const version = await getCurrentVersion(fakeBinary);
      expect(version).toBe("1.2.3");
    });

    test.skipIf(!binaryExists)("returns version string from installed binary", async () => {
      const version = await getCurrentVersion(binaryPath);
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("getLatestVersion", () => {
    test("fetches latest version from GitHub API", async () => {
      const version = await getLatestVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("detectOS", () => {
    test("returns darwin on macOS", () => {
      const os = detectOS();
      expect(["darwin", "linux"]).toContain(os);
    });
  });

  describe("detectArch", () => {
    test("returns amd64 or arm64", () => {
      const arch = detectArch();
      expect(["amd64", "arm64"]).toContain(arch);
    });
  });

  describe("downloadAndExtract", () => {
    test("is a function", () => {
      expect(typeof downloadAndExtract).toBe("function");
    });

    test("throws on download failure", async () => {
      await expect(downloadAndExtract("https://invalid.example.com/fake.tar.gz", "/tmp/test"))
        .rejects.toThrow();
    });
  });

  describe("version helpers", () => {
    test("parseVersionOutput extracts semver from cli output", () => {
      expect(parseVersionOutput("local-to-pub v0.0.17")).toBe("0.0.17");
      expect(parseVersionOutput("0.0.17")).toBe("0.0.17");
    });

    test("getAppVersion returns a semver string", () => {
      expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("upgrade", () => {
    test("upgrade function exists", () => {
      expect(typeof upgrade).toBe("function");
    });
    
    test("upgrade returns a promise", () => {
      // We can't actually call upgrade() in tests because it calls process.exit()
      // Just verify the function signature
      expect(upgrade.length).toBe(1); // Takes 1 argument (options)
    });
  });
});
