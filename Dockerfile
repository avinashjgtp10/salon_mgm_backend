# Use official Node.js image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first (for layer caching)
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy rest of the code
COPY . .

# Expose port (will be overridden by docker-compose)
EXPOSE 3000

# Start the app
CMD ["node", "dist/index.js"]