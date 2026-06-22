import { z } from "zod";
import type { ContextPulseConfig } from "../types/index.js";

const configSchema = z.object({
  CONTEXT_LIMIT: z.coerce.number().default(200_000),
  WARNING_THRESHOLD_PCT: z.coerce.number().min(0).max(100).default(70),
  CRITICAL_THRESHOLD_PCT: z.coerce.number().min(0).max(100).default(90),
  LOOP_DETECTION_THRESHOLD: z.coerce.number().int().min(2).default(3),
  MODEL: z.string().default("claude-sonnet-4-6"),
  DATABASE_URL: z.string().default("postgresql://apple@localhost:5432/contextpulse"),
});

function loadConfig(): ContextPulseConfig {
  const parsed = configSchema.safeParse(process.env);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${errors}`);
  }
  const env = parsed.data;
  return {
    contextLimit: env.CONTEXT_LIMIT,
    warningThresholdPct: env.WARNING_THRESHOLD_PCT,
    criticalThresholdPct: env.CRITICAL_THRESHOLD_PCT,
    loopDetectionThreshold: env.LOOP_DETECTION_THRESHOLD,
    model: env.MODEL,
    db: { connectionString: env.DATABASE_URL },
  } satisfies ContextPulseConfig;
}

export const config = loadConfig();
