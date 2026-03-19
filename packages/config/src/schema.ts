import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().url(),

  REDIS_URL: z.string().url(),

  JWT_SECRET: z.string().min(64),
  JWT_REFRESH_SECRET: z.string().min(64),

  TRADING_PRIVATE_KEY: z.string().startsWith('0x'),

  WEBHOOK_SECRET: z.string().min(32),

  SENTRY_DSN: z.string().url().optional(),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),

  FCM_PROJECT_ID: z.string().optional(),
  FCM_CLIENT_EMAIL: z.string().email().optional(),
  FCM_PRIVATE_KEY: z.string().optional(),

  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_KEY_PATH: z.string().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  HIP3_XP_MULTIPLIER: z.coerce.number().default(2),
  XP_PER_DOLLAR: z.coerce.number().default(1),
  REFERRAL_PASSTHROUGH_RATE: z.coerce.number().default(0.1),
  MAX_REFERRAL_DEPTH: z.coerce.number().default(3),
});

export type Env = z.infer<typeof envSchema>;
