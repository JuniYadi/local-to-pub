import packageJson from "../../../package.json";

declare const VERSION: string | undefined;

export function getAppVersion(): string {
  if (typeof VERSION !== "undefined" && VERSION) {
    return VERSION;
  }

  return packageJson.version;
}

export function parseVersionOutput(output: string): string {
  const trimmed = output.trim();
  const match = trimmed.match(/(\d+\.\d+\.\d+)/);

  if (!match) {
    throw new Error(`Invalid version format: ${trimmed}`);
  }

  return match[1];
}
