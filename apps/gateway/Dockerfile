FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/gateway/package.json apps/gateway/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/payment-client/package.json packages/payment-client/package.json
RUN npm ci
COPY apps/gateway apps/gateway
COPY packages/payment-client packages/payment-client
COPY packages/contracts packages/contracts
COPY packages/observability packages/observability
RUN npm run build --workspace @botbond/contracts \
 && npm run build --workspace @botbond/observability \
 && npm run build --workspace @botbond/payment-client \
 && npm run build --workspace @botbond/gateway

FROM node:22-slim
ENV NODE_ENV=production PORT=8080 ADAPTER_MODE=fake
WORKDIR /app
COPY --from=build /app /app
RUN npm prune --omit=dev
CMD ["node", "apps/gateway/dist/src/server.js"]
