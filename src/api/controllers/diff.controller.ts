import { Controller, Get, Query, BadRequestException, NotFoundException } from "@nestjs/common";
import { pool } from "../../shared.js";

interface RunRow { run_id: string; session_id: string; label: string | null; started_at: Date; total_input_tokens: number; total_output_tokens: number; total_tokens: number; tool_call_count: number; context_limit: number; }
interface ToolCallRow { tool_name: string; total_tokens: number; duration_ms: number | null; }
interface AlertRow { alert_type: string; }
interface ToolSummary { toolName: string; callCount: number; totalTokens: number; avgTokens: number; isLoop: boolean; }
interface RunDiffSide { runId: string; label: string | null; startedAt: Date; totalTokens: number; totalInputTokens: number; totalOutputTokens: number; toolCallCount: number; contextLimit: number; percentUsed: number; budgetStatus: string; alertCount: number; loopCount: number; tools: ToolSummary[]; }
interface ToolDiff { toolName: string; countA: number; countB: number; tokensA: number; tokensB: number; deltaTokens: number; onlyIn: "a" | "b" | "both"; loopA: boolean; loopB: boolean; }
export interface RunDiffResponse { runA: RunDiffSide; runB: RunDiffSide; diff: { totalTokensDelta: number; totalTokensDeltaPercent: number; tokenWinner: "a" | "b" | "tie"; toolCallCountDelta: number; toolCallWinner: "a" | "b" | "tie"; percentUsedDelta: number; budgetWinner: "a" | "b" | "tie"; tools: ToolDiff[]; newLoopsInB: string[]; resolvedLoopsFromA: string[]; summary: string; }; }

function status(pct: number) { if (pct >= 100) return "overflow"; if (pct >= 90) return "critical"; if (pct >= 70) return "warning"; return "ok"; }
function winner(a: number, b: number): "a" | "b" | "tie" { return a < b ? "a" : b < a ? "b" : "tie"; }

async function fetchSide(runId: string): Promise<RunDiffSide> {
  const { rows } = await pool.query<RunRow>(`SELECT r.*, s.context_limit FROM cp_runs r JOIN cp_sessions s ON s.session_id = r.session_id WHERE r.run_id = $1`, [runId]);
  const run = rows[0];
  if (!run) throw new NotFoundException(`Run ${runId} not found`);
  const { rows: tcs } = await pool.query<ToolCallRow>(`SELECT tool_name, total_tokens, duration_ms FROM cp_tool_calls WHERE run_id = $1`, [runId]);
  const { rows: alerts } = await pool.query<AlertRow>(`SELECT alert_type FROM cp_alerts WHERE run_id = $1`, [runId]);
  const toolMap = new Map<string, { count: number; tokens: number }>();
  for (const tc of tcs) {
    const p = toolMap.get(tc.tool_name) ?? { count: 0, tokens: 0 };
    toolMap.set(tc.tool_name, { count: p.count + 1, tokens: p.tokens + tc.total_tokens });
  }
  const tools: ToolSummary[] = Array.from(toolMap.entries()).map(([toolName, { count, tokens }]) => ({ toolName, callCount: count, totalTokens: tokens, avgTokens: count > 0 ? Math.round(tokens / count) : 0, isLoop: count >= 3 }));
  const pct = run.context_limit > 0 ? parseFloat(((run.total_tokens / run.context_limit) * 100).toFixed(2)) : 0;
  return { runId: run.run_id, label: run.label, startedAt: run.started_at, totalTokens: run.total_tokens, totalInputTokens: run.total_input_tokens, totalOutputTokens: run.total_output_tokens, toolCallCount: run.tool_call_count, contextLimit: run.context_limit, percentUsed: pct, budgetStatus: status(pct), alertCount: alerts.length, loopCount: alerts.filter(a => a.alert_type === "loop_detected").length, tools };
}

@Controller("diff")
export class DiffController {
  @Get()
  async getDiff(@Query("runA") runAId?: string, @Query("runB") runBId?: string): Promise<RunDiffResponse> {
    if (!runAId || !runBId) throw new BadRequestException("Both runA and runB are required");
    if (runAId === runBId) throw new BadRequestException("runA and runB must be different");
    const [runA, runB] = await Promise.all([fetchSide(runAId), fetchSide(runBId)]);
    const allTools = new Set([...runA.tools.map(t => t.toolName), ...runB.tools.map(t => t.toolName)]);
    const tools: ToolDiff[] = Array.from(allTools).map(toolName => {
      const a = runA.tools.find(t => t.toolName === toolName);
      const b = runB.tools.find(t => t.toolName === toolName);
      return { toolName, countA: a?.callCount ?? 0, countB: b?.callCount ?? 0, tokensA: a?.totalTokens ?? 0, tokensB: b?.totalTokens ?? 0, deltaTokens: (b?.totalTokens ?? 0) - (a?.totalTokens ?? 0), onlyIn: (a && b ? "both" : a ? "a" : "b") as "a" | "b" | "both", loopA: a?.isLoop ?? false, loopB: b?.isLoop ?? false };
    }).sort((x, y) => Math.abs(y.deltaTokens) - Math.abs(x.deltaTokens));
    const loopsA = new Set(runA.tools.filter(t => t.isLoop).map(t => t.toolName));
    const loopsB = new Set(runB.tools.filter(t => t.isLoop).map(t => t.toolName));
    const newLoopsInB = [...loopsB].filter(t => !loopsA.has(t));
    const resolvedLoopsFromA = [...loopsA].filter(t => !loopsB.has(t));
    const td = runB.totalTokens - runA.totalTokens;
    const tdp = runA.totalTokens > 0 ? parseFloat(((td / runA.totalTokens) * 100).toFixed(1)) : 0;
    const tcd = runB.toolCallCount - runA.toolCallCount;
    const pd = parseFloat((runB.percentUsed - runA.percentUsed).toFixed(2));
    const parts: string[] = [];
    if (winner(runA.totalTokens, runB.totalTokens) === "a") parts.push(`Run A used ${Math.abs(td).toLocaleString()} fewer tokens (${Math.abs(tdp)}% more efficient)`);
    else if (winner(runA.totalTokens, runB.totalTokens) === "b") parts.push(`Run B used ${Math.abs(td).toLocaleString()} fewer tokens (${Math.abs(tdp)}% more efficient)`);
    else parts.push("Both runs used identical token counts");
    if (newLoopsInB.length > 0) parts.push(`Run B introduced ${newLoopsInB.length} new loop(s): ${newLoopsInB.join(", ")}`);
    if (resolvedLoopsFromA.length > 0) parts.push(`Run B resolved ${resolvedLoopsFromA.length} loop(s): ${resolvedLoopsFromA.join(", ")}`);
    return { runA, runB, diff: { totalTokensDelta: td, totalTokensDeltaPercent: tdp, tokenWinner: winner(runA.totalTokens, runB.totalTokens), toolCallCountDelta: tcd, toolCallWinner: winner(runA.toolCallCount, runB.toolCallCount), percentUsedDelta: pd, budgetWinner: winner(runA.percentUsed, runB.percentUsed), tools, newLoopsInB, resolvedLoopsFromA, summary: parts.join(". ") + "." } };
  }
}
