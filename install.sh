#!/bin/bash
set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Repository info
REPO="JuniYadi/local-to-pub"
BASE_URL="https://github.com/${REPO}/releases"

# Parse arguments
BINARY_TYPE=""
GLOBAL_INSTALL=false
while [[ $# -gt 0 ]]; do
  case $1 in
    --client)
      BINARY_TYPE="client"
      shift
      ;;
    --server)
      BINARY_TYPE="server"
      shift
      ;;
    --global)
      GLOBAL_INSTALL=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [OPTION]"
      echo ""
      echo "Install or update local-to-pub client or server."
      echo ""
      echo "Options:"
      echo "  --client    Install the client binary (default)"
      echo "  --server    Install the server binary"
      echo "  --global    Install to system-wide directory (/usr/local/bin)"
      echo "              (default: user-local ~/.local/bin, no sudo required)"
      echo "  -h, --help  Show this help message"
      echo ""
      echo "Examples:"
      echo "  $0 --client       # Install or update client to ~/.local/bin"
      echo "  $0 --server       # Install or update server to ~/.local/bin"
      echo "  $0 --client --global  # Install client to /usr/local/bin (requires sudo)"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Use --help to see available options"
      exit 1
      ;;
  esac
done

# Default to client if not specified
if [[ -z "$BINARY_TYPE" ]]; then
  BINARY_TYPE="client"
fi

BINARY_NAME="local-to-pub-${BINARY_TYPE}"

echo -e "${BLUE}local-to-pub Installer${NC}"
echo ""

# Detect OS
detect_os() {
  local OS=$(uname -s)
  case "$OS" in
    Linux*)
      echo "linux"
      ;;
    Darwin*)
      echo "darwin"
      ;;
    *)
      echo -e "${RED}Unsupported OS: $OS${NC}"
      exit 1
      ;;
  esac
}

# Detect architecture
detect_arch() {
  local ARCH=$(uname -m)
  case "$ARCH" in
    x86_64|amd64)
      echo "amd64"
      ;;
    aarch64|arm64)
      echo "arm64"
      ;;
    armv7l)
      echo "arm64"
      ;;
    *)
      echo -e "${RED}Unsupported architecture: $ARCH${NC}"
      exit 1
      ;;
  esac
}

OS=$(detect_os)
ARCH=$(detect_arch)

echo -e "Detected: ${GREEN}${OS} ${ARCH}${NC}"

# Validate server is only for Linux
if [[ "$BINARY_TYPE" == "server" && "$OS" != "linux" ]]; then
  echo -e "${RED}Error: Server is only available for Linux${NC}"
  exit 1
fi

# Get latest version
get_latest_version() {
  # Try to get latest release tag from GitHub API
  local VERSION=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/' | sed 's/^v//')

  if [[ -z "$VERSION" ]]; then
    echo -e "${YELLOW}Warning: Could not detect latest version from GitHub${NC}"
    echo -e "${YELLOW}Please manually verify the installation${NC}"
    echo "unknown"
  else
    echo "$VERSION"
  fi
}

LATEST_VERSION=$(get_latest_version)

# Determine install directory
if [[ "$GLOBAL_INSTALL" == true ]]; then
  INSTALL_DIR="/usr/local/bin"
  USE_SUDO=true
else
  INSTALL_DIR="${HOME}/.local/bin"
  USE_SUDO=false
  # Create user-local bin directory if it doesn't exist
  if [[ ! -d "$INSTALL_DIR" ]]; then
    mkdir -p "$INSTALL_DIR"
  fi
fi

BINARY_PATH="${INSTALL_DIR}/${BINARY_NAME}"
CURRENT_VERSION=""

if [[ -f "$BINARY_PATH" ]]; then
  # Try to get current version
  CURRENT_VERSION=$($BINARY_PATH --version 2>/dev/null || echo "unknown")

  if [[ "$CURRENT_VERSION" == "$LATEST_VERSION" ]]; then
    echo -e "${GREEN}✓ Already up to date: ${BINARY_NAME} v${CURRENT_VERSION}${NC}"
    exit 0
  else
    echo -e "${YELLOW}→ Update available: ${CURRENT_VERSION} → ${LATEST_VERSION}${NC}"
  fi
else
  echo -e "${BLUE}→ New installation${NC}"
fi

