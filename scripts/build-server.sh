#!/usr/bin/env bash
set -e

# Run embed script
bun run scripts/embed-frontend.ts

# Get version from package.json
VERSION=$(node -p 'require("./package.json").version')

# Build server with version injected
bun build ./packages/server/index.ts --compile --define VERSION="'${VERSION}'" --outfile server-bin
