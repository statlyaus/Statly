# Use Node 20 for parity with local/CI
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache \
    libc6-compat \
    python3~=3.12 \
    make~=4.4 \
    g++~=13 \
    openssl~=3.1
WORKDIR /app
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm i --frozen-lockfile; \
  else echo "Lockfile not found." && exit 1; \
  fi

# Build source
FROM base AS builder
WORKDIR /app

# Copy node_modules and source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma: ensure client generated for alpine (linux-musl)
# If you have binaryTargets in schema, include "linux-musl"
# generator client { binaryTargets = ["native","linux-musl"] }
RUN npx prisma generate || true

# Next build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user
RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001

# Public assets
COPY --from=builder /app/public ./public

# Standalone output (contains server.js + node_modules subset)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# (Optional) Prisma schema if runtime needs it (migrations/Prisma at runtime)
# COPY --from=builder /app/prisma ./prisma

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# In .next/standalone, server.js lives at the root
CMD ["node", "server.js"]