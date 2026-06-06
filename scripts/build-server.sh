#!/usr/bin/env bash
set -e

# Run embed script
bun run scripts/embed-frontend.ts

# Get version from package.json
VERSION=$(bun -e 'const pkg = await import("./package.json", { with: { type: "json" } }); console.log(pkg.default.version);')

# Build server with version injected
bun build ./packages/server/index.ts --compile --define VERSION="'${VERSION}'" --outfile server-bin
