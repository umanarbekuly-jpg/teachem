import "reflect-metadata";
import { writeFileSync } from "fs";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configure, document } from "./bootstrap";
async function main() {
  process.env.EXPORT_OPENAPI = "1";
  const defaults = {
    DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
    JWT_ACCESS_SECRET: "openapi-placeholder-not-for-runtime-access",
    JWT_REFRESH_SECRET: "openapi-placeholder-not-for-runtime-refresh",
    PUBLIC_ORIGIN: "http://localhost:8080",
    S3_ENDPOINT: "http://localhost:9000",
    S3_PUBLIC_ENDPOINT: "http://localhost:9000",
    S3_ACCESS_KEY: "unused",
    S3_SECRET_KEY: "unused-key",
    COOKIE_SECURE: "false",
    NODE_ENV: "development",
  };
  for (const [key, value] of Object.entries(defaults))
    process.env[key] ??= value;
  const app = await NestFactory.create(AppModule, { logger: false });
  configure(app);
  writeFileSync("openapi.json", JSON.stringify(document(app), null, 2) + "\n");
  await app.close();
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
