# ---- build ----
FROM node:24-alpine AS build
# python3/make/g++: optional native deps (bufferutil, utf-8-validate) pulled in by wallet modules.
RUN apk add --no-cache python3 make g++ && corepack enable
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
FROM node:24-alpine
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
COPY server/public server/public
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
