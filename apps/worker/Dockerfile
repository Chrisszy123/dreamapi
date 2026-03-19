# Stage 1: deps — production dependencies only
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/types/package.json packages/types/
COPY packages/db/package.json packages/db/
COPY packages/hyperliquid/package.json packages/hyperliquid/
COPY packages/queue/package.json packages/queue/
COPY packages/notifications/package.json packages/notifications/
RUN pnpm install --frozen-lockfile --prod

# Stage 2: builder — full install, build, Prisma generate
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY apps/worker/ apps/worker/
COPY packages/ packages/
RUN pnpm install --frozen-lockfile
RUN pnpm -F @dreamapi/db db:generate
RUN pnpm build --filter=@dreamapi/worker...

# Stage 3: runner — minimal production image
FROM node:20-alpine AS runner
RUN addgroup -g 1001 -S nodejs && adduser -S dreamapi -u 1001
WORKDIR /app

# Copy production node_modules from builder (includes Prisma client from db:generate)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Copy built worker
COPY --from=builder /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

# Copy built packages (dist + prisma schema)
COPY --from=builder /app/packages ./packages

USER dreamapi
ENTRYPOINT ["node", "apps/worker/dist/index.js"]
