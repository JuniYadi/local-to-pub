// packages/client/lib/upgrade.ts
import { homedir, platform, arch, tmpdir } from "os";
import { join } from "path";
import { mkdtemp, rm, readdir, chmod, copyFile, mkdir } from "fs/promises";

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

export async function getCurrentVersion(): Promise<string> {
  const binaryPath = getBinaryPath(false);

  try {
    const proc = Bun.spawn([binaryPath, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const trimmed = output.trim();
    
    // Handle format like "local-to-pub v0.0.10" or just "0.0.10"
    const match = trimmed.match(/(\d+\.\d+\.\d+)/);
    if (!match) {
      throw new Error(`Invalid version format: ${trimmed}`);
    }
    
    return match[1];
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
