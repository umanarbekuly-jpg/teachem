import "dotenv/config";
import { z } from "zod";
export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  PUBLIC_ORIGIN: z.string().url(),
  CORS_ORIGINS: z.string().default("http://localhost:8080"),
  S3_ENDPOINT: z.string().url(),
  S3_PUBLIC_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("tutor-private"),
  S3_ACCESS_KEY: z.string().min(3),
  S3_SECRET_KEY: z.string().min(8),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});
export type Environment = z.infer<typeof envSchema>;
export const ENV = Symbol("ENV");
export function readEnv(): Environment {
  const env = envSchema.parse(process.env);
  if (
    env.NODE_ENV === "production" &&
    (!env.COOKIE_SECURE || !env.PUBLIC_ORIGIN.startsWith("https://"))
  )
    throw new Error("Production requires HTTPS and COOKIE_SECURE=true");
  return env;
}
