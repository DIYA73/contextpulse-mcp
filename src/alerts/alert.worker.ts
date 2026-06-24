import { Worker, type Job } from "bullmq";
import type { AlertJobName, AlertJobPayload } from "./alert.types.js";
import { isBudgetAlert, isLoopAlert } from "./alert.types.js";
import { QUEUE_NAME } from "./alert.queue.js";

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
const WEBHOOK_URL = process.env["ALERT_WEBHOOK_URL"] ?? "";

let worker: Worker<AlertJobPayload, void, AlertJobName> | null = null;

export function startAlertWorker(): void {
  if (worker !== null) return;
  worker = new Worker<AlertJobPayload, void, AlertJobName>(
    QUEUE_NAME,
    async (job: Job<AlertJobPayload, void, AlertJobName>) => { await processAlert(job.data); },
    {
      connection: { url: REDIS_URL },
      concurrency: 5,
      lockDuration: 10_000,
    }
  );
  worker.on("completed", (job) => {
    console.log(`[contextpulse:worker] done job=${job.id} type=${job.data.type} run=${job.data.runId.slice(0,8)}`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[contextpulse:worker] failed job=${job?.id} error=${err.message}`);
  });
  worker.on("error", (err) => {
    if (!err.message.includes("ECONNREFUSED")) console.error("[contextpulse:worker] error:", err.message);
  });
  console.log("[contextpulse:worker] Alert worker started");
}

export async function stopAlertWorker(): Promise<void> {
  if (worker !== null) { await worker.close(); worker = null; }
}

async function processAlert(payload: AlertJobPayload): Promise<void> {
  logAlert(payload);
  if (WEBHOOK_URL.length > 0) await deliverWebhook(payload);
}

function logAlert(payload: AlertJobPayload): void {
  const run = payload.runId.slice(0, 8);
  const ts = new Date(payload.firedAt).toLocaleTimeString();
  if (isLoopAlert(payload)) {
    console.warn(`[contextpulse:alert] LOOP run=${run} tool="${payload.toolName}" count=${payload.count}x at=${ts}`);
    return;
  }
  if (isBudgetAlert(payload)) {
    const icon = payload.type === "budget_overflow" ? "OVERFLOW" : payload.type === "budget_critical" ? "CRITICAL" : "WARNING";
    console.warn(`[contextpulse:alert] ${icon} run=${run} ${payload.percentUsed.toFixed(1)}% (${payload.tokensUsed.toLocaleString()}/${payload.tokenLimit.toLocaleString()}) at=${ts}`);
  }
}

async function deliverWebhook(payload: AlertJobPayload): Promise<void> {
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "contextpulse-mcp/0.1.0" },
      body: JSON.stringify({ source: "contextpulse", ...payload }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.warn(`[contextpulse:worker] Webhook returned ${res.status}`);
  } catch (err) {
    if (err instanceof Error) console.warn("[contextpulse:worker] Webhook failed:", err.message);
  }
}
