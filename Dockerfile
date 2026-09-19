# ---- build ----
FROM node:24-bookworm-slim AS build
# Toolchain for native deps (secp256k1, bufferutil) pulled in by wallet modules.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY frontend/package.json frontend/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile
COPY deployments deployments
COPY frontend frontend
COPY server server
ARG VITE_PUBLIC_URL
ENV VITE_PUBLIC_URL=$VITE_PUBLIC_URL
RUN pnpm --filter plink-frontend build && pnpm --filter plink-server build

# ---- run ----
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-workspace.yaml ./
COPY server/package.json server/
# Reuse the build stage's install (pnpm symlinks resolve because paths match).
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/node_modules server/node_modules
COPY deployments deployments
COPY --from=build /app/frontend/dist frontend/dist
COPY --from=build /app/server/dist server/dist
EXPOSE 3000
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*
CMD ["node", "server/dist/index.js"]
