# Dockerfile — Production build for @orchid-ai/orchid-api
#
# Build context: workspace-ts/ (parent of this package)
#
# This monorepo does NOT use npm workspaces: each package ships its own
# lockfile (see workspace-ts/Makefile `install` target). We install each
# package individually with `npm ci`, build, then copy artifacts into a
# slim runtime image.
#
# Usage:
#   cd workspace-ts
#   docker build -f orchid-api-ts/Dockerfile -t orchid-api-ts .

FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies per package, using each one's own lockfile.
COPY orchid-ts/package.json orchid-ts/package-lock.json orchid-ts/
RUN npm --prefix orchid-ts ci --no-audit --no-fund

COPY orchid-api-ts/package.json orchid-api-ts/package-lock.json orchid-api-ts/
RUN npm --prefix orchid-api-ts ci --no-audit --no-fund

# Bring in source code + tsconfigs.
COPY orchid-ts/tsconfig.json orchid-ts/tsconfig.build.json orchid-ts/
COPY orchid-ts/src/ orchid-ts/src/
COPY orchid-api-ts/tsconfig.json orchid-api-ts/tsconfig.build.json orchid-api-ts/
COPY orchid-api-ts/src/ orchid-api-ts/src/

# Build framework library first, then the API.
RUN npm --prefix orchid-ts run build
RUN npm --prefix orchid-api-ts run build

# ── Stage 2: runtime ──────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/orchid-api-ts/dist/ ./dist/
COPY --from=builder /app/orchid-api-ts/node_modules/ ./node_modules/
COPY --from=builder /app/orchid-ts/dist/ ./node_modules/@orchid-ai/orchid/dist/
COPY --from=builder /app/orchid-ts/package.json ./node_modules/@orchid-ai/orchid/
COPY --from=builder /app/orchid-api-ts/package.json ./

ENV NODE_ENV=production

EXPOSE 8000

CMD ["node", "dist/cli.js"]