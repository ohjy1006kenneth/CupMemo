# Native linux/arm64/v8 manifest, resolved from the public Node24 bookworm-slim index.
FROM node:24-bookworm-slim@sha256:156e9bc7a0a267cc6ca77b4283e32b123479342df684ce297455d7b95ff5a6b5 AS build
WORKDIR /work
RUN npm install --global corepack@0.36.0 && corepack prepare pnpm@10.34.6 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/web/package.json apps/web/tsconfig.json apps/web/next-env.d.ts apps/web/next.config.ts apps/web/postcss.config.mjs ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/
COPY packages/ui/package.json packages/ui/tsconfig.json ./packages/ui/
COPY packages/database/package.json ./packages/database/
COPY packages/config/package.json ./packages/config/
RUN corepack pnpm install --frozen-lockfile --child-concurrency=1 --network-concurrency=4
COPY packages/contracts/src ./packages/contracts/src
COPY packages/ui/src ./packages/ui/src
COPY apps/web/src ./apps/web/src
COPY apps/web/public ./apps/web/public
ENV NEXT_TELEMETRY_DISABLED=1
# Next compiles this server-side rewrite into .next/routes-manifest.json.
ENV CUPMEMO_API_ORIGIN=http://cupmemo-api:4101
RUN corepack pnpm --filter @cupmemo/web build
# With repository-root tracing, Next emits apps/web/server.js beneath standalone.
# Fail on a changed layout rather than copying a full dependency installation.
RUN test -f apps/web/.next/standalone/apps/web/server.js \
    && test -f apps/web/.next/standalone/apps/web/.next/routes-manifest.json

FROM node:24-bookworm-slim@sha256:156e9bc7a0a267cc6ca77b4283e32b123479342df684ce297455d7b95ff5a6b5 AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3101
# Session fetches read this server-only origin at runtime as well as build time.
ENV CUPMEMO_API_ORIGIN=http://cupmemo-api:4101
WORKDIR /app
COPY --from=build --chown=node:node /work/apps/web/.next/standalone/ ./
COPY --from=build --chown=node:node /work/apps/web/public/ ./apps/web/public/
COPY --from=build --chown=node:node /work/apps/web/.next/static/ ./apps/web/.next/static/
USER node
EXPOSE 3101
CMD ["node", "apps/web/server.js"]
