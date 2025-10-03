# Multi-stage build for stremio-translate-subtitle
FROM node:18-slim AS builder

# Tạo thư mục app và cài đặt dependencies
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Tạo thư mục cần thiết cho ứng dụng
RUN mkdir -p debug subtitles data

# Production stage
FROM node:18-slim AS production
WORKDIR /usr/src/app

# Cài đặt sqlite3 cho production image
RUN apt-get update && apt-get install -y sqlite3 && rm -rf /var/lib/apt/lists/*

# Copy built app và node_modules
COPY --from=builder /usr/src/app ./

# Set môi trường production 
ENV NODE_ENV=production
ENV PORT=3000
ENV ADDRESS=0.0.0.0
ENV DB_TYPE=sqlite
ENV SQLITE_PATH=/usr/src/app/data/database.db

# Expose port mặc định
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- --timeout=2 http://localhost:3000/ || exit 1

# Start app
CMD ["npm", "start"]
