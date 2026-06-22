import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module.js";
import { runMigration } from "../db/schema.js";
import { pool } from "../shared.js";

const PORT = parseInt(process.env["API_PORT"] ?? "3000", 10);
const DASHBOARD_ORIGIN = process.env["DASHBOARD_ORIGIN"] ?? "http://localhost:3001";

async function bootstrap(): Promise<void> {
  await runMigration(pool);
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] });
  app.enableCors({ origin: DASHBOARD_ORIGIN, credentials: true });
  app.setGlobalPrefix("api");
  await app.listen(PORT);
  console.log(`[contextpulse] API running on http://localhost:${PORT}/api`);
  console.log(`[contextpulse] WebSocket on ws://localhost:${PORT}/events`);
}

bootstrap().catch((err: unknown) => { console.error("[contextpulse] Failed to start:", err); process.exit(1); });
