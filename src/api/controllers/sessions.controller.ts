import { Controller, Get, Param, NotFoundException } from "@nestjs/common";
import { pool } from "../../shared.js";
import type { SessionDto } from "../dto/index.js";

@Controller("sessions")
export class SessionsController {
  @Get()
  async listSessions(): Promise<SessionDto[]> {
    const { rows } = await pool.query<{ session_id: string; started_at: Date; ended_at: Date | null; context_limit: number; label: string | null; run_count: string; }>(
      `SELECT s.*, COUNT(r.run_id) AS run_count FROM cp_sessions s LEFT JOIN cp_runs r ON r.session_id = s.session_id GROUP BY s.session_id ORDER BY s.started_at DESC LIMIT 50`
    );
    return rows.map((r) => ({ sessionId: r.session_id, startedAt: r.started_at, endedAt: r.ended_at, contextLimit: r.context_limit, label: r.label, runCount: parseInt(r.run_count, 10) }));
  }

  @Get(":sessionId")
  async getSession(@Param("sessionId") sessionId: string): Promise<SessionDto> {
    const { rows } = await pool.query<{ session_id: string; started_at: Date; ended_at: Date | null; context_limit: number; label: string | null; run_count: string; }>(
      `SELECT s.*, COUNT(r.run_id) AS run_count FROM cp_sessions s LEFT JOIN cp_runs r ON r.session_id = s.session_id WHERE s.session_id = $1 GROUP BY s.session_id`, [sessionId]
    );
    const row = rows[0];
    if (row === undefined) throw new NotFoundException(`Session ${sessionId} not found`);
    return { sessionId: row.session_id, startedAt: row.started_at, endedAt: row.ended_at, contextLimit: row.context_limit, label: row.label, runCount: parseInt(row.run_count, 10) };
  }
}
