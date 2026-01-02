// Build script to pre-build frontend and embed in binary
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const SERVER_DIR = join(PROJECT_ROOT, "packages/server");
const STATIC_DIR = join(SERVER_DIR, "static");

async function buildAndEmbed() {
  console.log("Building frontend...");

  // Ensure static directory exists
  if (!existsSync(STATIC_DIR)) {
    mkdirSync(STATIC_DIR, { recursive: true });
  }

  // Build the frontend
  const build = await Bun.build({
    entrypoints: [join(SERVER_DIR, "frontend.tsx")],
    outdir: STATIC_DIR,
    target: "browser",
    minify: true,
    sourcemap: "none",
  });

  if (!build.success) {
    console.error("Frontend build failed:");
    for (const log of build.logs) {
      console.error(log.message);
    }
    process.exit(1);
  }

  console.log("Frontend built successfully.");

  // Read the built files and embed them
  const assets: { js?: string; css?: string } = {};
  const output = build.outputs;

  for (const file of output) {
    const name = file.path.split("/").pop() ?? file.path;
    const content = await file.arrayBuffer();
    const hex = Buffer.from(content).toString("hex");

    if (name.endsWith(".js")) {
      assets.js = hex;
    } else if (name.endsWith(".css")) {
      assets.css = hex;
    }
  }

  if (!assets.js || !assets.css) {
    console.error("Missing frontend assets (JS or CSS)");
    process.exit(1);
  }

  // Also read and embed the HTML file
  const htmlPath = join(SERVER_DIR, "index.html");
  const htmlContent = readFileSync(htmlPath, "utf-8");
  const htmlHex = Buffer.from(htmlContent).toString("hex");

  // Generate embedded assets file
  const embeddedCode = `// Auto-generated - DO NOT EDIT
// This file embeds pre-built frontend assets for binary distribution

export const embeddedFrontendJs = Buffer.from("${assets.js}", "hex");
export const embeddedFrontendCss = Buffer.from("${assets.css}", "hex");
export const embeddedFrontendHtml = Buffer.from("${htmlHex}", "hex");
`;

  writeFileSync(join(SERVER_DIR, "lib", "embedded-frontend.ts"), embeddedCode);
  console.log("Embedded frontend assets written to lib/embedded-frontend.ts");
}

buildAndEmbed();
