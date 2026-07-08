# runway

Mini TUI (built with [OpenTUI](https://opentui.com/)) that shows live usage for your
**Claude Max** and **Codex (ChatGPT)** subscriptions: 5h session, weekly limits,
extra usage credits, and credits.

```
╭─ Claude Max ──────────────────────────────╮
│ Session 5h   ██████░░░░░░░░  40%  4h 25m  │
│ Week         ████████░░░░░░  56%  2d 8h   │
│ Extra usage  ██████░░░░░░░░  42%  $83.85 / $200.00
╰───────────────────────────────────────────╯
╭─ Codex (ChatGPT) ─────────────────────────╮
│ Session 5h   ░░░░░░░░░░░░░░   1%  4h 59m  │
│ Week         ███████░░░░░░░  52%  5d 12h  │
│ Credits      unlimited                    │
╰───────────────────────────────────────────╯
 r refresh · q quit · 12s ago
```

The interface follows your terminal's light/dark theme, including terminals set to
"system auto" that track the OS appearance (and it re-themes live when it changes).

## Requirements

- [Bun](https://bun.sh)
- A **Claude Code** session on this machine (the token is read from the macOS Keychain,
  entry `Claude Code-credentials`; fallback: `~/.claude/.credentials.json` or
  `CLAUDE_CODE_OAUTH_TOKEN`)
- A **Codex CLI** session (`codex login` creates `~/.codex/auth.json`)

## Usage

```bash
bun start            # or: bun src/index.ts
```

Keys: `r` refreshes (with a 10 s throttle), `q` or `Ctrl+C` quits.
Auto-refresh every 3 minutes; countdowns tick every second without refetching.

Optional global command: `make install` compiles and installs `runway` into
`~/.local/bin` (or elsewhere with `make install INSTALL_DIR=/usr/local/bin`).
You can also use `bun link`, which makes `runway` available on Bun's PATH.

## Where the data comes from

| Service | Endpoint | Auth |
|---|---|---|
| Claude Max | `GET https://api.anthropic.com/api/oauth/usage` | Bearer from the Keychain + `anthropic-beta: oauth-2025-04-20` + `User-Agent: claude-code/<v>` |
| Codex | `GET https://chatgpt.com/backend-api/wham/usage` | Bearer from `~/.codex/auth.json` + `chatgpt-account-id` header |

If the Codex token expires, it's refreshed against `https://auth.openai.com/oauth/token`
(same flow and client id as the official CLI) and persisted to `auth.json`.

## Caveats

- **Internal/undocumented endpoints**: they're the same ones used by Claude Code's
  `/usage` and Codex's `/status`, but they can change without notice. They're read-only:
  the worst that can happen is the CLI shows an error.
- **Don't lower the 180 s polling** for Claude or drop the `User-Agent: claude-code/...`:
  without it, the endpoint returns 429 persistently.
- The Claude token expires every ~60 min and Claude Code refreshes it on use; if you see
  "Token expired", open Claude Code.
- The Codex refresh token **rotates** on every refresh: don't share `auth.json` across
  machines at the same time.
- Claude's extra usage arrives in cents of a dollar; it's shown as `$used / $limit`.
- On ChatGPT Team/Business plans, Codex credits are a shared workspace pool and the API
  returns `balance: null` — the balance is only visible on the admin's billing page at
  chatgpt.com. The panel shows the pool status, the available window resets, and today's
  activity (from `wham/profiles/me`).
- Tokens are only sent to `api.anthropic.com`, `chatgpt.com`, and `auth.openai.com`.
  No telemetry, no third parties.
