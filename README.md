# DreamAPI — Production backend infrastructure for a Hyperliquid trading app

Production-quality TypeScript/Node.js backend powering Dreamcash, a self-custodial mobile trading app built on Hyperliquid. EIP-712 wallet auth, real-time market data, order relay, XP points engine, and push notifications.

## Architecture

```mermaid
flowchart TB
    subgraph Client
        Mobile["Mobile App"]
        WSClient["Client WebSocket"]
    end

    subgraph API["API (Fastify)"]
        Routes["Routes"]
        HLWS["Hyperliquid WS Client"]
    end

    subgraph Worker["Worker (BullMQ)"]
        XP["XP Processor"]
        Notify["Notification Processor"]
        Leaderboard["Leaderboard Snapshot"]
        Alerts["Alert Checker"]
    end

    subgraph Data
        PG[(PostgreSQL)]
        Redis[(Redis)]
    end

    subgraph External
        HL["Hyperliquid API"]
    end

    Mobile -->|HTTP/WS| API
    WSClient -->|Subscribe| API
    API --> PG
    API --> Redis
    API --> HL
    HL -->|WebSocket| HLWS
    HLWS --> Redis
    Redis -->|Broadcast| WSClient

    Worker --> PG
    Worker --> Redis
    Worker --> HL
```

## Quick Start

```bash
git clone <repo-url> dreamapi && cd dreamapi
pnpm install
cp .env.example .env
# Edit .env with your values (JWT secrets, TRADING_PRIVATE_KEY, etc.)
docker compose -f infra/docker-compose.yml up -d
pnpm -F @dreamapi/db db:migrate:deploy
pnpm dev
```

Then open **http://localhost:3000/docs** for the interactive API documentation.

## Module Overview

### 1. Auth

EIP-712 wallet sign-in with nonce challenge, JWT access/refresh token pairs, session management, and HMAC webhook verification for third-party integrations (e.g. fiat on-ramp callbacks).

### 2. Market Data

Hyperliquid WebSocket client ingests `allMids` and `l2Book` streams, caches prices and orderbooks in Redis with short TTLs, and broadcasts live prices to subscribed clients over a dedicated WebSocket endpoint.

### 3. Trading

Order submission via Hyperliquid REST API with risk validation (leverage limits), fill tracking from `userEvents` WebSocket, and portfolio history from persisted trades.

### 4. Points Engine

BullMQ-based XP pipeline: trade fills enqueue jobs, processors calculate XP (with HIP-3 multiplier), propagate to referrers (3 levels, 10% passthrough), and maintain a Redis-sorted leaderboard with midnight snapshots.

### 5. Notifications

Push notifications via FCM and APNs, SMS fallback via Twilio, price alerts with a repeatable BullMQ job checking thresholds every 30 seconds, and fiat on-ramp webhooks for deposit XP.

### 6. Observability

OpenTelemetry tracing, Sentry error capture, and Pino structured logging applied across all modules. Health endpoint reports DB, Redis, and Hyperliquid connectivity.

## API Reference

Interactive Swagger UI: **[http://localhost:3000/docs](http://localhost:3000/docs)**

## Environment Variables

| Variable                      | Description                                         | Example                                                  |
| ----------------------------- | --------------------------------------------------- | -------------------------------------------------------- |
| `NODE_ENV`                    | Environment mode                                    | `development`, `test`, `production`                      |
| `PORT`                        | HTTP server port                                    | `3000`                                                   |
| `LOG_LEVEL`                   | Pino log level                                      | `debug`, `info`, `warn`, `error`                         |
| `DATABASE_URL`                | PostgreSQL connection string                        | `postgresql://dreamapi:dreamapi@localhost:5432/dreamapi` |
| `REDIS_URL`                   | Redis connection string                             | `redis://localhost:6379`                                 |
| `JWT_SECRET`                  | Access token signing secret (min 64 chars)          | Generate with `openssl rand -hex 64`                     |
| `JWT_REFRESH_SECRET`          | Refresh token signing secret (min 64 chars)         | Generate with `openssl rand -hex 64`                     |
| `TRADING_PRIVATE_KEY`         | Ethereum private key for order signing              | `0x...`                                                  |
| `WEBHOOK_SECRET`              | HMAC secret for webhook verification (min 32 chars) | Generate with `openssl rand -hex 16`                     |
| `SENTRY_DSN`                  | Sentry project DSN (optional in dev)                | `https://...@sentry.io/...`                              |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry OTLP endpoint (optional in dev)       | `http://localhost:4318`                                  |
| `FCM_PROJECT_ID`              | Firebase project ID (optional)                      | —                                                        |
| `FCM_CLIENT_EMAIL`            | Firebase service account email (optional)           | —                                                        |
| `FCM_PRIVATE_KEY`             | Firebase private key (optional)                     | —                                                        |
| `APNS_KEY_ID`                 | Apple APNs key ID (optional)                        | —                                                        |
| `APNS_TEAM_ID`                | Apple team ID (optional)                            | —                                                        |
| `APNS_KEY_PATH`               | Path to APNs .p8 key file (optional)                | `./certs/AuthKey.p8`                                     |
| `TWILIO_ACCOUNT_SID`          | Twilio account SID (optional)                       | —                                                        |
| `TWILIO_AUTH_TOKEN`           | Twilio auth token (optional)                        | —                                                        |
| `TWILIO_FROM_NUMBER`          | Twilio sender number (optional)                     | `+15551234567`                                           |
| `HIP3_XP_MULTIPLIER`          | XP multiplier for HIP-3 trades                      | `2`                                                      |
| `XP_PER_DOLLAR`               | Base XP per $1 volume                               | `1`                                                      |
| `REFERRAL_PASSTHROUGH_RATE`   | Referral XP passthrough per level                   | `0.1`                                                    |
| `MAX_REFERRAL_DEPTH`          | Max referral propagation levels                     | `3`                                                      |

## Tech Stack

| Layer          | Technology                                          |
| -------------- | --------------------------------------------------- |
| Runtime        | Node.js 20 LTS                                      |
| Language       | TypeScript 5 (strict)                               |
| Framework      | Fastify 4 + Swagger + WebSocket                     |
| ORM            | Prisma 5 — PostgreSQL 16                            |
| Cache / Queues | Redis 7, BullMQ                                     |
| Blockchain     | @nktkas/hyperliquid, viem                           |
| Monorepo       | Turborepo, pnpm workspaces                          |
| Observability  | OpenTelemetry, Sentry, Pino                         |
| Testing        | Vitest, Supertest                                   |
| Notifications  | firebase-admin (FCM), node-apn (APNs), Twilio (SMS) |
| Validation     | Zod                                                 |
| Container      | Docker, Docker Compose                              |
| CI             | GitHub Actions                                      |
