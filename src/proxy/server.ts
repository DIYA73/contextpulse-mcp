import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import pg from "pg";

import { config } from "../config/index.js";
import { runMigration } from "../db/schema.js";
import { Storage } from "../storage/index.js";
import { BudgetTracker } from "../token/budget-tracker.js";
import {
  countToolCallInputTokens,
  countToolCallOutputTokens,
} from "../token/counter.js";
import {
  createSessionId,
  createRunId,
  createToolCallId,
  getBudgetStatus,
} from "../types/index.js";
import type { ToolCallEvent, BudgetStatus } from "../types/index.js";

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: config.db.connectionString });
await runMigration(pool);

const storage = new Storage(pool);
const tracker = new BudgetTracker(config);

// ─── Persist alert events from the tracker ───────────────────────────────────

tracker.on("event", (event: ToolCallEvent) => {
  if (event.event === "budget_warning" || event.event === "budget_critical") {
    const { runId, budget } = event.data;
    const alertType =
      event.event === "budget_warning" ? "warning" : "critical";
    storage
      .saveAlert(runId, alertType, { budget }, undefined, budget.used, budget.percentUsed)
      .catch((err: unknown) => {
        console.error("[contextpulse] Failed to save alert:", err);
      });
  }

  if (event.event === "loop_detected") {
    const { runId, toolName, count } = event.data;
    storage
      .saveAlert(runId, "loop_detected", { toolName, count }, toolName)
      .catch((err: unknown) => {
        console.error("[contextpulse] Failed to save loop alert:", err);
      });
    console.warn(
      `[contextpulse] ⚠️  Loop detected: "${toolName}" called ${count}× in run ${runId}`
    );
  }

  if (event.event === "budget_warning") {
    const { budget } = event.data;
    console.warn(
      `[contextpulse] ⚠️  Budget WARNING: ${budget.percentUsed.toFixed(1)}% used (${budget.used.toLocaleString()} / ${budget.limit.toLocaleString()} tokens)`
    );
  }

  if (event.event === "budget_critical") {
    const { budget } = event.data;
    console.error(
      `[contextpulse] 🚨 Budget CRITICAL: ${budget.percentUsed.toFixed(1)}% used (${budget.used.toLocaleString()} / ${budget.limit.toLocaleString()} tokens)`
    );
  }
});

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "contextpulse-mcp",
  version: "0.1.0",
});

// ── Tool: start a session ────────────────────────────────────────────────────
server.tool(
  "cp_start_session",
  "Start a ContextPulse tracking session. Call this once at the beginning of an agent session.",
  {
    sessionId: z.string().optional().describe("Custom session ID (auto-generated if omitted)"),
    label: z.string().optional().describe("Human-readable label for this session"),
    contextLimit: z.number().optional().describe("Token limit for this session (default: 200000)"),
  },
  async ({ sessionId, label, contextLimit }) => {
    const sid = createSessionId(sessionId ?? randomUUID());
    await storage.upsertSession(sid, contextLimit ?? config.contextLimit, label);
    console.log(`[contextpulse] Session started: ${sid}`);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ sessionId: sid, contextLimit: contextLimit ?? config.contextLimit }),
        },
      ],
    };
  }
);

// ── Tool: start a run ────────────────────────────────────────────────────────
server.tool(
  "cp_start_run",
  "Start a new agent run within a session. One run = one agent task.",
  {
    sessionId: z.string().describe("Session ID from cp_start_session"),
    runId: z.string().optional().describe("Custom run ID (auto-generated if omitted)"),
    label: z.string().optional().describe("Label for this run, e.g. 'Fix auth bug'"),
  },
  async ({ sessionId, runId, label }) => {
    const sid = createSessionId(sessionId);
    const rid = createRunId(runId ?? randomUUID());
    tracker.initRun(rid);
    await storage.createRun(rid, sid, label);
    console.log(`[contextpulse] Run started: ${rid}`);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ runId: rid }),
        },
      ],
    };
  }
);

