# The build output is plain JS, so the builder always runs on the host's native
# platform and multi-arch images only differ in the runner's base layer.
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

RUN npm install -g pnpm@11.14.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Node's default heap scales with host RAM; the Vite build needs ~4 GB
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=builder /app/.output ./.output
COPY --from=builder /app/drizzle ./drizzle
# Preview mode loads PGlite and its wasm from node_modules at runtime
# (src/db/preview.ts). It has no dependencies of its own.
COPY --from=builder /app/node_modules/@electric-sql/pglite ./node_modules/@electric-sql/pglite
# The MCP PNG export loads resvg and wawoff2 from node_modules at runtime
# (src/features/mcp/export/png.ts). Neither needs its dependencies there.
COPY --from=builder /app/node_modules/@resvg/resvg-wasm ./node_modules/@resvg/resvg-wasm
COPY --from=builder /app/node_modules/wawoff2 ./node_modules/wawoff2

USER node

EXPOSE 3000

# /api/health answers 200 only when the app is serving and Postgres is reachable
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", ".output/server/index.mjs"]
