FROM node:24.19.0-bookworm-slim AS build

ENV COREPACK_HOME=/corepack
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN corepack enable && corepack pnpm install --frozen-lockfile

COPY apps/web/index.html apps/web/vite.config.ts apps/web/tsconfig.json apps/web/eslint.config.js apps/web/
COPY apps/web/src apps/web/src
COPY apps/web/public apps/web/public

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN corepack pnpm --dir apps/web build

FROM nginx:1.28-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
