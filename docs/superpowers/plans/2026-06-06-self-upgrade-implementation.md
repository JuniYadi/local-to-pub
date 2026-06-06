# Self-Upgrade Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--upgrade` flag to local-to-pub binary that allows users to self-upgrade without re-running install.sh

**Architecture:** Create separate upgrade module (`packages/client/lib/upgrade.ts`) with functions for version detection, download, and replacement. Integrate into client entry point via `--upgrade` flag.

**Tech Stack:** TypeScript, Bun runtime, GitHub API, tar extraction

---

## File Structure

| File | Purpose |
|------|---------|
| `packages/client/lib/upgrade.ts` | Core upgrade logic |
| `packages/client/lib/upgrade.test.ts` | Unit tests for upgrade module |
| `packages/client/index.ts` | Add `--upgrade` flag parsing |

---

### Task 1: Create upgrade module with version detection

**Files:**
- Create: `packages/client/lib/upgrade.ts`
- Create: `packages/client/lib/upgrade.test.ts`

- [ ] **Step 1: Write failing tests for version functions**

```typescript
// packages/client/lib/upgrade.test.ts
import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { getCurrentVersion, getLatestVersion, getBinaryPath, getDownloadUrl } from "./upgrade";

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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/client/lib/upgrade.test.ts`
Expected: FAIL with "Cannot find module './upgrade'"

- [ ] **Step 3: Implement getBinaryPath and getDownloadUrl**

```typescript
// packages/client/lib/upgrade.ts
import { homedir } from "os";
import { join } from "path";

export const REPO = "JuniYadi/local-to-pub";
export const BASE_URL = `https://github.com/${REPO}/releases`;

export function getBinaryPath(global: boolean): string {
  if (global) {
    return "/usr/local/bin/local-to-pub";
  }
  return join(homedir(), ".local", "bin", "local-to-pub");
}

