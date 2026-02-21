FROM node:18-alpine

RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    bash \
    openssh-client \
    git \
    curl \
    jq

WORKDIR /app

COPY package*.json ./

RUN npm install --production 2>&1 || npm install --production --ignore-scripts

COPY . .

RUN mkdir -p /tmp/devops-portal /app/scripts/templates /app/scripts/k8s

RUN addgroup -S devops && adduser -S devops -G devops && \
    chown -R devops:devops /app /tmp/devops-portal

USER devops

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "app.js"]
