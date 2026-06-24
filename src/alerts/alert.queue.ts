import { Queue } from "bullmq";
import type { AlertJobName, AlertJobPayload } from "./alert.types.js";

const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:6379";
export const QUEUE_NAME = "contextpulse:alerts";

let alertQueue: Queue<AlertJobPayload, void, AlertJobName> | null = null;
let queueAvailable = false;

export function getAlertQueue(): Queue<AlertJobPayload, void, AlertJobName> | null {
  if (alertQueue !== null) return alertQueue;
  try {
    alertQueue = new Queue<AlertJobPayload, void, AlertJobName>(QUEUE_NAME, {
      connection: { url: REDIS_URL },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });
    alertQueue.waitUntilReady().then(() => {
      queueAvailable = true;
      console.log("[contextpulse:alerts] Queue ready");
    }).catch(() => {
      console.warn("[contextpulse:alerts] Redis not available — fallback logging only");
    });
    return alertQueue;
  } catch {
    return null;
  }
}

export async function enqueueAlert(name: AlertJobName, payload: AlertJobPayload): Promise<void> {
  const queue = getAlertQueue();
  if (queue === null || !queueAvailable) { logFallback(payload); return; }
  try {
    await queue.add(name, payload, { delay: 0 });
  } catch {
    logFallback(payload);
  }
}

function logFallback(payload: AlertJobPayload): void {
  if (payload.type === "loop_detected") {
    console.warn(`[contextpulse:alerts] LOOP run=${payload.runId.slice(0,8)} tool="${payload.toolName}" count=${payload.count}`);
  } else {
    console.warn(`[contextpulse:alerts] ${payload.type.toUpperCase()} run=${payload.runId.slice(0,8)} ${payload.percentUsed.toFixed(1)}%`);
  }
}

export { queueAvailable };
