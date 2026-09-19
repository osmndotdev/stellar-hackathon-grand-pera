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
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY frontend/package.json frontend/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile --prod --filter plink-server
COPY deployments deployments
COPY --from=build /app/frontend/dist frontend/dist
COPY --from=build /app/server/dist server/dist
COPY server/public server/public
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
