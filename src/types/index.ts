// ─── Branded IDs (zero runtime cost, full type safety) ───────────────────────
export type SessionId = string & { readonly __brand: "SessionId" };
export type RunId = string & { readonly __brand: "RunId" };
export type ToolCallId = string & { readonly __brand: "ToolCallId" };

export function createSessionId(id: string): SessionId {
  return id as SessionId;
}
export function createRunId(id: string): RunId {
  return id as RunId;
}
export function createToolCallId(id: string): ToolCallId {
  return id as ToolCallId;
}

// ─── Token budget ─────────────────────────────────────────────────────────────
export interface TokenBudget {
  used: number;
  limit: number;
  /** 0–100 */
  percentUsed: number;
}

export type BudgetStatus =
  | { status: "ok" }
  | { status: "warning"; percentUsed: number }
  | { status: "critical"; percentUsed: number }
  | { status: "overflow"; exceeded: number };

export function getBudgetStatus(budget: TokenBudget): BudgetStatus {
  const p = budget.percentUsed;
  if (p >= 100) return { status: "overflow", exceeded: budget.used - budget.limit };
  if (p >= 90) return { status: "critical", percentUsed: p };
  if (p >= 70) return { status: "warning", percentUsed: p };
  return { status: "ok" };
}

// ─── Tool call ────────────────────────────────────────────────────────────────
export interface ToolCallInput {
  toolCallId: ToolCallId;
  runId: RunId;
  sessionId: SessionId;
  toolName: string;
  arguments: unknown;
  startedAt: Date;
}

export interface ToolCallResult {
  toolCallId: ToolCallId;
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  completedAt: Date;
  budget: TokenBudget;
  budgetStatus: BudgetStatus;
}

export type ToolCallEvent =
  | { event: "tool_call_start"; data: ToolCallInput }
  | { event: "tool_call_end"; data: ToolCallResult }
  | { event: "budget_warning"; data: { runId: RunId; budget: TokenBudget } }
  | { event: "budget_critical"; data: { runId: RunId; budget: TokenBudget } }
  | { event: "loop_detected"; data: { runId: RunId; toolName: string; count: number } };

// ─── Run ──────────────────────────────────────────────────────────────────────
export interface AgentRun {
  runId: RunId;
  sessionId: SessionId;
  label: string | null;
  startedAt: Date;
  endedAt: Date | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  toolCallCount: number;
  budget: TokenBudget;
}

// ─── Config ───────────────────────────────────────────────────────────────────
export interface ContextPulseConfig {
  contextLimit: number;
  warningThresholdPct: number;
  criticalThresholdPct: number;
  loopDetectionThreshold: number;
  model: string;
  db: {
    connectionString: string;
  };
}
