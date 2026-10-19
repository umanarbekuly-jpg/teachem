import { BRAND } from "@tutor/shared";
import "reflect-metadata";
import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { randomUUID, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { ENV, Environment } from "./config/env";
import { ApiErrors, AuthRequest } from "./common/http";
import { addResponseContracts } from "./common/contracts";
export function configure(app: INestApplication) {
  const env = app.get<Environment>(ENV);
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.setGlobalPrefix("api/v1", {
    exclude: [{ path: "health/{*path}", method: RequestMethod.ALL }],
  });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: env.CORS_ORIGINS.split(",").map((s) => s.trim()),
    credentials: true,
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    (req as AuthRequest).requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    res.setHeader("Cache-Control", "no-store");
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.headers.origin;
    const cookie = req.cookies?.csrf;
    const header = req.headers["x-csrf-token"];
    const valid =
      typeof cookie === "string" &&
      typeof header === "string" &&
      /^[a-f0-9]{64}$/.test(cookie) &&
      /^[a-f0-9]{64}$/.test(header) &&
      timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
    if (origin !== env.PUBLIC_ORIGIN || !valid)
      return res
        .status(403)
        .json({
          code: "CSRF_FAILED",
          message: "Обновите страницу и повторите действие",
          requestId,
        });
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ApiErrors());
  app.enableShutdownHooks();
}
export function document(app: INestApplication) {
  return addResponseContracts(
    SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(`${BRAND.name} — API`)
        .setDescription(
          "Платформа тьюторов. Cookie JWT + CSRF для изменяющих запросов. Все суммы — в тиынах.",
        )
        .setVersion("1.0")
        .addCookieAuth("access")
        .build(),
      {
        operationIdFactory: (controller, method) =>
          `${controller.replace("Controller", "")}_${method}`,
      },
    ),
  );
}