# Construct download URL
FILENAME="local-to-pub-${BINARY_TYPE}-${OS}-${ARCH}-${LATEST_VERSION}.tar.gz"
DOWNLOAD_URL="${BASE_URL}/download/v${LATEST_VERSION}/${FILENAME}"

echo -e "Downloading: ${BLUE}${FILENAME}${NC}"
echo ""

# Create temp directory
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

# Download
if ! curl -fsSL "$DOWNLOAD_URL" -o "${TMP_DIR}/${FILENAME}"; then
  echo -e "${RED}Error: Failed to download ${FILENAME}${NC}"
  echo -e "${RED}Please check your internet connection and verify the release exists${NC}"
  echo -e "${RED}URL: ${DOWNLOAD_URL}${NC}"
  exit 1
fi

# Extract
cd "$TMP_DIR"
tar -xzf "${FILENAME}"

# Verify binary exists
if [[ ! -f "$BINARY_NAME" ]]; then
  echo -e "${RED}Error: Binary not found in archive${NC}"
  exit 1
fi

# Make executable
chmod +x "$BINARY_NAME"

# Install
echo ""
if [[ "$USE_SUDO" == true ]]; then
  if [[ -f "$BINARY_PATH" ]]; then
    echo -e "${YELLOW}Updating existing installation...${NC}"
    sudo cp "$BINARY_NAME" "$BINARY_PATH"
    sudo chmod +x "$BINARY_PATH"
  else
    echo -e "${BLUE}Installing to ${INSTALL_DIR}...${NC}"
    sudo cp "$BINARY_NAME" "$BINARY_PATH"
    sudo chmod +x "$BINARY_PATH"
  fi
else
  if [[ -f "$BINARY_PATH" ]]; then
    echo -e "${YELLOW}Updating existing installation...${NC}"
    cp "$BINARY_NAME" "$BINARY_PATH"
    chmod +x "$BINARY_PATH"
  else
    echo -e "${BLUE}Installing to ${INSTALL_DIR}...${NC}"
    cp "$BINARY_NAME" "$BINARY_PATH"
    chmod +x "$BINARY_PATH"
  fi
fi

# Verify installation
if [[ ! -x "$BINARY_PATH" ]]; then
  echo -e "${RED}Error: Installation failed${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}✓ Successfully ${CURRENT_VERSION:+updated }installed ${BINARY_NAME} v${LATEST_VERSION}${NC}"
echo ""
echo -e "Binary installed at: ${BLUE}${BINARY_PATH}${NC}"
echo ""

# Show PATH warning for user-local installs
if [[ "$USE_SUDO" == false ]]; then
  # Check if ~/.local/bin is in PATH
  if [[ ":$PATH:" != *":${HOME}/.local/bin:"* ]]; then
    echo -e "${YELLOW}⚠ Warning: ${INSTALL_DIR} is not in your PATH${NC}"
    echo ""
    echo -e "To use ${BINARY_NAME} without specifying the full path, add the following to your ~/.bashrc or ~/.zshrc:"
    echo -e "${GREEN}  export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
    echo ""
    echo -e "Then run: ${GREEN}source ~/.bashrc${NC} (or ~/.zshrc)"
    echo ""
  fi
fi

# Show next steps
if [[ "$BINARY_TYPE" == "client" ]]; then
  echo -e "Next steps:"
  echo -e "  ${GREEN}local-to-pub --help${NC}    - Show available commands"
  echo ""
  echo -e "Example usage:"
  echo -e "  ${GREEN}local-to-pub tunnel --port 8080${NC}  - Expose local port 8080"
else
  echo -e "Next steps:"
  echo -e "  ${GREEN}local-to-pub-server --help${NC}    - Show available commands"
  echo ""
  echo -e "To run the server:"
  echo -e "  ${GREEN}local-to-pub-server${NC}           - Start server on default port"
  echo ""
  echo -e "See documentation for server setup and configuration"
fi

# Show installation type
if [[ -n "$CURRENT_VERSION" ]]; then
  echo ""
  echo -e "${BLUE}Installation type: Update${NC}"
  echo -e "Previous version: ${YELLOW}${CURRENT_VERSION}${NC}"
  echo -e "New version: ${GREEN}${LATEST_VERSION}${NC}"
else
  echo ""
  echo -e "${BLUE}Installation type: New installation${NC}"
  echo -e "Version: ${GREEN}${LATEST_VERSION}${NC}"
fi
