import { Controller, Get, Query } from "@nestjs/common";
import { pool } from "../../shared.js";

interface AlertDto {
  id: number;
  runId: string;
  alertType: string;
  toolName: string | null;
  tokensUsed: number | null;
  percentUsed: number | null;
  firedAt: Date;
}

@Controller("alerts")
export class AlertsController {
  @Get()
  async listAlerts(
    @Query("limit") limit = "50",
    @Query("type") type?: string
  ): Promise<AlertDto[]> {
    const limitNum = Math.min(parseInt(limit, 10) || 50, 200);
    const { rows } = await pool.query<{
      id: number; run_id: string; alert_type: string;
      tool_name: string | null; tokens_used: number | null;
      percent_used: string | null; fired_at: Date;
    }>(
      type !== undefined
        ? `SELECT id, run_id, alert_type, tool_name, tokens_used, percent_used, fired_at FROM cp_alerts WHERE alert_type = $1 ORDER BY fired_at DESC LIMIT $2`
        : `SELECT id, run_id, alert_type, tool_name, tokens_used, percent_used, fired_at FROM cp_alerts ORDER BY fired_at DESC LIMIT $1`,
      type !== undefined ? [type, limitNum] : [limitNum]
    );
    return rows.map((r) => ({
      id: r.id, runId: r.run_id, alertType: r.alert_type,
      toolName: r.tool_name, tokensUsed: r.tokens_used,
      percentUsed: r.percent_used !== null ? parseFloat(r.percent_used) : null,
      firedAt: r.fired_at,
    }));
  }
}
