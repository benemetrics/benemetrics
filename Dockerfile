# Build stage - bundle the app with Bun (backend + frontend HTML import)
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source code
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY db/ ./db/
COPY tsconfig.json bunfig.toml ./

# Compile Tailwind CSS
# (bun build --target=bun doesn't apply bunfig [serve.static] plugins yet —
#  see bun docs "Fullstack > Plugins" — so compile the stylesheet first)
RUN bunx @tailwindcss/cli -i frontend/global.css -o frontend/global.compiled.css --minify
RUN sed -i 's|href="./global.css"|href="./global.compiled.css"|' frontend/index.html

# Bundle the application (backend + frontend HTML import) — the virtual OIDC
# module must be registered here because `bun build` skips bunfig plugins
# https://bun.com/docs/bundler/fullstack#ahead-of-time-bundling
RUN bun -e "import authEnvPlugin from './frontend/auth-env-plugin'; \
  const result = await Bun.build({ entrypoints: ['./backend/index.ts'], outdir: 'dist', target: 'bun', minify: true, plugins: [authEnvPlugin], external: ['crypto'] }); \
  if (!result.success) { for (const log of result.logs) console.error(log); process.exit(1); }"

# The side-effects consumer is the second entry point of the same image:
# it applies the Postgres side effects (issues, alerts, releases) from the
# durable pull consumer.
RUN bun build --target=bun --production --outdir=dist ./backend/consumer.ts

# Drizzle reads db/migrations and the PGlite fallback loads its WASM/data
# assets from disk at runtime, relative to the bundle directory
RUN cp -r db/migrations dist/migrations \
 && cp node_modules/@electric-sql/pglite/dist/pglite.data \
       node_modules/@electric-sql/pglite/dist/pglite.wasm \
       node_modules/@electric-sql/pglite/dist/initdb.wasm \
       dist/

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

# Container liveness — the API has no health endpoint, so the root redirect
# to the UI is the liveness signal.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 31337) + '/', { redirect: 'manual' }).then((r) => process.exit(r.status < 400 ? 0 : 1)).catch(() => process.exit(1))"]

# Run the server
CMD ["bun", "index.js"]
