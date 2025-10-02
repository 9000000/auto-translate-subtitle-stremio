# Single-stage build for better compatibility
FROM node:18-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Clean install dependencies (ignore lock file conflicts)
RUN rm -f package-lock.json && npm install --omit=dev

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p debug subtitles data

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV ADDRESS=0.0.0.0
ENV DB_TYPE=sqlite
ENV SQLITE_PATH=/usr/src/app/data/database.db

# Expose default port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- --timeout=2 http://localhost:3000/ || exit 1

# Start app
CMD ["npm", "start"]
