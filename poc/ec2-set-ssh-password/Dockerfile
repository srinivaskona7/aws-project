FROM node:18-slim

# Install build tools and ssh client
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    openssh-client \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (Debian glibc uses prebuilt sqlite3 binaries)
RUN npm install

# Copy application code
COPY . .

# Create directories for persistent data
RUN mkdir -p data uploads logs && \
    chmod 777 data uploads logs

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
