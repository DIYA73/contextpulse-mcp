import { Controller, Get, Param, Query, NotFoundException } from "@nestjs/common";
import { pool, tracker } from "../../shared.js";
import { getBudgetStatus } from "../../types/index.js";
import type { RunSummaryDto, ToolCallDto, BudgetSnapshotDto, AlertDto } from "../dto/index.js";

@Controller("runs")
export class RunsController {
  @Get()
  async listRuns(@Query("sessionId") sessionId?: string, @Query("limit") limit = "20"): Promise<RunSummaryDto[]> {
    const limitNum = Math.min(parseInt(limit, 10) || 20, 100);
    const { rows } = await pool.query<{ run_id: string; session_id: string; label: string | null; started_at: Date; ended_at: Date | null; total_input_tokens: number; total_output_tokens: number; total_tokens: number; tool_call_count: number; context_limit: number; }>(
      sessionId !== undefined
        ? `SELECT r.*, s.context_limit FROM cp_runs r JOIN cp_sessions s ON s.session_id = r.session_id WHERE r.session_id = $1 ORDER BY r.started_at DESC LIMIT $2`
        : `SELECT r.*, s.context_limit FROM cp_runs r JOIN cp_sessions s ON s.session_id = r.session_id ORDER BY r.started_at DESC LIMIT $1`,
      sessionId !== undefined ? [sessionId, limitNum] : [limitNum]
    );
    return rows.map((r) => this.toDto(r));
  }

  @Get("live/active")
  getActiveRuns(): Array<{ runId: string; budget: { used: number; limit: number; percentUsed: number } }> {
    return tracker.getActiveRuns();
  }

  @Get(":id")
  async getRun(@Param("id") id: string): Promise<RunSummaryDto> {
    const { rows } = await pool.query<{ run_id: string; session_id: string; label: string | null; started_at: Date; ended_at: Date | null; total_input_tokens: number; total_output_tokens: number; total_tokens: number; tool_call_count: number; context_limit: number; }>(
      `SELECT r.*, s.context_limit FROM cp_runs r JOIN cp_sessions s ON s.session_id = r.session_id WHERE r.run_id = $1`, [id]
    );
    const row = rows[0];
    if (row === undefined) throw new NotFoundException(`Run ${id} not found`);
    return this.toDto(row);
  }

  @Get(":id/timeline")
  async getTimeline(@Param("id") id: string): Promise<BudgetSnapshotDto[]> {
    const { rows } = await pool.query<{ snapshot_at: Date; tokens_used: number; percent_used: string; }>(
      `SELECT snapshot_at, tokens_used, percent_used FROM cp_budget_snapshots WHERE run_id = $1 ORDER BY snapshot_at ASC`, [id]
    );
    return rows.map((r) => ({ at: r.snapshot_at, used: r.tokens_used, pct: parseFloat(r.percent_used) }));
  }

  @Get(":id/tool-calls")
  async getToolCalls(@Param("id") id: string): Promise<ToolCallDto[]> {
    const { rows } = await pool.query<{ tool_call_id: string; run_id: string; tool_name: string; input_tokens: number; output_tokens: number; total_tokens: number; duration_ms: number | null; started_at: Date; completed_at: Date | null; }>(
      `SELECT tool_call_id, run_id, tool_name, input_tokens, output_tokens, total_tokens, duration_ms, started_at, completed_at FROM cp_tool_calls WHERE run_id = $1 ORDER BY started_at ASC`, [id]
    );
    return rows.map((r) => ({ toolCallId: r.tool_call_id, runId: r.run_id, toolName: r.tool_name, inputTokens: r.input_tokens, outputTokens: r.output_tokens, totalTokens: r.total_tokens, durationMs: r.duration_ms, startedAt: r.started_at, completedAt: r.completed_at }));
  }

  @Get(":id/alerts")
  async getAlerts(@Param("id") id: string): Promise<AlertDto[]> {
    const { rows } = await pool.query<{ id: number; run_id: string; alert_type: string; tool_name: string | null; tokens_used: number | null; percent_used: string | null; fired_at: Date; }>(
      `SELECT id, run_id, alert_type, tool_name, tokens_used, percent_used, fired_at FROM cp_alerts WHERE run_id = $1 ORDER BY fired_at ASC`, [id]
    );
    return rows.map((r) => ({ id: r.id, runId: r.run_id, alertType: r.alert_type, toolName: r.tool_name, tokensUsed: r.tokens_used, percentUsed: r.percent_used !== null ? parseFloat(r.percent_used) : null, firedAt: r.fired_at }));
  }

  private toDto(r: { run_id: string; session_id: string; label: string | null; started_at: Date; ended_at: Date | null; total_input_tokens: number; total_output_tokens: number; total_tokens: number; tool_call_count: number; context_limit: number; }): RunSummaryDto {
    const budget = { used: r.total_tokens, limit: r.context_limit, percentUsed: r.context_limit > 0 ? parseFloat(((r.total_tokens / r.context_limit) * 100).toFixed(2)) : 0 };
    return { runId: r.run_id, sessionId: r.session_id, label: r.label, startedAt: r.started_at, endedAt: r.ended_at, totalInputTokens: r.total_input_tokens, totalOutputTokens: r.total_output_tokens, totalTokens: r.total_tokens, toolCallCount: r.tool_call_count, budget, budgetStatus: getBudgetStatus({ ...budget, percentUsed: budget.percentUsed }).status };
  }
}
