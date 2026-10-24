# Kaduna Kulture frontend (Nuxt 3 + TresJS). Build once, serve the Nitro
# server. Caddy sends /api and /ws to the backend on the same origin.
FROM node:22-alpine AS build
WORKDIR /app
ENV NUXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=3072
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NUXT_TELEMETRY_DISABLED=1 \
    HOST=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
