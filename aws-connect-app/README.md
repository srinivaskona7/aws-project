# AWS Connect Terminal App

A high-performance, VS Code-inspired web terminal built with **xterm.js**, **Socket.io**, and **node-pty**. Designed for a decoupled architecture where the frontend can be hosted on **GitHub Pages** and the backend runs on **AWS**.

## 🚀 Quick Start

### 1. Run the Backend (Docker)

The backend provides a real Ubuntu terminal with `aws-cli` and `ssh` pre-installed.

#### Prerequisites (Amazon Linux 2 / 2023)

If Docker is not running on your instance, run these commands first:

```bash
sudo yum update -y
sudo yum install docker -y
sudo service docker start
sudo usermod -a -G docker ec2-user
sudo systemctl enable docker
```

_Note: You may need to log out and back in for group changes to take effect, or just run as root._

#### Start Container

```bash
docker run -d -p 8099:8099 --name terminal-backend sriniv7654/aws-app-ui:v4
```

### 2. Run the Frontend

The frontend is a static web application.

- **Local**: Open `aws-connect-app/frontend/index.html` in your browser.
- **GitHub Pages**: Upload the contents of the `frontend/` directory to your repository and enable GitHub Pages.

### 3. Initialize Connection

1.  Once the UI loads, you will see a **Connection Modal**.
2.  Enter the **IP Address** of your backend (use `localhost` if running locally).
3.  Enter the **Port** (`8099`).
4.  Click **Connect**.

## 🛠 Features

- **Real PTY**: Full interactive bash shell (supports `top`, `vim`, etc.).
- **AWS Integration**: `aws-cli` v2 installed for cloud management.
- **Remote Access**: `openssh-client` installed for EC2 jumping.
- **File Explorer**: Browse and `cat` files from the backend filesystem directly in the UI.
- **Docker Logs**: Real-time streaming container metrics.

## 📦 Project Structure

- `frontend/`: Static assets (HTML, CSS, JS). No server-side dependencies.
- `backend/`: Node.js server with PTY support.
