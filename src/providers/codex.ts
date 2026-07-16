import { homedir } from "node:os"
import { join } from "node:path"
import type { PanelData, UsageRow } from "../types"

export const CODEX_TITLE = "Codex (ChatGPT)"

const CODEX_HOME = process.env.CODEX_HOME ?? join(homedir(), ".codex")
const AUTH_PATH = join(CODEX_HOME, "auth.json")
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const TOKEN_URL = "https://auth.openai.com/oauth/token"
// Public OAuth client id of the official Codex CLI
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const REFRESH_MARGIN_MS = 5 * 60_000

function jwtExpMs(token: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString())
    return typeof payload.exp === "number" ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

/** Refreshes the access token if it expires soon and persists the rotation to auth.json (like the official CLI). */
async function refreshIfNeeded(auth: any): Promise<{ token: string; authError?: string }> {
  let token: string = auth.tokens.access_token
  const refreshToken = auth.tokens?.refresh_token
  const expMs = jwtExpMs(token)
  if (!refreshToken || expMs === null || expMs > Date.now() + REFRESH_MARGIN_MS) return { token }

  let res: Response
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: "openid profile email",
      }),
    })
  } catch {
    return { token } // no network: try with the current token and let the usage fetch fail
  }
  if (res.status === 400 || res.status === 401) {
    return { token, authError: "Refresh rejected: run `codex login` again" }
  }
  if (!res.ok) return { token }

  try {
    const fresh = await res.json()
    if (!fresh.access_token) return { token }
    token = fresh.access_token
    auth.tokens.access_token = fresh.access_token
    if (fresh.refresh_token) auth.tokens.refresh_token = fresh.refresh_token
    if (fresh.id_token) auth.tokens.id_token = fresh.id_token
    auth.last_refresh = new Date().toISOString()
    await Bun.write(AUTH_PATH, JSON.stringify(auth, null, 2))
  } catch {}
  return { token }
}

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

/** Today's activity and streak from wham/profiles/me; optional, never breaks the panel */
async function fetchActivity(headers: Record<string, string>): Promise<UsageRow | null> {
  try {
    const res = await fetch("https://chatgpt.com/backend-api/wham/profiles/me", { headers })
    if (!res.ok) return null
    const stats = (await res.json())?.stats
    if (!stats) return null
    const today = new Date().toISOString().slice(0, 10)
    const bucket = (stats.daily_usage_buckets ?? []).find((b: any) => b?.start_date === today)
    const parts = [`${fmtTokens(bucket?.tokens ?? 0)} tokens`]
    if (typeof stats.current_streak_days === "number" && stats.current_streak_days > 0) {
      parts.push(`streak ${stats.current_streak_days}d`)
    }
    return { label: "Today", pct: null, detail: parts.join(" · ") }
  } catch {
    return null
  }
}

export async function fetchCodex(): Promise<PanelData> {
  const title = CODEX_TITLE
  const file = Bun.file(AUTH_PATH)
  if (!(await file.exists())) return { title, rows: [], note: "Run `codex login` to connect your account" }

  let auth: any
  try {
    auth = await file.json()
  } catch {
    return { title, rows: [], note: "Couldn't read ~/.codex/auth.json" }
  }
  if (!auth?.tokens?.access_token) return { title, rows: [], note: "No token: run `codex login`" }

  const { token, authError } = await refreshIfNeeded(auth)
  if (authError) return { title, rows: [], note: authError }
  const accountId = auth.tokens?.account_id

  const headers = {
    Authorization: `Bearer ${token}`,
    ...(accountId ? { "chatgpt-account-id": accountId } : {}),
  }
  let res: Response
  let activity: UsageRow | null
  try {
    ;[res, activity] = await Promise.all([fetch(USAGE_URL, { headers }), fetchActivity(headers)])
  } catch {
    return { title, rows: [], note: "No connection to chatgpt.com" }
  }
  if (res.status === 401) return { title, rows: [], note: "Token expired: run `codex login`" }
  if (!res.ok) return { title, rows: [], note: `Error ${res.status} from the usage endpoint` }

  let data: any
  try {
    data = await res.json()
  } catch {
    return { title, rows: [], note: "Invalid response from the endpoint" }
  }

  const rows: UsageRow[] = []
  // ChatGPT no longer has a 5h session window: the primary window IS the
  // weekly one (limit_window_seconds 604800, secondary_window null). Label
  // from the actual duration so old and new shapes both read correctly.
  const windowLabel = (w: any, fallback: string): string => {
    const s = w?.limit_window_seconds
    if (s === 18_000) return "Session 5h"
    if (s === 604_800) return "Week"
    if (typeof s === "number" && s > 0) {
      const h = Math.round(s / 3600)
      return h < 48 ? `Window ${h}h` : `Window ${Math.round(h / 24)}d`
    }
    return fallback
  }
  const window = (label: string, w: any, derive = false) => {
    if (!w || typeof w.used_percent !== "number") return
    let resetsAt: number | undefined
    if (typeof w.reset_at === "number" && w.reset_at > 0) {
      resetsAt = w.reset_at > 1e12 ? w.reset_at : w.reset_at * 1000
    }
    const windowMs =
      typeof w.limit_window_seconds === "number" && w.limit_window_seconds > 0
        ? w.limit_window_seconds * 1000
        : undefined
    rows.push({ label: derive ? windowLabel(w, label) : label, pct: w.used_percent, resetsAt, windowMs })
  }
  window("Session 5h", data?.rate_limit?.primary_window, true)
  window("Week", data?.rate_limit?.secondary_window, true)
  window("Code review", data?.code_review_rate_limit?.primary_window)
  for (const extra of data?.additional_rate_limits ?? []) {
    const name = extra?.name ?? extra?.display_name ?? "Extra"
    window(name, extra?.rate_limit?.primary_window ?? extra?.primary_window)
  }

  const credits = data?.credits
  if (credits && (credits.unlimited || credits.has_credits)) {
    // On Team/Business plans the balance is a workspace pool the API doesn't expose (balance: null)
    const balance = credits.balance != null && !Number.isNaN(Number(credits.balance)) ? String(credits.balance) : null
    rows.push({
      label: "Credits",
      pct: null,
      detail: credits.unlimited
        ? "unlimited"
        : credits.overage_limit_reached
          ? "overage limit reached"
          : balance !== null
            ? `${balance} remaining`
            : "workspace pool · no balance via API",
    })
  }

  // Reset credits were a 5h-window feature: with the weekly window the API
  // reports how many are applicable separately (usually 0), so prefer that.
  const resetCredits = data?.rate_limit_reset_credits
  const resets =
    typeof resetCredits?.applicable_available_count === "number"
      ? resetCredits.applicable_available_count
      : resetCredits?.available_count
  if (typeof resets === "number" && resets > 0) {
    rows.push({
      label: "Resets",
      pct: null,
      detail: resets === 1 ? "1 available" : `${resets} available`,
    })
  }

  const individualLimit = data?.spend_control?.individual_limit
  if (individualLimit != null) {
    rows.push({ label: "Monthly limit", pct: null, detail: String(individualLimit) })
  }

  if (activity) rows.push(activity)

  if (rows.length === 0) return { title, rows, note: "The endpoint returned no usage windows" }
  return { title, rows }
}
