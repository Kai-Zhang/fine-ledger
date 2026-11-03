FROM node:24.13.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24.13.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production FINE_LEDGER_HOST=0.0.0.0 FINE_LEDGER_PORT=4181 FINE_LEDGER_DATA_DIR=/data FINE_LEDGER_STATIC_DIR=/app/public
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/src/domain ./src/domain
COPY --from=build --chown=node:node /app/src/sync ./src/sync
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4181
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD ["node", "server/healthcheck.mjs"]
CMD ["node", "server/main.ts"]