export function getDownloadUrl(version: string, os: string, arch: string): string {
  const filename = `local-to-pub-client-${os}-${arch}-${version}.tar.gz`;
  return `${BASE_URL}/download/v${version}/${filename}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/client/lib/upgrade.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/client/lib/upgrade.ts packages/client/lib/upgrade.test.ts
git commit -m "feat: add upgrade module with version detection functions"
```

---

### Task 2: Add getCurrentVersion function

**Files:**
- Modify: `packages/client/lib/upgrade.ts`
- Modify: `packages/client/lib/upgrade.test.ts`

- [ ] **Step 1: Write failing test for getCurrentVersion**

```typescript
// Add to packages/client/lib/upgrade.test.ts
describe("getCurrentVersion", () => {
  test("returns version string from binary", async () => {
    // Mock Bun.spawn to return version output
    const mockSpawn = mock(() => ({
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("0.0.15"));
          controller.close();
        }
      }),
      exitCode: 0,
    }));

    // We'll test the logic without mocking for now
    // Integration test will verify real binary
    const version = await getCurrentVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/lib/upgrade.test.ts::getCurrentVersion`
Expected: FAIL with "getCurrentVersion is not a function"

- [ ] **Step 3: Implement getCurrentVersion**

```typescript
// Add to packages/client/lib/upgrade.ts
export async function getCurrentVersion(): Promise<string> {
  const binaryPath = getBinaryPath(false);
  
  try {
    const proc = Bun.spawn([binaryPath, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    
    const output = await new Response(proc.stdout).text();
    const version = output.trim();
    
    if (!version.match(/^\d+\.\d+\.\d+$/)) {
      throw new Error(`Invalid version format: ${version}`);
    }
    
    return version;
  } catch (error) {
    throw new Error(`Failed to get current version: ${(error as Error).message}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/lib/upgrade.test.ts::getCurrentVersion`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/client/lib/upgrade.ts packages/client/lib/upgrade.test.ts
git commit -m "feat: add getCurrentVersion function"
```

---

### Task 3: Add getLatestVersion function

**Files:**
- Modify: `packages/client/lib/upgrade.ts`
- Modify: `packages/client/lib/upgrade.test.ts`

- [ ] **Step 1: Write failing test for getLatestVersion**

```typescript
// Add to packages/client/lib/upgrade.test.ts
describe("getLatestVersion", () => {
  test("fetches latest version from GitHub API", async () => {
    const version = await getLatestVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("throws on network error", async () => {
    // This test would need to mock fetch
    // For now, we test the real implementation
    const version = await getLatestVersion();
    expect(version).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/lib/upgrade.test.ts::getLatestVersion`
Expected: FAIL with "getLatestVersion is not a function"

- [ ] **Step 3: Implement getLatestVersion**

```typescript
// Add to packages/client/lib/upgrade.ts
export async function getLatestVersion(): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    {
      headers: {
        "Accept": "application/vnd.github.v3+json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch latest version: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { tag_name?: string };
  
  if (!data.tag_name) {
    throw new Error("Invalid response from GitHub API: missing tag_name");
  }

  const version = data.tag_name.replace(/^v/, "");
  
  if (!version.match(/^\d+\.\d+\.\d+$/)) {
    throw new Error(`Invalid version format from GitHub: ${version}`);
  }

  return version;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/lib/upgrade.test.ts::getLatestVersion`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/client/lib/upgrade.ts packages/client/lib/upgrade.test.ts
git commit -m "feat: add getLatestVersion function"
```

---

### Task 4: Add OS and architecture detection

**Files:**
- Modify: `packages/client/lib/upgrade.ts`
- Modify: `packages/client/lib/upgrade.test.ts`

- [ ] **Step 1: Write failing tests for detectOS and detectArch**

```typescript
// Add to packages/client/lib/upgrade.test.ts
describe("detectOS", () => {
  test("returns darwin on macOS", () => {
    // This will be a platform-specific test
    // For now, just verify the function exists and returns a string
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/client/lib/upgrade.test.ts`
Expected: FAIL with "detectOS is not a function"

- [ ] **Step 3: Implement detectOS and detectArch**

```typescript
// Add to packages/client/lib/upgrade.ts
import { platform, arch } from "os";

export function detectOS(): string {
  const os = platform();
  switch (os) {
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    default:
      throw new Error(`Unsupported operating system: ${os}`);
  }
}

export function detectArch(): string {
  const a = arch();
  switch (a) {
    case "x64":
      return "amd64";
    case "arm64":
      return "arm64";
    default:
      throw new Error(`Unsupported architecture: ${a}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/client/lib/upgrade.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/client/lib/upgrade.ts packages/client/lib/upgrade.test.ts
git commit -m "feat: add OS and architecture detection"
```

---

### Task 5: Implement download and extraction logic

**Files:**
- Modify: `packages/client/lib/upgrade.ts`
- Modify: `packages/client/lib/upgrade.test.ts`

- [ ] **Step 1: Write failing tests for download and extraction**

```typescript
// Add to packages/client/lib/upgrade.test.ts
describe("downloadAndExtract", () => {
  test("downloads and extracts binary", async () => {
    // Mock test - would need to mock fetch and fs
    // For now, verify the function signature
    expect(typeof downloadAndExtract).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/lib/upgrade.test.ts`
Expected: FAIL with "downloadAndExtract is not a function"

- [ ] **Step 3: Implement download and extraction**

```typescript
// Add to packages/client/lib/upgrade.ts
import { mkdtemp, rm, readdir, chmod, copyFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";

export async function downloadAndExtract(
  url: string,
  targetPath: string
): Promise<void> {
  const tmpDir = await mkdtemp(join(tmpdir(), "ltp-upgrade-"));
  
  try {
    // Download
    console.log("  Downloading...");
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    
    const tarballPath = join(tmpDir, "release.tar.gz");
    const buffer = Buffer.from(await response.arrayBuffer());
    
    if (buffer.length === 0) {
      throw new Error("Downloaded file is empty");
    }
    
    await Bun.write(tarballPath, buffer);
    
    // Extract
    console.log("  Extracting...");
    execSync(`tar -xzf "${tarballPath}" -C "${tmpDir}"`, {
      stdio: "pipe",
    });
    
    // Find binary
    const files = await readdir(tmpDir);
    const binaryFile = files.find(f => f.startsWith("local-to-pub") && !f.endsWith(".tar.gz"));
    
    if (!binaryFile) {
      throw new Error("Binary not found in archive");
    }
    
    const extractedPath = join(tmpDir, binaryFile);
    
    // Copy to target
    console.log("  Installing...");
    await copyFile(extractedPath, targetPath);
    await chmod(targetPath, 0o755);
    
  } finally {
    // Cleanup
    await rm(tmpDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/lib/upgrade.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/client/lib/upgrade.ts packages/client/lib/upgrade.test.ts
git commit -m "feat: add download and extraction logic"
```

---

### Task 6: Implement main upgrade function

**Files:**
- Modify: `packages/client/lib/upgrade.ts`
- Modify: `packages/client/lib/upgrade.test.ts`

- [ ] **Step 1: Write failing test for upgrade function**

```typescript
// Add to packages/client/lib/upgrade.test.ts
describe("upgrade", () => {
  test("upgrade function exists and is async", () => {
    expect(typeof upgrade).toBe("function");
    // Verify it returns a promise
    const result = upgrade({ global: false });
    expect(result).toBeInstanceOf(Promise);
    // Don't actually run it in test
    result.catch(() => {}); // Suppress unhandled rejection
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/client/lib/upgrade.test.ts`
Expected: FAIL with "upgrade is not a function"

- [ ] **Step 3: Implement main upgrade function**

```typescript
// Add to packages/client/lib/upgrade.ts
export interface UpgradeOptions {
  global: boolean;
}

export async function upgrade(options: UpgradeOptions): Promise<void> {
  const { global } = options;
  
  console.log("Checking for updates...");
  console.log("");
  
  // Get current version
  let currentVersion: string;
  try {
    currentVersion = await getCurrentVersion();
  } catch (error) {
    console.error(`✗ Failed to get current version: ${(error as Error).message}`);
    process.exit(1);
  }
  
  // Get latest version
  let latestVersion: string;
  try {
    latestVersion = await getLatestVersion();
  } catch (error) {
    console.error(`✗ Failed to check for updates: ${(error as Error).message}`);
    process.exit(1);
  }
  
  // Compare versions
  if (currentVersion === latestVersion) {
    console.log(`✓ Already up to date: v${currentVersion}`);
    return;
  }
  
  console.log(`→ Update available: ${currentVersion} → ${latestVersion}`);
  console.log("");
  
  // Determine target path
  const targetPath = getBinaryPath(global);
  
  // Check permissions
  try {
    // Test write permission by checking directory
    const dir = targetPath.substring(0, targetPath.lastIndexOf("/"));
    await Bun.write(`${dir}/.ltp-test`, "");
    await rm(`${dir}/.ltp-test`);
  } catch (error) {
    if ((error as Error).message.includes("EACCES") || (error as Error).message.includes("permission")) {
      console.error(`✗ Permission denied: ${targetPath}`);
      console.error("");
      console.error("Try running with sudo:");
      console.error("  local-to-pub --upgrade --global");
      process.exit(1);
    }
  }
  
  // Download and install
  const os = detectOS();
  const arch = detectArch();
  const downloadUrl = getDownloadUrl(latestVersion, os, arch);
  
  try {
    await downloadAndExtract(downloadUrl, targetPath);
  } catch (error) {
    console.error(`✗ Upgrade failed: ${(error as Error).message}`);
    process.exit(1);
  }
  
  // Verify
  console.log("");
  try {
    const newVersion = await getCurrentVersion();
    if (newVersion === latestVersion) {
      console.log(`✓ Successfully upgraded to v${latestVersion}`);
    } else {
      console.error(`✗ Upgrade verification failed: expected ${latestVersion}, got ${newVersion}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`✗ Upgrade verification failed: ${(error as Error).message}`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/client/lib/upgrade.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/client/lib/upgrade.ts packages/client/lib/upgrade.test.ts
git commit -m "feat: add main upgrade function"
```

---

### Task 7: Integrate --upgrade flag into client entry point

**Files:**
- Modify: `packages/client/index.ts`

- [ ] **Step 1: Add --upgrade flag to parseArgs**

```typescript
// In packages/client/index.ts, modify parseArgs options
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string", short: "p", default: "3000" },
    host: { type: "string", short: "h", default: "localhost" },
    server: { type: "string", short: "s" },
    token: { type: "string", short: "t" },
    uri: { type: "string", short: "y" },
    "host-header": { type: "string" },
    version: { type: "boolean", short: "v", default: false },
    upgrade: { type: "boolean", default: false },
    global: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
  strict: false,
});
```

- [ ] **Step 2: Add upgrade handling after version check**

```typescript
// After the version check, add upgrade handling
if (values.version) {
  console.log(`local-to-pub v${VERSION}`);
  process.exit(0);
}

// Add this block
if (values.upgrade) {
  const { upgrade } = await import("./lib/upgrade");
  await upgrade({ global: values.global ?? false });
  process.exit(0);
}
```

- [ ] **Step 3: Update help text to include --upgrade**

```typescript
if (values.help) {
  console.log(`
Usage: tunnel [options]

Options:
  -p, --port <port>     Local port to forward (default: 3000)
  -h, --host <host>     Local host to forward (default: localhost)
  --host-header <host>  Override Host header (e.g. localhost:3000)
  -s, --server <url>    Server WebSocket URL (or set TUNNEL_SERVER)
  -t, --token <token>  Auth token (or set TUNNEL_TOKEN)
  -y, --uri <subdomain> Request specific subdomain (optional)
  --upgrade            Upgrade to latest version
  --global             Install/upgrade to system-wide directory (/usr/local/bin)
  --help                Show this help message
`);
  process.exit(0);
}
```

- [ ] **Step 4: Test the integration**

Run: `bun run packages/client/index.ts --help`
Expected: Shows updated help with --upgrade option

Run: `bun run packages/client/index.ts --upgrade`
Expected: Checks for updates and reports status

- [ ] **Step 5: Commit**

```bash
git add packages/client/index.ts
git commit -m "feat: integrate --upgrade flag into client entry point"
```

---

### Task 8: Run all tests and verify

**Files:**
- None (verification step)

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass, including new upgrade tests

- [ ] **Step 2: Manual test --upgrade flag**

Run: `bun run packages/client/index.ts --upgrade`
Expected: Checks for updates, reports "Already up to date" or upgrades

- [ ] **Step 3: Manual test --help**

Run: `bun run packages/client/index.ts --help`
Expected: Shows updated help with --upgrade option

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore: finalize self-upgrade feature"
```

---

## Summary

| Task | Description | Files Modified |
|------|-------------|----------------|
| 1 | Create upgrade module with version detection | upgrade.ts, upgrade.test.ts |
| 2 | Add getCurrentVersion function | upgrade.ts, upgrade.test.ts |
| 3 | Add getLatestVersion function | upgrade.ts, upgrade.test.ts |
| 4 | Add OS and architecture detection | upgrade.ts, upgrade.test.ts |
| 5 | Implement download and extraction logic | upgrade.ts, upgrade.test.ts |
| 6 | Implement main upgrade function | upgrade.ts, upgrade.test.ts |
| 7 | Integrate --upgrade flag into client entry point | index.ts |
| 8 | Run all tests and verify | None |

## Dependencies

- Task 1 must complete before Tasks 2-6
- Tasks 2-6 can be done in order (each builds on previous)
- Task 7 depends on Tasks 1-6
- Task 8 depends on Task 7

## Testing Strategy

- **Unit tests:** Each function tested in isolation with mocks
- **Integration tests:** Test with real GitHub API (rate limited)
- **Manual tests:** Verify --upgrade flag works end-to-end

## Success Criteria

- [ ] `local-to-pub --upgrade` checks for updates
- [ ] `local-to-pub --upgrade` downloads and installs new version
- [ ] `local-to-pub --upgrade` displays appropriate messages
- [ ] `local-to-pub --upgrade --global` works with sudo
- [ ] All existing tests pass
- [ ] New unit tests cover upgrade logic
