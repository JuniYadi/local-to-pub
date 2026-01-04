#!/bin/bash
set -e

# Usage: ./package.sh [version]
# If version not provided, reads from package.json

VERSION=${1:-$(node -p "require('./package.json').version")}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ARTIFACTS_DIR="$ROOT_DIR/artifacts"
RELEASE_DIR="$ROOT_DIR/release"

echo "Packaging version: $VERSION"

# Create release directory
mkdir -p "$RELEASE_DIR"

# Package each artifact
for dir in "$ARTIFACTS_DIR"/*/; do
  if [ -d "$dir" ]; then
    PLATFORM=$(basename "$dir")
    tar -czf "$RELEASE_DIR/local-to-pub-${PLATFORM}-${VERSION}.tar.gz" -C "$dir" .
    echo "Created: local-to-pub-${PLATFORM}-${VERSION}.tar.gz"
  fi
done

# Generate checksums
cd "$RELEASE_DIR"
shasum -a 256 * > checksums.txt
echo ""
echo "Checksums:"
cat checksums.txt

echo ""
echo "Release files in: $RELEASE_DIR"
