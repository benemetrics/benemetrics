# Build stage - bundle the app with Bun (backend + frontend HTML import)
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source code
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY tsconfig.json bunfig.toml ./

# Compile Tailwind CSS
# (bun build --target=bun doesn't apply bunfig [serve.static] plugins yet —
#  see bun docs "Fullstack > Plugins" — so compile the stylesheet first)
RUN bunx @tailwindcss/cli -i frontend/global.css -o frontend/global.compiled.css --minify
RUN sed -i 's|href="./global.css"|href="./global.compiled.css"|' frontend/index.html

# Bundle the application (backend + frontend HTML import)
# https://bun.com/docs/bundler/fullstack#ahead-of-time-bundling
RUN bun build --target=bun --production --outdir=dist ./backend/index.ts

# Production stage
FROM oven/bun:1-slim
WORKDIR /usr/src/app

# The HTML manifest resolves asset paths relative to the working directory,
# so the dist contents are copied into WORKDIR (per bun fullstack docs)
COPY --from=base /usr/src/app/dist ./

# Set environment
ENV NODE_ENV=production
ENV PORT=31337

EXPOSE 31337

# Run the server
CMD ["bun", "index.js"]
