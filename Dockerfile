# Build stage - Use Bun to compile and bundle
FROM oven/bun:1.2 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./
COPY backend/package.json ./backend/ 2>/dev/null || true
COPY frontend/package.json ./frontend/ 2>/dev/null || true

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY backend/ ./backend/
COPY public/ ./public/
COPY frontend/ ./frontend/
COPY tsconfig.json ./
COPY bunfig.toml ./

# Build the backend (compile TypeScript)
WORKDIR /app/backend
RUN bun build index.ts --outdir ../dist/backend --target bun

# Build frontend if needed
WORKDIR /app/frontend
RUN bun run build 2>/dev/null || true

# Runtime stage - Use distroless base
FROM gcr.io/distroless/base-debian12:nonroot

# Copy Bun runtime from builder
COPY --from=builder /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist/backend/ ./dist/backend/
COPY --from=builder /app/public/ ./public/
COPY --from=builder /app/frontend/dist/ ./frontend/dist/ 2>/dev/null || true
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bun.lock ./

# Set environment
ENV NODE_ENV=production
ENV PORT=31337

EXPOSE 31337

# Run the server
CMD ["bun", "run", "dist/backend/index.js"]