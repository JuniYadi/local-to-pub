#!/usr/bin/env bash
set -e

VERSION=$(bun -e 'const pkg = await import("./package.json", { with: { type: "json" } }); console.log(pkg.default.version);')

bun build ./packages/client/index.ts --compile --define VERSION="'${VERSION}'" --outfile client-bin
