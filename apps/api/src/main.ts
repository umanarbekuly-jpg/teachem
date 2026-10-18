import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { configure, document } from "./bootstrap";
import { ENV, Environment } from "./config/env";
async function main() {
  const app = await NestFactory.create(AppModule);
  configure(app);
  SwaggerModule.setup("api/docs", app, document(app), {
    jsonDocumentUrl: "api/openapi.json",
  });
  await app.listen(app.get<Environment>(ENV).PORT, "0.0.0.0");
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Startup failed");
  process.exitCode = 1;
});
