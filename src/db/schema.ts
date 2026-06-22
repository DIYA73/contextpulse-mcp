import pg from "pg";

export const SCHEMA_SQL = /* sql */ `
-- Sessions: one session = one agent coding session (e.g. one Claude Code window)
CREATE TABLE IF NOT EXISTS cp_sessions (
  session_id   TEXT        PRIMARY KEY,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at     TIMESTAMPTZ,
  context_limit INT         NOT NULL DEFAULT 200000,
  label        TEXT
);

-- Runs: one run = one agent task inside a session
CREATE TABLE IF NOT EXISTS cp_runs (
  run_id               TEXT        PRIMARY KEY,
  session_id           TEXT        NOT NULL REFERENCES cp_sessions(session_id) ON DELETE CASCADE,
  label                TEXT,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at             TIMESTAMPTZ,
  total_input_tokens   INT         NOT NULL DEFAULT 0,
  total_output_tokens  INT         NOT NULL DEFAULT 0,
  total_tokens         INT         NOT NULL DEFAULT 0,
  tool_call_count      INT         NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS cp_runs_session_idx ON cp_runs(session_id);

-- Tool calls: every intercepted tool call
CREATE TABLE IF NOT EXISTS cp_tool_calls (
  tool_call_id     TEXT        PRIMARY KEY,
  run_id           TEXT        NOT NULL REFERENCES cp_runs(run_id) ON DELETE CASCADE,
  session_id       TEXT        NOT NULL,
  tool_name        TEXT        NOT NULL,
  arguments        JSONB,
  output           JSONB,
  input_tokens     INT         NOT NULL DEFAULT 0,
  output_tokens    INT         NOT NULL DEFAULT 0,
  total_tokens     INT         NOT NULL DEFAULT 0,
  duration_ms      INT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cp_tool_calls_run_idx     ON cp_tool_calls(run_id);
CREATE INDEX IF NOT EXISTS cp_tool_calls_session_idx ON cp_tool_calls(session_id);
CREATE INDEX IF NOT EXISTS cp_tool_calls_name_idx    ON cp_tool_calls(tool_name);

-- Budget snapshots: stored after every tool call for timeline charting
CREATE TABLE IF NOT EXISTS cp_budget_snapshots (
  id            SERIAL      PRIMARY KEY,
  run_id        TEXT        NOT NULL REFERENCES cp_runs(run_id) ON DELETE CASCADE,
  tool_call_id  TEXT        NOT NULL,
  tokens_used   INT         NOT NULL,
  tokens_limit  INT         NOT NULL,
  percent_used  NUMERIC(5,2) NOT NULL,
  snapshot_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cp_budget_snapshots_run_idx ON cp_budget_snapshots(run_id);

-- Alerts: warnings / criticals fired during a run
CREATE TABLE IF NOT EXISTS cp_alerts (
  id           SERIAL      PRIMARY KEY,
  run_id       TEXT        NOT NULL REFERENCES cp_runs(run_id) ON DELETE CASCADE,
  alert_type   TEXT        NOT NULL CHECK (alert_type IN ('warning','critical','overflow','loop_detected')),
  tool_name    TEXT,
  tokens_used  INT,
  percent_used NUMERIC(5,2),
  detail       JSONB,
  fired_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cp_alerts_run_idx ON cp_alerts(run_id);
`;

export async function runMigration(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(SCHEMA_SQL);
    await client.query("COMMIT");
    console.log("[contextpulse] DB schema ready");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
