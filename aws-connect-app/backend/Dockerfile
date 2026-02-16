# Stage 1: Build Image
FROM node:18-alpine AS builder

WORKDIR /app

# Install build dependencies for node-pty (native module)
RUN apk add --no-cache python3 make g++

# Copy package.json to install dependencies separately (cache layer)
COPY package.json ./

# Install dependencies (production only)
RUN npm install --omit=dev

# Stage 2: Production Image
FROM node:18-alpine AS runner

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Copy application source code
COPY server.js .

# Install AWS CLI and SSH Client (Runtime dependencies)
RUN apk add --no-cache aws-cli openssh-client curl unzip less bash

# Environment Variables
ENV NODE_ENV=production
ENV PORT=8099

# Expose Port
EXPOSE 8099

# Start Application
CMD ["node", "server.js"]
