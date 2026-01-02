# Installation Guide

This guide covers how to set up `local-to-pub` on an Ubuntu server, including building the binaries and configuring Caddy with Cloudflare DNS for automatic wildcard SSL.

## 1. Install Bun

First, install Bun, the JavaScript runtime used to build and run the project.

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

Verify the installation:
```bash
bun --version
```

## 2. Build the Binaries

Clone the repository and build the server and client binaries.

```bash
# Install dependencies
bun install

# Build the server binary
bun run build:server
# Output: ./server-bin

# Build the client binary
bun run build:client
# Output: ./client-bin
```

## 3. Install Custom Caddy (with Cloudflare DNS)

We need a custom build of Caddy to support Cloudflare DNS challenges for wildcard certificates.

### Step 3.1: Install Standard Caddy (Ubuntu/Debian)

First, install the standard Caddy package to get the systemd service and default configuration.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### Step 3.2: Build Custom Binary with Docker

Use the provided `Dockerfile.caddy` to build the custom binary.

```bash
# Build the Docker image
docker build -f Dockerfile.caddy -t custom-caddy .

# Extract the binary
id=$(docker create custom-caddy)
docker cp $id:/usr/bin/caddy ./caddy-custom
docker rm -v $id
chmod +x ./caddy-custom
```

### Step 3.3: Replace System Binary using dpkg-divert

We'll use `dpkg-divert` to safely replace the system binary. This ensures that `apt upgrade` won't overwrite our custom binary.

```bash
# Divert the original caddy binary
sudo dpkg-divert --divert /usr/bin/caddy.default --rename /usr/bin/caddy

# Move our custom binary to the system location
sudo mv ./caddy-custom /usr/bin/caddy

# Set capabilities (needed for binding to ports 80/443)
sudo setcap cap_net_bind_service=+ep /usr/bin/caddy
```

Now, the system `caddy` service will use your custom binary.

## 4. Configure Caddy

We'll use a standard `Caddyfile` with environment variables for the secret token.

### Step 4.1: Update Caddyfile

Edit `/etc/caddy/Caddyfile`:

```bash
sudo nano /etc/caddy/Caddyfile
```

Add your configuration. Note `{env.CLOUDFLARE_API_TOKEN}` which reads from the environment variable.

```caddy
{
    email your-email@example.com
}

*.your-domain.com {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }

    reverse_proxy localhost:3000
}
```

### Step 4.2: Configure Environment Variables

The best place to put environment variables for a systemd service is in an override file. This is safer than global variables and specific to the service.

```bash
# Create the override file
sudo systemctl edit caddy
```

This will open an editor. Paste the following:

```ini
[Service]
Environment="CLOUDFLARE_API_TOKEN=your_token_here"
```

Save and exit.

### Step 4.3: Restart Caddy

Reload systemd and restart Caddy to apply changes.

```bash
sudo systemctl daemon-reload
sudo systemctl restart caddy
```

## 5. Running the Service

### Step 5.1: Start the Application Server

Run the server binary (you might want to use a systemd service for persistence).

```bash
# Set environment variables
export PORT=3000
export BASE_DOMAIN=your-domain.com
export REDIS_URL=redis://localhost:6379

# Run the server
./server-bin
```
