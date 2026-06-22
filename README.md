# contextpulse-mcp

**Real-time context budget tracking for any AI coding agent.**

Plug into Claude Code, Cursor, or any MCP-compatible tool and get:

- 📊 Live token budget bar per agent run
- 🔁 Loop detection (when an agent calls the same tool 3× in a row)
- ⚠️ Warning / critical alerts before context overflow
- 🗄️ Full run history stored in PostgreSQL
- 📈 Budget timeline for every run

No cloud. No telemetry. Runs entirely on your machine.

---

## How it works

ContextPulse is a **transparent MCP server**. You call its tracking tools from
your agent's workflow. It counts tokens using `tiktoken`, updates a live budget
in memory, persists everything to PostgreSQL, and fires alerts when thresholds
are crossed.

```
Your agent → calls cp_track_tool_call → ContextPulse counts tokens
                                       → updates live budget
                                       → warns at 70% / 90%
                                       → detects loops
                                       → saves to DB
```

---

## Quick start

### 1. Start PostgreSQL

```bash
# macOS with Homebrew
brew services start postgresql@16

# or via Docker
docker run -d --name contextpulse-db \
  -e POSTGRES_DB=contextpulse \
  -p 5432:5432 postgres:16
```

### 2. Add to Claude Code (`~/.claude/settings.json`)

```json
{
  "mcpServers": {
    "contextpulse": {
      "command": "npx",
      "args": ["-y", "contextpulse-mcp"],
      "env": {
        "DATABASE_URL": "postgresql://apple@localhost:5432/contextpulse"
      }
    }
  }
}
```

### 3. Add to Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "contextpulse": {
      "command": "npx",
      "args": ["-y", "contextpulse-mcp"],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/contextpulse"
      }
    }
  }
}
```

> The DB schema is created automatically on first run.

---

## Usage in your agent

```
1. cp_start_session   → get sessionId
2. cp_start_run       → get runId
3. cp_track_tool_call → after every tool call (pass tool name, args, output)
4. cp_get_budget      → check current budget at any time
5. cp_get_run_summary → full run summary with timeline
6. cp_end_run         → clean up
```

### Example response from `cp_track_tool_call`

```json
{
  "toolCallId": "a1b2c3...",
  "inputTokens": 142,
  "outputTokens": 87,
  "totalTokens": 229,
  "budget": {
    "used": 14820,
    "limit": 200000,
    "percentUsed": 7.41
  },
  "budgetStatus": "ok",
  "alert": null
}
```

When budget hits 70%:

```json
{
  "budgetStatus": "warning",
  "alert": "warning"
}
```

---

## Environment variables

| Variable                  | Default                                        | Description                      |
|---------------------------|------------------------------------------------|----------------------------------|
| `DATABASE_URL`            | `postgresql://apple@localhost:5432/contextpulse` | PostgreSQL connection string     |
| `CONTEXT_LIMIT`           | `200000`                                       | Token limit per session          |
| `WARNING_THRESHOLD_PCT`   | `70`                                           | Warning alert threshold (%)      |
| `CRITICAL_THRESHOLD_PCT`  | `90`                                           | Critical alert threshold (%)     |
| `LOOP_DETECTION_THRESHOLD`| `3`                                            | Same tool calls before loop alert|
| `MODEL`                   | `claude-sonnet-4-6`                            | Model label for records          |

---

## What gets stored

```sql
cp_sessions       -- one row per coding session
cp_runs           -- one row per agent task
cp_tool_calls     -- every intercepted tool call
cp_budget_snapshots -- token usage timeline per run
cp_alerts         -- warnings, criticals, loop detections
```

---

## Roadmap

- [ ] Phase 2: Next.js real-time dashboard with WebSocket stream
- [ ] Phase 3: Loop detection graph + BullMQ alert jobs
- [ ] Phase 4: Run diff engine — compare two agent runs side by side

---

## License

MIT
