FROM node:18-alpine

# Install build tools for better-sqlite3 and ssh client for tests
RUN apk add --no-cache python3 make g++ openssh-client curl

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
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
