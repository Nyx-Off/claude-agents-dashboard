# Claude Agents Dashboard

> **[Lire en francais](README.fr.md)**

**Real-time 8-bit dashboard for monitoring Claude Code agents.**

Every agent spawned by Claude Code appears live on the dashboard with its actions, commands, files read/written, and a unique pixel-art sprite.

---

## What it does

- Displays each agent (Explorer, Planner, Reviewer...) with a unique pixel-art sprite
- Lists every tool call per agent in real time (Bash, Read, Write, Grep, Glob...)
- Precise attribution: each tool call is linked to the correct agent, even with multiple agents running in parallel
- Global activity log, XP system, click-to-expand details
- Zero framework, zero build step, zero npm dependencies

## Architecture

```
Claude Code CLI  ──hook.sh──>  Node.js Server (localhost:8787)  <──poll──  Dashboard (browser)
```

1. Claude Code **hooks** (`PreToolUse` / `PostToolUse`) send each event to the server via `hook.sh`
2. The Node.js **server** stores state in memory and serves it through a JSON API
3. The HTML **dashboard** polls the server every second and renders everything in pixel art

---

## Prerequisites

| Tool | Version | Installation |
|---|---|---|
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org) or `winget install OpenJS.NodeJS.LTS` |
| **Claude Code CLI** | latest | `npm install -g @anthropic-ai/claude-code` |
| **bash** | any | Included with Git for Windows, WSL, macOS, Linux |
| **curl** | any | Included on macOS/Linux, included with Git for Windows |
| **jq** | any | Optional but recommended — `winget install jqlang.jq` / `brew install jq` / `apt install jq` |

> **Windows note**: Git for Windows provides `bash` and `curl` in Git Bash. Make sure `bash` is in your PATH (it is by default with Git for Windows).

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/Nyx-Off/claude-agents-dashboard.git
cd claude-agents-dashboard
```

### 2. Configure Claude Code hooks

Add this to your `~/.claude/settings.json`:

**Linux / macOS:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/claude-agents-dashboard/hook.sh pre"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/claude-agents-dashboard/hook.sh post"
          }
        ]
      }
    ]
  }
}
```

**Windows (Git Bash):**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/Documents/claude-agents-dashboard/hook.sh pre"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/Documents/claude-agents-dashboard/hook.sh post"
          }
        ]
      }
    ]
  }
}
```

> Adjust the path depending on where you cloned the repo. `~` is resolved by bash.

> If you already have a `settings.json` with other options, just add the `hooks` section inside it.

### 3. Start the server

```bash
npm start
```

Or on Windows, double-click `start.bat`.

The server starts on `http://localhost:8787` and opens the browser automatically.

### 4. Use Claude Code normally

Launch Claude Code in any project. As soon as an agent is created (via the Agent tool), it appears on the dashboard with its tool calls in real time.

---

## Quick check

To verify everything works:

1. Start the server: `npm start`
2. Open http://localhost:8787 — you should see "Disconnected" then "Connected"
3. In Claude Code, ask something that spawns an agent, for example:
   ```
   Launch an Explorer agent to list the project files
   ```
4. The agent should appear on the dashboard with its actions

If the agent doesn't show up, check:
- The server is running (`curl http://localhost:8787/api/agents` should return JSON)
- The hooks are in `~/.claude/settings.json` (not in the project's settings.local.json)
- The path to `hook.sh` is correct and `bash` is in your PATH

---

## Advanced configuration

### Change the port

```bash
# Edit server.js line 5:
const PORT = 9000;
```

And update `DASHBOARD_URL` in the hook:
```bash
DASHBOARD_URL=http://localhost:9000 bash hook.sh pre
```

Or export the variable:
```bash
export DASHBOARD_URL=http://localhost:9000
```

### Server on a remote machine

The hook and server communicate via HTTP. You can run the server on a remote machine:

1. Edit `server.js` to listen on `0.0.0.0` instead of `127.0.0.1`:
   ```js
   server.listen(PORT, '0.0.0.0', () => { ... });
   ```
2. Set `DASHBOARD_URL=http://<server-ip>:8787` in the hooks

### Configurable limits (server.js)

| Constant | Default | Description |
|---|---|---|
| `PORT` | `8787` | Listening port |
| `MAX_AGENTS` | `50` | Max agents in memory |
| `MAX_TOOL_CALLS` | `50` | Max tool calls per agent |
| `MAX_LOG` | `200` | Max log entries |
| `DONE_TTL_MS` | `30 min` | Time before removing a finished agent |
| `IDLE_TIMEOUT_MS` | `15 s` | Inactivity delay before marking an agent "done" |

---

## Project structure

```
claude-agents-dashboard/
├── server.js        # Node.js HTTP server (API + static files)
├── index.html       # Browser dashboard (vanilla HTML/CSS/JS)
├── hook.sh          # Bash script called by Claude Code hooks
├── start.bat        # Windows launcher (double-click)
├── package.json     # npm metadata
├── agents.json      # Runtime state (auto-generated, gitignored)
├── README.md        # This file (English)
├── README.fr.md     # French version
├── CONTRIBUTING.md
└── LICENSE          # MIT
```

---

## How it works (in detail)

### Tool call attribution

Claude Code provides `agent_id` and `agent_type` in the hook JSON for tool calls made by sub-agents. Parent-level tools (main conversation) do not have these fields.

The hook uses this distinction to:
- **Ignore** parent-level tools (no pollution)
- **Precisely attribute** each tool call to the correct agent

When an agent is launched, the hook sends a `start` event. Subsequent tool calls arrive with the native `agent_id` from Claude Code, enabling 1:1 attribution even with multiple agents running in parallel.

### Auto-detection of agent completion

The `PostToolUse` hook for the Agent tool fires when the agent is **dispatched**, not when it finishes. The server automatically detects agent completion: if no tool call is received for 15 seconds, the agent is marked "done".

### Composable sprites

Each agent gets a unique face generated from its ID via a composable system:
- 3 head shapes x 6 eye pairs x 4 mouths x 5 accessories = **360 combinations**
- The same agent always gets the same face (deterministic hash)
- Eyes animate while the agent is working

---

## Uninstall

1. Delete the project folder
2. Remove the `hooks` section from `~/.claude/settings.json`

---

## License

[MIT](LICENSE)
