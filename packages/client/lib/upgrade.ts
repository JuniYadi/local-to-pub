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