// ── Tool: track a tool call ──────────────────────────────────────────────────
server.tool(
  "cp_track_tool_call",
  "Track a tool call with its input and output. Call this after every tool call to keep the context budget updated.",
  {
    runId: z.string().describe("Run ID from cp_start_run"),
    sessionId: z.string().describe("Session ID from cp_start_session"),
    toolName: z.string().describe("Name of the tool that was called"),
    arguments: z.unknown().optional().describe("Tool input arguments"),
    output: z.unknown().optional().describe("Tool output / result"),
    durationMs: z.number().optional().describe("How long the tool call took in ms"),
  },
  async ({ runId, sessionId, toolName, arguments: args, output, durationMs }) => {
    const rid = createRunId(runId);
    const sid = createSessionId(sessionId);
    const tcId = createToolCallId(randomUUID());
    const now = new Date();
    const startedAt = durationMs !== undefined
      ? new Date(now.getTime() - durationMs)
      : now;

    // Count tokens
    const inputTokens = countToolCallInputTokens(toolName, args);
    const outputTokens = countToolCallOutputTokens(output);

    // Persist start (backfilled)
    await storage.insertToolCallStart({
      toolCallId: tcId,
      runId: rid,
      sessionId: sid,
      toolName,
      arguments: args,
      startedAt,
    });

    // Update live budget tracker
    const { budget, budgetStatus } = tracker.recordToolCall(
      rid,
      toolName,
      inputTokens,
      outputTokens
    );

    // Persist completion
    await storage.updateToolCallEnd({
      toolCallId: tcId,
      output,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      durationMs: durationMs ?? 0,
      completedAt: now,
      budget,
      budgetStatus,
    });

    // Update run totals
    await storage.updateRunTotals(rid, inputTokens, outputTokens);

    // Save budget snapshot for timeline chart
    await storage.saveBudgetSnapshot(rid, tcId, budget);

    // Persist alert if threshold crossed
    const statusType = budgetStatus.status;
    if (statusType === "warning" || statusType === "critical" || statusType === "overflow") {
      await storage.saveAlert(
        rid,
        statusType === "overflow" ? "critical" : statusType,
        { toolName, budget },
        toolName,
        budget.used,
        budget.percentUsed
      );
    }

    const result = {
      toolCallId: tcId,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      budget: {
        used: budget.used,
        limit: budget.limit,
        percentUsed: parseFloat(budget.percentUsed.toFixed(2)),
      },
      budgetStatus: budgetStatus.status,
      alert: statusType !== "ok" ? statusType : null,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result),
        },
      ],
    };
  }
);

// ── Tool: get current budget ─────────────────────────────────────────────────
server.tool(
  "cp_get_budget",
  "Get the current context budget for a run.",
  {
    runId: z.string().describe("Run ID from cp_start_run"),
  },
  async ({ runId }) => {
    const rid = createRunId(runId);
    const budget = tracker.getBudget(rid);
    const status = getBudgetStatus(budget);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            used: budget.used,
            limit: budget.limit,
            percentUsed: parseFloat(budget.percentUsed.toFixed(2)),
            status: status.status,
            remaining: budget.limit - budget.used,
          }),
        },
      ],
    };
  }
);

// ── Tool: get run summary ────────────────────────────────────────────────────
server.tool(
  "cp_get_run_summary",
  "Get a full summary of a run including token usage, tool calls, and budget timeline.",
  {
    runId: z.string().describe("Run ID to summarise"),
  },
  async ({ runId }) => {
    const rid = createRunId(runId);
    const [run, timeline] = await Promise.all([
      storage.getRun(rid),
      storage.getBudgetTimeline(rid),
    ]);

    if (run === null) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Run not found" }) }],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            runId: run.runId,
            label: run.label,
            startedAt: run.startedAt,
            totalInputTokens: run.totalInputTokens,
            totalOutputTokens: run.totalOutputTokens,
            totalTokens: run.totalTokens,
            toolCallCount: run.toolCallCount,
            budget: {
              used: run.budget.used,
              limit: run.budget.limit,
              percentUsed: parseFloat(run.budget.percentUsed.toFixed(2)),
            },
            budgetStatus: getBudgetStatus(run.budget).status,
            timeline,
          }),
        },
      ],
    };
  }
);

// ── Tool: end a run ──────────────────────────────────────────────────────────
server.tool(
  "cp_end_run",
  "End a run and clean up in-memory state.",
  {
    runId: z.string().describe("Run ID to end"),
  },
  async ({ runId }) => {
    const rid = createRunId(runId);
    tracker.endRun(rid);
    console.log(`[contextpulse] Run ended: ${rid}`);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ ended: true, runId }) }],
    };
  }
);

// ─── Start transport ──────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("[contextpulse] MCP server running on stdio");
