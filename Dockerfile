# Use the official Node.js image as base
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose port (Fly.io will use PORT env var)
EXPOSE 8080

# Start the application
CMD ["node", "server.js"]