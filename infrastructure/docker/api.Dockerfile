# Identical native ARM64 Node/Debian ABI in build and runtime.
FROM node:24-bookworm-slim@sha256:156e9bc7a0a267cc6ca77b4283e32b123479342df684ce297455d7b95ff5a6b5 AS build
WORKDIR /work
RUN npm install --global corepack@0.36.0 && corepack prepare pnpm@10.34.6 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/
COPY packages/database/package.json packages/database/tsconfig.json ./packages/database/
COPY packages/ui/package.json ./packages/ui/
COPY packages/config/package.json ./packages/config/
RUN corepack pnpm install --frozen-lockfile --child-concurrency=1 --network-concurrency=4
COPY packages/contracts/src ./packages/contracts/src
COPY packages/database/src ./packages/database/src
COPY packages/database/drizzle ./packages/database/drizzle
COPY apps/api/src ./apps/api/src
RUN corepack pnpm --filter @cupmemo/contracts build \
    && corepack pnpm --filter @cupmemo/database build \
    && corepack pnpm --filter @cupmemo/api build
RUN corepack pnpm --filter @cupmemo/api deploy --legacy --prod --no-optional /out \
    && rm -rf /out/dist /out/node_modules/@cupmemo/contracts/dist /out/node_modules/@cupmemo/database/dist /out/node_modules/@cupmemo/database/drizzle \
    && cp -a apps/api/dist /out/dist \
    && cp -a packages/contracts/dist /out/node_modules/@cupmemo/contracts/dist \
    && cp -a packages/database/dist /out/node_modules/@cupmemo/database/dist \
    && cp -a packages/database/drizzle /out/node_modules/@cupmemo/database/drizzle \
    && rm -rf /out/src /out/tsconfig.json \
    && rm -rf /out/node_modules/@cupmemo/contracts/src /out/node_modules/@cupmemo/contracts/tsconfig.json /out/node_modules/@cupmemo/database/src /out/node_modules/@cupmemo/database/tsconfig.json

FROM node:24-bookworm-slim@sha256:156e9bc7a0a267cc6ca77b4283e32b123479342df684ce297455d7b95ff5a6b5 AS runtime
ENV NODE_ENV=production CUPMEMO_API_HOST=0.0.0.0 CUPMEMO_API_PORT=4101
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
USER node
EXPOSE 4101
CMD ["node", "dist/server.js"]
