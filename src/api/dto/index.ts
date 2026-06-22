export interface RunSummaryDto {
  runId: string; sessionId: string; label: string | null;
  startedAt: Date; endedAt: Date | null;
  totalInputTokens: number; totalOutputTokens: number; totalTokens: number;
  toolCallCount: number;
  budget: { used: number; limit: number; percentUsed: number; };
  budgetStatus: "ok" | "warning" | "critical" | "overflow";
}
export interface ToolCallDto {
  toolCallId: string; runId: string; toolName: string;
  inputTokens: number; outputTokens: number; totalTokens: number;
  durationMs: number | null; startedAt: Date; completedAt: Date | null;
}
export interface BudgetSnapshotDto { at: Date; used: number; pct: number; }
export interface AlertDto {
  id: number; runId: string; alertType: string; toolName: string | null;
  tokensUsed: number | null; percentUsed: number | null; firedAt: Date;
}
export interface SessionDto {
  sessionId: string; startedAt: Date; endedAt: Date | null;
  contextLimit: number; label: string | null; runCount: number;
}
export type WsEvent =
  | { event: "tool_call_end"; data: ToolCallDto & { budget: RunSummaryDto["budget"]; budgetStatus: string } }
  | { event: "budget_warning"; data: { runId: string; budget: RunSummaryDto["budget"] } }
  | { event: "budget_critical"; data: { runId: string; budget: RunSummaryDto["budget"] } }
  | { event: "loop_detected"; data: { runId: string; toolName: string; count: number } }
  | { event: "run_started"; data: { runId: string; sessionId: string; label: string | null } }
  | { event: "run_ended"; data: { runId: string } };
