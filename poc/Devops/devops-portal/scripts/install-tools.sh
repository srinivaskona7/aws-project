#!/bin/bash
# Install DevOps tools on Amazon Linux 2 / Ubuntu
set -e

echo "=== DevOps Portal - Tool Installer ==="
OS=$(cat /etc/os-release | grep ^ID= | cut -d= -f2 | tr -d '"')
echo "Detected OS: $OS"

install_amazon_linux() {
    echo "[INFO] Installing on Amazon Linux 2..."
    sudo yum update -y
    sudo yum install -y curl wget git unzip jq python3

    # AWS CLI v2
    if ! command -v aws &>/dev/null; then
        curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
        unzip -q /tmp/awscliv2.zip -d /tmp
        sudo /tmp/aws/install
        echo "[✓] AWS CLI installed: $(aws --version)"
    fi

    # Node.js 18
    if ! command -v node &>/dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
        sudo yum install -y nodejs
        echo "[✓] Node.js installed: $(node --version)"
    fi

    # Docker
    if ! command -v docker &>/dev/null; then
        sudo amazon-linux-extras install docker -y
        sudo systemctl start docker
        sudo systemctl enable docker
        sudo usermod -aG docker ec2-user
        echo "[✓] Docker installed: $(docker --version)"
    fi

    # kubectl
    if ! command -v kubectl &>/dev/null; then
        curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
        sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
        rm kubectl
        echo "[✓] kubectl installed: $(kubectl version --client --short 2>/dev/null)"
    fi

    # Helm
    if ! command -v helm &>/dev/null; then
        curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
        echo "[✓] Helm installed: $(helm version --short)"
    fi

    # eksctl
    if ! command -v eksctl &>/dev/null; then
        curl --silent --location "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_Linux_amd64.tar.gz" | tar xz -C /tmp
        sudo mv /tmp/eksctl /usr/local/bin
        echo "[✓] eksctl installed: $(eksctl version)"
    fi

    # Terraform
    if ! command -v terraform &>/dev/null; then
        sudo yum install -y yum-utils
        sudo yum-config-manager --add-repo https://rpm.releases.hashicorp.com/AmazonLinux/hashicorp.repo
        sudo yum install -y terraform
        echo "[✓] Terraform installed: $(terraform version -json | jq -r .terraform_version)"
    fi
}

install_ubuntu() {
    echo "[INFO] Installing on Ubuntu..."
    sudo apt-get update -y
    sudo apt-get install -y curl wget git unzip jq python3 python3-pip

    # AWS CLI v2
    if ! command -v aws &>/dev/null; then
        curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
        unzip -q /tmp/awscliv2.zip -d /tmp
        sudo /tmp/aws/install
    fi

    # Node.js 18
    if ! command -v node &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi

    # Docker
    if ! command -v docker &>/dev/null; then
        sudo apt-get install -y docker.io
        sudo systemctl start docker
        sudo systemctl enable docker
        sudo usermod -aG docker ubuntu
    fi

    # kubectl
    if ! command -v kubectl &>/dev/null; then
        curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
        sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
        rm kubectl
    fi

    # Helm
    if ! command -v helm &>/dev/null; then
        curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
    fi

    # eksctl
    if ! command -v eksctl &>/dev/null; then
        curl --silent --location "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_Linux_amd64.tar.gz" | tar xz -C /tmp
        sudo mv /tmp/eksctl /usr/local/bin
    fi

    # Terraform
    if ! command -v terraform &>/dev/null; then
        wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
        echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
        sudo apt-get update && sudo apt-get install -y terraform
    fi
}

case "$OS" in
    amzn) install_amazon_linux ;;
    ubuntu) install_ubuntu ;;
    *) echo "[WARN] Unknown OS: $OS. Trying Amazon Linux method..."; install_amazon_linux ;;
esac

echo ""
echo "=== Tool Installation Summary ==="
echo "AWS CLI:   $(aws --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "Node.js:   $(node --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "Docker:    $(docker --version 2>/dev/null || echo 'NOT INSTALLED')"
echo "kubectl:   $(kubectl version --client --short 2>/dev/null || echo 'NOT INSTALLED')"
echo "Helm:      $(helm version --short 2>/dev/null || echo 'NOT INSTALLED')"
echo "eksctl:    $(eksctl version 2>/dev/null || echo 'NOT INSTALLED')"
echo "Terraform: $(terraform version 2>/dev/null | head -1 || echo 'NOT INSTALLED')"
echo ""
echo "[DONE] Tool installation complete!"
