# Dockerfile — Production build for @orchid-ai/orchid-api
#
# Build context: workspace-ts/ (parent of this package)
#
# Usage:
#   cd workspace-ts
#   docker build -f orchid-api-ts/Dockerfile -t orchid-api-ts .

FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY orchid-ts/package.json orchid-ts/
COPY orchid-api-ts/package.json orchid-api-ts/

RUN npm ci --ignore-scripts

COPY orchid-ts/tsconfig*.json orchid-ts/src/ orchid-ts/
COPY orchid-api-ts/tsconfig*.json orchid-api-ts/src/ orchid-api-ts/

RUN npm --prefix orchid-ts run build
RUN npm --prefix orchid-api-ts run build

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
