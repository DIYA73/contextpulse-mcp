import pg from "pg";
import type {
  SessionId,
  RunId,
  ToolCallId,
  ToolCallInput,
  ToolCallResult,
  TokenBudget,
  AgentRun,
} from "../types/index.js";
import {
  createSessionId,
  createRunId,
  createToolCallId,
} from "../types/index.js";

export class Storage {
  constructor(private readonly pool: pg.Pool) {}

  // ─── Sessions ──────────────────────────────────────────────────────────────

  async upsertSession(
    sessionId: SessionId,
    contextLimit: number,
    label?: string
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO cp_sessions (session_id, context_limit, label)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, contextLimit, label ?? null]
    );
  }

  async endSession(sessionId: SessionId): Promise<void> {
    await this.pool.query(
      `UPDATE cp_sessions SET ended_at = NOW() WHERE session_id = $1`,
      [sessionId]
    );
  }

  // ─── Runs ──────────────────────────────────────────────────────────────────

  async createRun(runId: RunId, sessionId: SessionId, label?: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO cp_runs (run_id, session_id, label)
       VALUES ($1, $2, $3)
       ON CONFLICT (run_id) DO NOTHING`,
      [runId, sessionId, label ?? null]
    );
  }

  async updateRunTotals(
    runId: RunId,
    inputTokens: number,
    outputTokens: number
  ): Promise<void> {
    await this.pool.query(
      `UPDATE cp_runs
       SET total_input_tokens  = total_input_tokens  + $2,
           total_output_tokens = total_output_tokens + $3,
           total_tokens        = total_tokens        + $2 + $3,
           tool_call_count     = tool_call_count     + 1
       WHERE run_id = $1`,
      [runId, inputTokens, outputTokens]
    );
  }

  async getRun(runId: RunId): Promise<AgentRun | null> {
    const { rows } = await this.pool.query<{
      run_id: string;
      session_id: string;
      label: string | null;
      started_at: Date;
      ended_at: Date | null;
      total_input_tokens: number;
      total_output_tokens: number;
      total_tokens: number;
      tool_call_count: number;
    }>(
      `SELECT r.*, s.context_limit
       FROM cp_runs r
       JOIN cp_sessions s ON s.session_id = r.session_id
       WHERE r.run_id = $1`,
      [runId]
    );

    const row = rows[0];
    if (row === undefined) return null;

    const limit = await this.getSessionContextLimit(createSessionId(row.session_id));

    const budget: TokenBudget = {
      used: row.total_tokens,
      limit,
      percentUsed: limit > 0 ? (row.total_tokens / limit) * 100 : 0,
    };

    return {
      runId: createRunId(row.run_id),
      sessionId: createSessionId(row.session_id),
      label: row.label,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalTokens: row.total_tokens,
      toolCallCount: row.tool_call_count,
      budget,
    };
  }

  // ─── Tool calls ────────────────────────────────────────────────────────────

  async insertToolCallStart(input: ToolCallInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO cp_tool_calls
         (tool_call_id, run_id, session_id, tool_name, arguments, started_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.toolCallId,
        input.runId,
        input.sessionId,
        input.toolName,
        JSON.stringify(input.arguments),
        input.startedAt,
      ]
    );
  }

  async updateToolCallEnd(result: ToolCallResult): Promise<void> {
    await this.pool.query(
      `UPDATE cp_tool_calls
       SET output        = $2,
           input_tokens  = $3,
           output_tokens = $4,
           total_tokens  = $5,
           duration_ms   = $6,
           completed_at  = $7
       WHERE tool_call_id = $1`,
      [
        result.toolCallId,
        JSON.stringify(result.output),
        result.inputTokens,
        result.outputTokens,
        result.totalTokens,
        result.durationMs,
        result.completedAt,
      ]
    );
  }

  /** Returns recent tool call names for loop detection */
  async getRecentToolNames(runId: RunId, limit: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ tool_name: string }>(
      `SELECT tool_name FROM cp_tool_calls
       WHERE run_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [runId, limit]
    );
    return rows.map((r) => r.tool_name);
  }

  // ─── Budget snapshots ──────────────────────────────────────────────────────

  async saveBudgetSnapshot(
    runId: RunId,
    toolCallId: ToolCallId,
    budget: TokenBudget
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO cp_budget_snapshots
         (run_id, tool_call_id, tokens_used, tokens_limit, percent_used)
       VALUES ($1, $2, $3, $4, $5)`,
      [runId, toolCallId, budget.used, budget.limit, budget.percentUsed.toFixed(2)]
    );
  }

  async getBudgetTimeline(
    runId: RunId
  ): Promise<Array<{ at: Date; used: number; pct: number }>> {
    const { rows } = await this.pool.query<{
      snapshot_at: Date;
      tokens_used: number;
      percent_used: string;
    }>(
      `SELECT snapshot_at, tokens_used, percent_used
       FROM cp_budget_snapshots
       WHERE run_id = $1
       ORDER BY snapshot_at ASC`,
      [runId]
    );
    return rows.map((r) => ({
      at: r.snapshot_at,
      used: r.tokens_used,
      pct: parseFloat(r.percent_used),
    }));
  }

  // ─── Alerts ────────────────────────────────────────────────────────────────

  async saveAlert(
    runId: RunId,
    alertType: "warning" | "critical" | "overflow" | "loop_detected",
    detail: Record<string, unknown>,
    toolName?: string,
    tokensUsed?: number,
    percentUsed?: number
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO cp_alerts
         (run_id, alert_type, tool_name, tokens_used, percent_used, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        runId,
        alertType,
        toolName ?? null,
        tokensUsed ?? null,
        percentUsed !== undefined ? percentUsed.toFixed(2) : null,
        JSON.stringify(detail),
      ]
    );
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  async getSessionContextLimit(sessionId: SessionId): Promise<number> {
    const { rows } = await this.pool.query<{ context_limit: number }>(
      `SELECT context_limit FROM cp_sessions WHERE session_id = $1`,
      [sessionId]
    );
    return rows[0]?.context_limit ?? 200_000;
  }

  async getRunTokensUsed(runId: RunId): Promise<number> {
    const { rows } = await this.pool.query<{ total_tokens: number }>(
      `SELECT total_tokens FROM cp_runs WHERE run_id = $1`,
      [runId]
    );
    return rows[0]?.total_tokens ?? 0;
  }
}
