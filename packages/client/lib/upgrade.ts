// packages/client/lib/upgrade.ts
import { homedir, platform, arch, tmpdir } from "os";
import { join } from "path";
import { mkdtemp, rm, readdir, chmod, copyFile, mkdir } from "fs/promises";
import { parseVersionOutput } from "./version";

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

export async function getCurrentVersion(binaryPath = getBinaryPath(false)): Promise<string> {
  try {
    const proc = Bun.spawn([binaryPath, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    return parseVersionOutput(output);
  } catch (error) {
    throw new Error(`Failed to get current version: ${(error as Error).message}`);
  }
}

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
    const proc = Bun.spawn(["tar", "-xzf", tarballPath, "-C", tmpDir]);
    await proc.exited;
    
    // Find binary
    const files = await readdir(tmpDir);
    const binaryFile = files.find(f => f.startsWith("local-to-pub") && !f.endsWith(".tar.gz"));
    
    if (!binaryFile) {
      throw new Error("Binary not found in archive");
    }
    
    const extractedPath = join(tmpDir, binaryFile);
    
    // Ensure target directory exists
    const targetDir = targetPath.substring(0, targetPath.lastIndexOf("/"));
    await mkdir(targetDir, { recursive: true });

    // Copy to target
    console.log("  Installing...");
    await copyFile(extractedPath, targetPath);
    await chmod(targetPath, 0o755);
    
  } finally {
    // Cleanup
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export interface UpgradeOptions {
  global: boolean;
}

export async function upgrade(options: UpgradeOptions): Promise<void> {
  const { global } = options;
  
  console.log("Checking for updates...");
  console.log("");
  
  const targetPath = getBinaryPath(global);

  // Get current version
  let currentVersion: string;
  try {
    currentVersion = await getCurrentVersion(targetPath);
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
    const newVersion = await getCurrentVersion(targetPath);
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
