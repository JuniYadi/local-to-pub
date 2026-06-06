# Self-Upgrade Feature Design

**Date:** 2026-06-06
**Status:** Draft
**Author:** Juni Yadi

## Overview

Add `--upgrade` flag to `local-to-pub` binary that allows users to self-upgrade the binary without re-running `install.sh`.

## Problem

Currently, users must manually run `install.sh` to upgrade. This is friction for users who want to stay up-to-date.

## Solution

Add `--upgrade` flag to the binary itself. When invoked, it:
1. Checks current version
2. Gets latest version from GitHub releases
3. Downloads and replaces the binary if newer version exists

## CLI Interface

```bash
local-to-pub --upgrade [--global]
```

- `--upgrade`: Check and upgrade binary
- `--global`: Upgrade binary in `/usr/local/bin` (requires sudo)
- Default (no `--global`): Upgrade binary in `~/.local/bin`

## Architecture

### Module: `packages/client/lib/upgrade.ts`

```typescript
interface UpgradeOptions {
  global: boolean
}

export async function upgrade(options: UpgradeOptions): Promise<void>
export async function getCurrentVersion(): Promise<string>
export async function getLatestVersion(): Promise<string>
export function getBinaryPath(global: boolean): string
export function getDownloadUrl(version: string, os: string, arch: string): string
export function getTempDir(): string
```

### Integration: `packages/client/index.ts`

Add `--upgrade` flag parsing:

```typescript
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    // ... existing options
    upgrade: { type: "boolean", default: false },
  },
});

if (values.upgrade) {
  await upgrade({ global: values.global });
  process.exit(0);
}
```

## Upgrade Flow

### Step 1: Detect Current Version

```typescript
export async function getCurrentVersion(): Promise<string> {
  const binaryPath = getBinaryPath(false); // Current binary location
  const proc = Bun.spawn([binaryPath, "--version"]);
  const output = await new Response(proc.stdout).text();
  return output.trim();
}
```

### Step 2: Get Latest Version

```typescript
export async function getLatestVersion(): Promise<string> {
  const response = await fetch(
    "https://api.github.com/repos/JuniYadi/local-to-pub/releases/latest"
  );
  const data = await response.json();
  return data.tag_name.replace(/^v/, "");
}
```

### Step 3: Compare Versions

```typescript
if (currentVersion === latestVersion) {
  console.log(`✓ Already up to date: v${currentVersion}`);
  process.exit(0);
}
console.log(`→ Update available: ${currentVersion} → ${latestVersion}`);
```

### Step 4: Download

```typescript
const filename = `local-to-pub-client-${os}-${arch}-${version}.tar.gz`;
const url = `https://github.com/JuniYadi/local-to-pub/releases/download/v${version}/${filename}`;
const tmpDir = mktemp();
await download(url, `${tmpDir}/${filename}`);
```

### Step 5: Extract & Replace

```typescript
const tmpDir = mktemp();
await extract(`${tmpDir}/${filename}`);
const extractedBinary = findBinary(tmpDir);
await replaceBinary(extractedBinary, targetPath);
cleanup(tmpDir);
```

### Step 6: Verify

```typescript
const newVersion = await getVersionFromBinary(targetPath);
if (newVersion === latestVersion) {
  console.log(`✓ Successfully upgraded to v${latestVersion}`);
} else {
  console.error("✗ Upgrade verification failed");
  process.exit(1);
}
```

## Error Handling

| Error | Handling |
|-------|----------|
| Network error | Display error message, exit 1 |
| Permission denied | Suggest `--global` with sudo |
| Binary not found | Display error, exit 1 |
| Invalid version | Display error, exit 1 |
| Download failed | Display error, exit 1 |

## Edge Cases

- **Binary currently running**: Safe on Unix/Linux (file descriptor points to old inode)
- **Concurrent upgrades**: No locking mechanism (race condition unlikely)
- **Corrupted download**: Verify file exists and is non-empty (checksum optional, can add later)
- **No internet**: Display error message
- **Old binary name**: Handle migration from `local-to-pub-client` to `local-to-pub`

## Testing

### Unit Tests: `packages/client/lib/upgrade.test.ts`

- `getCurrentVersion()` — parse version from binary output
- `getLatestVersion()` — mock GitHub API response
- `getDownloadUrl()` — construct URL correctly
- `getBinaryPath()` — return correct path based on --global flag
- Version comparison logic
- Error handling (network error, permission denied)

### Test Strategy

- Mock `fetch` to avoid real network calls
- Mock `Bun.spawn` to avoid executing real binary
- Mock file system operations for extract/replace

## Migration

No migration needed. New feature is additive.

## Success Criteria

1. `local-to-pub --upgrade` checks for updates
2. `local-to-pub --upgrade` downloads and installs new version
3. `local-to-pub --upgrade` displays appropriate messages
4. `local-to-pub --upgrade --global` works with sudo
5. All existing tests pass
6. New unit tests cover upgrade logic

## Future Considerations

- **Checksum verification**: Add SHA256 verification for downloaded files
- **Changelog display**: Show release notes during upgrade
- **Auto-upgrade**: Check for updates on startup (opt-in)
- **Channel selection**: Support stable/beta/nightly channels
