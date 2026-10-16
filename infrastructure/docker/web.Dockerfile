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
# Legacy deploy works with this unchanged, non-injected workspace lockfile.
RUN corepack pnpm --filter @cupmemo/web deploy --legacy --prod /out \
    && rm -rf /out/.next /out/public /out/node_modules/@cupmemo/contracts/dist /out/node_modules/@cupmemo/ui/dist \
    && cp -a apps/web/.next /out/.next \
    && cp -a apps/web/public /out/public \
    && cp -a packages/contracts/dist /out/node_modules/@cupmemo/contracts/dist \
    && cp -a packages/ui/dist /out/node_modules/@cupmemo/ui/dist \
    && rm -rf /out/src /out/next.config.ts /out/postcss.config.mjs /out/tsconfig.json /out/next-env.d.ts /out/.next/cache \
    && rm -rf /out/node_modules/@cupmemo/contracts/src /out/node_modules/@cupmemo/contracts/tsconfig.json /out/node_modules/@cupmemo/ui/src/index.tsx /out/node_modules/@cupmemo/ui/tsconfig.json

FROM node:24-bookworm-slim@sha256:156e9bc7a0a267cc6ca77b4283e32b123479342df684ce297455d7b95ff5a6b5 AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
USER node
EXPOSE 3101
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3101"]
