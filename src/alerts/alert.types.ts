export type AlertJobName = "budget_warning" | "budget_critical" | "budget_overflow" | "loop_detected";

export interface BudgetAlertPayload {
  type: "budget_warning" | "budget_critical" | "budget_overflow";
  runId: string;
  sessionId: string;
  tokensUsed: number;
  tokenLimit: number;
  percentUsed: number;
  firedAt: string;
}

export interface LoopAlertPayload {
  type: "loop_detected";
  runId: string;
  sessionId: string;
  toolName: string;
  count: number;
  firedAt: string;
}

export type AlertJobPayload = BudgetAlertPayload | LoopAlertPayload;

export function isBudgetAlert(p: AlertJobPayload): p is BudgetAlertPayload {
  return p.type === "budget_warning" || p.type === "budget_critical" || p.type === "budget_overflow";
}

export function isLoopAlert(p: AlertJobPayload): p is LoopAlertPayload {
  return p.type === "loop_detected";
}
