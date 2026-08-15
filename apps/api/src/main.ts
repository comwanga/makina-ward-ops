import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/http-exception.filter";
import { loadConfig } from "./config/config";

const REQUEST_ID_HEADER = "x-request-id";

function registerRequestIdAndHeaders(app: NestFastifyApplication) {
  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook("onRequest", async (request, reply) => {
    const incoming = request.headers[REQUEST_ID_HEADER];
    const id = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
    request.headers[REQUEST_ID_HEADER] = id;
    reply.header(REQUEST_ID_HEADER, id);
  });

  fastify.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "same-origin");
    reply.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(self)",
    );
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    return payload;
  });
}

async function bootstrap() {
  const config = loadConfig();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      logger: false,
    }),
    {
      logger:
        config.env === "production"
          ? ["warn", "error", "log"]
          : ["error", "warn", "log"],
    },
  );

  app.setGlobalPrefix("api/v1", {
    exclude: ["health/live", "health/ready", "health"],
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  registerRequestIdAndHeaders(app);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  Logger.log(
    `ward-ops API listening on :${config.port} (env=${config.env})`,
    "Bootstrap",
  );
}

void bootstrap();
