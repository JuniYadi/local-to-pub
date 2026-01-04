# Download & Installation

Choose the right binary for your system and follow the installation steps below.

## Client Installation

The client is used to create tunnels from your local machine to a local-to-pub server.

### Linux (AMD64/Intel)

```bash
# Download
curl -LO https://github.com/JuniYadi/local-to-pub/releases/latest/download/local-to-pub-client-linux-amd64.tar.gz

# Extract
tar -xzf local-to-pub-client-linux-amd64.tar.gz

# Make executable
chmod +x local-to-pub-client

# Optional: Move to PATH
sudo mv local-to-pub-client /usr/local/bin/local-to-pub
```

### Linux (ARM64)

```bash
# Download
curl -LO https://github.com/JuniYadi/local-to-pub/releases/latest/download/local-to-pub-client-linux-arm64.tar.gz

# Extract
tar -xzf local-to-pub-client-linux-arm64.tar.gz

# Make executable
chmod +x local-to-pub-client

# Optional: Move to PATH
sudo mv local-to-pub-client /usr/local/bin/local-to-pub
```

### macOS (Apple Silicon - M1/M2/M3)

```bash
# Download
curl -LO https://github.com/JuniYadi/local-to-pub/releases/latest/download/local-to-pub-client-darwin-arm64.tar.gz

# Extract
tar -xzf local-to-pub-client-darwin-arm64.tar.gz

# Make executable
chmod +x local-to-pub-client

# Optional: Move to PATH
sudo mv local-to-pub-client /usr/local/bin/local-to-pub
```

### macOS (Intel)

```bash
# Download
curl -LO https://github.com/JuniYadi/local-to-pub/releases/latest/download/local-to-pub-client-darwin-amd64.tar.gz

# Extract
tar -xzf local-to-pub-client-darwin-amd64.tar.gz

# Make executable
chmod +x local-to-pub-client

# Optional: Move to PATH
sudo mv local-to-pub-client /usr/local/bin/local-to-pub
```

---

## Server Installation

The server manages tunnels and provides the web interface. Server is only available for Linux.

### Linux (AMD64/Intel)

```bash
# Download
curl -LO https://github.com/JuniYadi/local-to-pub/releases/latest/download/local-to-pub-server-linux-amd64.tar.gz

# Extract
tar -xzf local-to-pub-server-linux-amd64.tar.gz

# Make executable
chmod +x local-to-pub-server

# Optional: Move to PATH
sudo mv local-to-pub-server /usr/local/bin/local-to-pub-server
```

### Linux (ARM64)

```bash
# Download
curl -LO https://github.com/JuniYadi/local-to-pub/releases/latest/download/local-to-pub-server-linux-arm64.tar.gz

# Extract
tar -xzf local-to-pub-server-linux-arm64.tar.gz

# Make executable
chmod +x local-to-pub-server

# Optional: Move to PATH
sudo mv local-to-pub-server /usr/local/bin/local-to-pub-server
```

---

## Verify Download (Recommended)

For security, verify the integrity of your downloaded file:

```bash
# Download checksums
curl -LO https://github.com/JuniYadi/local-to-pub/releases/latest/download/checksums.txt

# Verify client
shasum -a 256 local-to-pub-client-linux-amd64.tar.gz | grep -q $(cat checksums.txt | grep local-to-pub-client-linux-amd64.tar.gz | awk '{print $1}')

# Verify server
shasum -a 256 local-to-pub-server-linux-amd64.tar.gz | grep -q $(cat checksums.txt | grep local-to-pub-server-linux-amd64.tar.gz | awk '{print $1}')

# Check exit code: 0 = verified, 1 = verification failed
echo $?
```

## Version-Specific Install

To download a specific version, replace `latest` with the version tag (e.g., `v0.0.2`):

```bash
# Client
curl -LO https://github.com/JuniYadi/local-to-pub/releases/download/v0.0.2/local-to-pub-client-linux-amd64.tar.gz

# Server
curl -LO https://github.com/JuniYadi/local-to-pub/releases/download/v0.0.2/local-to-pub-server-linux-amd64.tar.gz
```

## What's Included

| Binary | Description | Platforms |
|--------|-------------|-----------|
| `local-to-pub-client` | CLI client to create tunnels from local machine | Linux, macOS |
| `local-to-pub-server` | Server binary that manages tunnels (self-hosted) | Linux only |

**Note:** The server binary is only available for Linux due to embedded frontend dependencies.

## System Requirements

- **Linux**: Any distribution (Ubuntu, Debian, Fedora, Arch, etc.)
- **macOS**: 10.15+ (Catalina or later)
- **Architecture**: AMD64/Intel or ARM64 (Apple Silicon, Raspberry Pi, etc.)

## Next Steps

After installation:

- **Client**: Run `local-to-pub --help` to see available commands
- **Server**: See [Server Setup](./server-setup.md) for deploying the server

## Troubleshooting

### Permission Denied

If you get "Permission denied" when running the binary:

```bash
chmod +x local-to-pub-client
chmod +x local-to-pub-server
```

### Not Found Command

After moving to PATH, if the command is not found:

```bash
# Refresh your shell
source ~/.bashrc  # or ~/.zshrc for zsh users

# Or use the full path
/usr/local/bin/local-to-pub --help
```

### Checking Architecture

To find your system architecture:

```bash
# Linux/macOS
uname -m

# Output:
# x86_64   → Use amd64
# aarch64  → Use arm64
# armv7l   → Use arm64 (mostly compatible)
```
