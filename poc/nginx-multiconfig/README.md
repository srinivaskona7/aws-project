# Master Operation Manual: Nginx Multi-Domain Setup

This document serves as the **Single Source of Truth** for the deployment, management, and maintenance of the Nginx Reverse Proxy hosting `sri1.srinivaskona.life` and `sri2.srinivaskona.life`.

---

## 📋 Table of Contents

1.  [Phase 1: AWS Infrastructure Provisioning](#phase-1-aws-infrastructure-provisioning)
2.  [Phase 2: Domain DNS Setup](#phase-2-domain-dns-setup)
3.  [Phase 3: System Setup (The Foundation)](#phase-3-system-setup-the-foundation)
4.  [Phase 4: Manual Configuration (The Core)](#phase-4-manual-configuration-the-core)
5.  [Phase 5: SSL Security (The Shield)](#phase-5-ssl-security-the-shield)
6.  [Phase 6: Verification](#phase-6-verification)
7.  [Appendix: Automated "Fast Track"](#appendix-automated-fast-track-the-script)
8.  [Architectural Request Flow (Visual)](#architectural-request-flow-visual)

---

## Phase 1: AWS Infrastructure Provisioning

**Goal**: Get a server running and accessible.

### 1.1 Launch EC2 Instance

1.  **Login to AWS Console** -> **EC2 Dashboard** -> **Launch Instances**.
2.  **OS Image**: Amazon Linux 2023.
3.  **Instance Type**: `t2.micro` (Free Tier).
4.  **Key Pair**: Download and save your `.pem` file.

### 1.2 Security Group (Firewall)

Configure the firewall rules to allow traffic.

| Protocol  | Port | Source             | Purpose            |
| :-------- | :--- | :----------------- | :----------------- |
| **SSH**   | 22   | My IP              | Admin Access       |
| **HTTP**  | 80   | Anywhere 0.0.0.0/0 | Web Traffic        |
| **HTTPS** | 443  | Anywhere 0.0.0.0/0 | Secure Web Traffic |

**Note**: Do **NOT** open ports 8002/8003. They remain internal.

### 1.3 SSH Connection

```bash
# Set permissions
chmod 400 aws.pem

# Connect
ssh -i aws.pem ec2-user@<YOUR_PUBLIC_IP>
```

---

## Phase 2: Domain DNS Setup

**Goal**: Point your domains to the AWS Server.

![DNS Flow](images/dns_to_server_flow.png)

1.  Log in to your **Domain Registrar** (e.g., GoDaddy, Namecheap, Route53).
2.  Add **A Records**:
    - `sri1` -> `13.233.199.126`
    - `sri2` -> `13.233.199.126`

---

## Phase 3: System Setup (The Foundation)

**Goal**: Install the necessary software.

```bash
# 1. Update System
sudo dnf update -y

# 2. Install Nginx
sudo dnf install nginx -y

# 3. Install Certbot (The SSL Robot)
sudo dnf install certbot python3-certbot-nginx -y

# 4. Start & Enable Nginx
sudo systemctl enable --now nginx
```

---

## Phase 4: Manual Configuration (The Core)

**Goal**: Create the websites for `sri1` and `sri2` manually. This is the **most important part** of understanding Nginx.

### 4.1 Understand "Slugs" (Safe Names)

We use a concept called a **Slug** — a sanitized version of a hostname.

- **Why?**: File systems dislike dots (`.`) in folder names.
- **Rule**: `sri1.srinivaskona.life` -> `sri1-srinivaskona-life`

### 4.2 Create Web Roots & HTML Content

First, create the folders where your actual website files will live.

```bash
# Create Directories (Slugs)
sudo mkdir -p /var/www/sri1-srinivaskona-life
sudo mkdir -p /var/www/sri2-srinivaskona-life

# Set Permissions
sudo chmod -R 755 /var/www

# Create Sample HTML (Content)
echo "<h1>Hello from SRI1 (Manual)</h1>" | sudo tee /var/www/sri1-srinivaskona-life/index.html
echo "<h1>Hello from SRI2 (Manual)</h1>" | sudo tee /var/www/sri2-srinivaskona-life/index.html
```

### 4.3 Create Nginx Server Blocks

Now, tell Nginx about these sites. We create **two separate config files** for cleaner architecture.

**File 1: `/etc/nginx/conf.d/sri1-srinivaskona-life.conf`**

```nginx
server {
    listen 80;
    server_name sri1.srinivaskona.life;
    root /var/www/sri1-srinivaskona-life;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

**File 2: `/etc/nginx/conf.d/sri2-srinivaskona-life.conf`**

```nginx
server {
    listen 80;
    server_name sri2.srinivaskona.life;
    root /var/www/sri2-srinivaskona-life;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

### 4.4 Verify & Reload

Check if your syntax is correct before reloading.

```bash
sudo nginx -t
# If successful:
sudo systemctl reload nginx
```

---

## Phase 5: SSL Security (The Shield)

**Goal**: Secure your sites with HTTPS (The Green Padlock).

Run Certbot manually. We use the `--nginx` flag so it automatically edits your config files to add the SSL settings.

```bash
sudo certbot --nginx -d sri1.srinivaskona.life -d sri2.srinivaskona.life
```

**What Certbot Did:**
It modified your `.conf` files to look like this:

```nginx
server {
    server_name sri1.srinivaskona.life;
    # ...
    listen 443 ssl; # Managed by Certbot
    ssl_certificate /etc/letsencrypt/live/sri1.srinivaskona.life/fullchain.pem;
    # ...
}
```

---

## Phase 6: Verification

- Visit: `https://sri1.srinivaskona.life` (Should show "Hello from SRI1")
- Visit: `https://sri2.srinivaskona.life` (Should show "Hello from SRI2")

### FAQ: IP Access

**Q: Can I access via IP?**
**A: No.** SSL certs are tied to domains, not IPs. The browser will block it or show a warning.

---

## Appendix: Automated "Fast Track" (The Script)

If you have many domains or want to skip the manual typing, use our **Automation Script**.

**🚀 One-Liner Install**

```bash
curl -sL https://raw.githubusercontent.com/srinivaskona7/aws-project/main/poc/nginx-multiconfig/automate_nginx_ssl.sh | sudo bash -s -- domain.com
```

**What the script does for you:**

1.  **Installs** Nginx/Certbot (Phase 3).
2.  **Creates** Web Roots & HTML (Phase 4.2).
3.  **Configures** Nginx with Slugs (Phase 4.3).
4.  **Secures** with SSL (Phase 5).
5.  **Verifies** Setup (Phase 6).

It produces the exact same result as the manual steps above, instantly.

---

## Architectural Request Flow (Visual)

This diagram illustrates exactly how a request for `sri1` is routed differently from `sri2`.

![Professional Request Lifecycle](images/professional_request_lifecycle_architecture.png)

### The Journey Step-by-Step

1.  **User Input**: User types `https://sri1.srinivaskona.life`.
2.  **Encrypted Tunnel**: The request hits Nginx on **Port 443**.
3.  **SNI (Server Name Indication)**: Nginx reads the encrypted header to see the target is `sri1`.
4.  **Routing Decision**: Nginx checks its config: "Ah, `sri1` goes to local port 8002".
5.  **Proxing**: Nginx serves the file from `/var/www/sri1...`.
6.  **Response**: Nginx replies to User.

---

**Maintained By**: DevOps Team
**Docs Location**: `/home/ec2-user/docs/`
