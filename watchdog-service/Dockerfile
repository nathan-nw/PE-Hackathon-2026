# syntax=docker/dockerfile:1
# Build from repository root (see railway.toml rootDirectory ".").
FROM node:20-alpine AS build
WORKDIR /build
COPY dashboard/src/lib/watchdog-core ./dashboard/src/lib/watchdog-core
# watchdog-discord.ts imports ../happy-branding (esbuild resolves from watchdog-core/)
COPY dashboard/src/lib/happy-branding.ts ./dashboard/src/lib/happy-branding.ts
COPY watchdog-service/package.json ./watchdog-service/
WORKDIR /build/watchdog-service
RUN npm install
COPY watchdog-service/tsconfig.json ./
COPY watchdog-service/src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /build/watchdog-service/dist/server.js ./
ENV PORT=8080
# Lets watchdog-discord.ts send notifications (not the dashboard in-process tick).
ENV RAILWAY_WATCHDOG_WORKER=1
EXPOSE 8080
USER node
CMD ["node", "server.js"]
