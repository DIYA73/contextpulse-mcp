import { EventEmitter } from "events";
import type {
  RunId,
  TokenBudget,
  BudgetStatus,
  ToolCallEvent,
} from "../types/index.js";
import { getBudgetStatus } from "../types/index.js";
import type { ContextPulseConfig } from "../types/index.js";

interface RunState {
  runId: RunId;
  totalTokens: number;
  toolNameCounts: Map<string, number>;
  lastAlertStatus: BudgetStatus["status"];
}

export class BudgetTracker extends EventEmitter {
  private readonly runs = new Map<string, RunState>();

  constructor(private readonly cfg: ContextPulseConfig) {
    super();
  }

  initRun(runId: RunId): void {
    if (!this.runs.has(runId)) {
      this.runs.set(runId, {
        runId,
        totalTokens: 0,
        toolNameCounts: new Map(),
        lastAlertStatus: "ok",
      });
    }
  }

  /**
   * Record a completed tool call's token cost.
   * Returns the updated budget and fires events if thresholds are crossed.
   */
  recordToolCall(
    runId: RunId,
    toolName: string,
    inputTokens: number,
    outputTokens: number
  ): { budget: TokenBudget; budgetStatus: BudgetStatus } {
    const state = this.getOrInit(runId);

    state.totalTokens += inputTokens + outputTokens;

    // Loop detection
    const prev = state.toolNameCounts.get(toolName) ?? 0;
    state.toolNameCounts.set(toolName, prev + 1);
    const count = state.toolNameCounts.get(toolName) ?? 1;

    if (count >= this.cfg.loopDetectionThreshold) {
      const event: ToolCallEvent = {
        event: "loop_detected",
        data: { runId, toolName, count },
      };
      this.emit("event", event);
      // Reset count so we don't spam alerts
      state.toolNameCounts.set(toolName, 0);
    }

    const budget: TokenBudget = {
      used: state.totalTokens,
      limit: this.cfg.contextLimit,
      percentUsed: (state.totalTokens / this.cfg.contextLimit) * 100,
    };

    const budgetStatus = getBudgetStatus(budget);

    // Only fire alert events on status transitions to avoid spam
    if (
      budgetStatus.status !== "ok" &&
      budgetStatus.status !== state.lastAlertStatus
    ) {
      state.lastAlertStatus = budgetStatus.status;

      if (budgetStatus.status === "warning") {
        this.emit("event", {
          event: "budget_warning",
          data: { runId, budget },
        } satisfies ToolCallEvent);
      } else if (
        budgetStatus.status === "critical" ||
        budgetStatus.status === "overflow"
      ) {
        this.emit("event", {
          event: "budget_critical",
          data: { runId, budget },
        } satisfies ToolCallEvent);
      }
    }

    return { budget, budgetStatus };
  }

  getBudget(runId: RunId): TokenBudget {
    const state = this.getOrInit(runId);
    return {
      used: state.totalTokens,
      limit: this.cfg.contextLimit,
      percentUsed: (state.totalTokens / this.cfg.contextLimit) * 100,
    };
  }

  endRun(runId: RunId): void {
    this.runs.delete(runId);
  }

  getActiveRuns(): Array<{ runId: string; budget: { used: number; limit: number; percentUsed: number } }> {
    return Array.from(this.runs.values()).map((state) => ({
      runId: state.runId,
      budget: { used: state.totalTokens, limit: this.cfg.contextLimit, percentUsed: parseFloat(((state.totalTokens / this.cfg.contextLimit) * 100).toFixed(2)) },
    }));
  }

  private getOrInit(runId: RunId): RunState {
    let state = this.runs.get(runId);
    if (state === undefined) {
      state = {
        runId,
        totalTokens: 0,
        toolNameCounts: new Map(),
        lastAlertStatus: "ok",
      };
      this.runs.set(runId, state);
    }
    return state;
  }
}
