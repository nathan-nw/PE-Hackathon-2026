# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_PROMETHEUS_URL=http://localhost:9090
ARG NEXT_PUBLIC_ALERTMANAGER_PUBLIC_URL=http://localhost:9093
ENV NEXT_PUBLIC_PROMETHEUS_URL=$NEXT_PUBLIC_PROMETHEUS_URL
ENV NEXT_PUBLIC_ALERTMANAGER_PUBLIC_URL=$NEXT_PUBLIC_ALERTMANAGER_PUBLIC_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN addgroup -g 999 docker 2>/dev/null || addgroup -S docker
RUN adduser --system --uid 1001 nextjs
RUN addgroup nextjs docker
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
