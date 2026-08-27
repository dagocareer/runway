import { homedir } from "node:os"
import { join } from "node:path"
import type { PanelData, UsageRow } from "../types"

export const ANTIGRAVITY_TITLE = "Google Antigravity"

const TOKEN_URL = "https://oauth2.googleapis.com/token"
const QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels"
const USER_QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota"
const DEFAULT_PROJECT_ID = "rising-fact-p41fc"
const FETCH_TIMEOUT_MS = 10_000

// OAuth installed-app credentials for the token exchange come from the
// opencode-antigravity-auth plugin (same env var names it uses). They are not
// hardcoded so they never end up in the repo or in git history.
export function oauthCredentials(
  env: NodeJS.ProcessEnv = process.env,
): { clientId: string; clientSecret: string } | null {
  const clientId = env.ANTIGRAVITY_CLIENT_ID
  const clientSecret = env.ANTIGRAVITY_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export type QuotaGroup = "claude" | "gemini-flash" | "gemini-pro"

export interface ModelEntry {
  name: string
  displayName?: string
  quotaInfo?: { remainingFraction?: number; resetTime?: string }
}

export interface QuotaFamily {
  remainingFraction: number | undefined
  resetTime: string | undefined
  modelCount: number
}

export interface QuotaBucket {
  modelId?: string
  remainingFraction?: number
  resetTime?: string
  window?: string
  quotaType?: string
}

interface Account {
  email?: string
  enabled?: boolean
  projectId?: string
  refreshToken: string
  cachedQuota?: Record<string, QuotaFamily>
}

const FAMILY_LABELS: Record<QuotaGroup, string> = {
  claude: "Claude",
  "gemini-flash": "Gemini Flash",
  "gemini-pro": "Gemini Pro",
}

function accountsPath(): string {
  return join(homedir(), ".config", "opencode", "antigravity-accounts.json")
}

/** Same naming rules as the plugin's getModelFamily in model-resolver. */
function getModelFamily(modelName: string): QuotaGroup | "other" {
  const lower = modelName.toLowerCase()
  if (lower.includes("claude")) return "claude"
  if (lower.includes("flash")) return "gemini-flash"
  return "other"
}

/** Same grouping rules as the plugin's classifyQuotaGroup: only gemini-3* and claude models. */
export function classifyQuotaFamily(modelName: string, displayName?: string): QuotaGroup | null {
  const combined = `${modelName} ${displayName ?? ""}`.toLowerCase()
  if (combined.includes("claude")) return "claude"
  const isGemini3 = combined.includes("gemini-3") || combined.includes("gemini 3")
  if (!isGemini3) return null
  const family = getModelFamily(modelName)
  return family === "gemini-flash" ? "gemini-flash" : "gemini-pro"
}

function normalizeRemainingFraction(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function parseResetTime(resetTime: string | undefined): number | null {
  if (!resetTime) return null
  const timestamp = Date.parse(resetTime)
  return Number.isFinite(timestamp) ? timestamp : null
}

/** Same aggregation as the plugin's aggregateQuota: min fraction, earliest reset, model count. */
export function aggregateFamilies(models: ModelEntry[]): Record<string, QuotaFamily> {
  const groups: Record<string, QuotaFamily> = {}
  for (const entry of models) {
    const group = classifyQuotaFamily(entry.name, entry.displayName)
    if (!group) continue
    const remainingFraction = normalizeRemainingFraction(entry.quotaInfo?.remainingFraction)
    const resetTimestamp = parseResetTime(entry.quotaInfo?.resetTime)
    const existing = groups[group]
    const nextCount = (existing?.modelCount ?? 0) + 1
    const nextRemaining = remainingFraction === undefined
      ? existing?.remainingFraction
      : existing?.remainingFraction === undefined
        ? remainingFraction
        : Math.min(existing.remainingFraction, remainingFraction)
    let nextResetTime = existing?.resetTime
    if (resetTimestamp !== null) {
      if (!existing?.resetTime) {
        nextResetTime = entry.quotaInfo?.resetTime
      } else {
        const existingTimestamp = parseResetTime(existing.resetTime)
        if (existingTimestamp === null || resetTimestamp < existingTimestamp) {
          nextResetTime = entry.quotaInfo?.resetTime
        }
      }
    }
    groups[group] = { remainingFraction: nextRemaining, resetTime: nextResetTime, modelCount: nextCount }
  }
  return groups
}

export function rowsFromGroups(groups: Record<string, QuotaFamily>, _now: number): UsageRow[] {
  const ordered = ["claude", "gemini-flash", "gemini-pro"] as const
  const rows: UsageRow[] = []
  for (const family of ordered) {
    const group = groups[family]
    if (!group) continue
    const resetTimestamp = parseResetTime(group.resetTime)
    rows.push({
      label: family === "claude" ? "Claude & GPT" : FAMILY_LABELS[family],
      // runway pct = % used, so invert the remaining fraction
      pct: group.remainingFraction === undefined ? null : 100 - Math.round(group.remainingFraction * 100),
      detail: `${group.modelCount} ${group.modelCount === 1 ? "model" : "models"}`,
      resetsAt: resetTimestamp ?? undefined,
    })
  }
  return rows
}

export function rowsFromQuotaBuckets(buckets: QuotaBucket[]): UsageRow[] {
  const rows: UsageRow[] = []
  for (const bucket of buckets) {
    if (!bucket.modelId || typeof bucket.remainingFraction !== "number") continue
    const window = `${bucket.window ?? bucket.quotaType ?? ""}`.toLowerCase()
    const label = window.includes("week") ? "Weekly" : window.includes("hour") || window.includes("5h") ? "Five Hour" : null
    if (!label) continue
    const family = bucket.modelId.toLowerCase().includes("claude") || bucket.modelId.toLowerCase().includes("gpt") ? "Claude & GPT" : "Gemini Models"
    const reset = parseResetTime(bucket.resetTime)
    rows.push({ label: `${family} ${label}`, pct: 100 - Math.round(normalizeRemainingFraction(bucket.remainingFraction)! * 100), resetsAt: reset ?? undefined, detail: `${Math.round(bucket.remainingFraction * 100)}% remaining` })
  }
  return rows
}

async function readAccount(): Promise<Account | null> {
  try {
    const file = Bun.file(accountsPath())
    if (!(await file.exists())) return null
    const data = (await file.json()) as { accounts?: Account[] }
    const account = data.accounts?.find((a) => a.enabled !== false) ?? data.accounts?.[0]
    return account?.refreshToken ? account : null
  } catch {
    return null
  }
}

async function refreshAccessToken(
  refreshToken: string,
  credentials: { clientId: string; clientSecret: string },
): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken.split("|")[0],
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
        }),
        signal: controller.signal,
      })
      if (!res.ok) return null
      const data = (await res.json()) as { access_token?: string }
      return data.access_token ?? null
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return null
  }
}

async function fetchAvailableModels(accessToken: string): Promise<ModelEntry[] | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(QUOTA_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "antigravity/2.0.6 darwin/arm64",
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      })
      if (!res.ok) return null
      const body = (await res.json()) as { models?: Record<string, Omit<ModelEntry, "name">> }
      if (!body.models) return null
      return Object.entries(body.models).map(([name, entry]) => ({ name, ...entry }))
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return null
  }
}

async function resolveProject(accessToken: string, projectId?: string): Promise<string> {
  try {
    const res = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "User-Agent": "google-api-nodejs-client/9.15.1", "Client-Metadata": "ideType=ANTIGRAVITY&platform=MACOS&pluginType=GEMINI" }, body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY", platform: "MACOS", pluginType: "GEMINI", ...(projectId ? { duetProject: projectId } : {}) } }) })
    const body = await res.json().catch(() => null)
    return body?.cloudaicompanionProject?.id ?? body?.cloudaicompanionProject ?? projectId ?? DEFAULT_PROJECT_ID
  } catch { return projectId ?? DEFAULT_PROJECT_ID }
}

async function fetchUserQuota(accessToken: string, project: string): Promise<QuotaBucket[]> {
  try {
    const res = await fetch(USER_QUOTA_URL, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ project }) })
    if (!res.ok) return []
    const body = (await res.json()) as { buckets?: QuotaBucket[] }
    return Array.isArray(body.buckets) ? body.buckets : []
  } catch { return [] }
}

function rowsFromCached(cached: Record<string, QuotaFamily>): UsageRow[] {
  const groups: Record<string, QuotaFamily> = {}
  for (const [family, group] of Object.entries(cached)) {
    if (!(family in FAMILY_LABELS)) continue
    groups[family] = {
      remainingFraction: normalizeRemainingFraction(group.remainingFraction),
      resetTime: typeof group.resetTime === "string" ? group.resetTime : undefined,
      modelCount: group.modelCount,
    }
  }
  return rowsFromGroups(groups, Date.now())
}

export async function fetchAntigravity(): Promise<PanelData> {
  const title = ANTIGRAVITY_TITLE
  const account = await readAccount()
  if (!account) {
    return {
      title,
      rows: [],
      note: "No Antigravity account: sign in via the opencode-antigravity-auth plugin",
    }
  }

  const credentials = oauthCredentials()
  if (!credentials) {
    return {
      title,
      rows: [],
      note: "Antigravity OAuth credentials missing: set ANTIGRAVITY_CLIENT_ID and ANTIGRAVITY_CLIENT_SECRET",
    }
  }

  const accessToken = await refreshAccessToken(account.refreshToken, credentials)
  const models = accessToken ? await fetchAvailableModels(accessToken) : null
  const quotaBuckets = accessToken ? await fetchUserQuota(accessToken, await resolveProject(accessToken, account.projectId)) : []

  if (models) {
    const rows = rowsFromGroups(aggregateFamilies(models), Date.now())
    const windowRows = rowsFromQuotaBuckets(quotaBuckets)
    if (windowRows.length > 0) return { title, rows: windowRows }
    const resets = rows.map((row) => row.resetsAt).filter((value): value is number => value !== undefined)
    if (resets.length > 0) rows.push({ label: "Reset", pct: null, detail: "next quota window", expiresAt: Math.min(...resets) })
    if (rows.length > 0) return { title, rows }
    return { title, rows: [], note: "No quota groups in the Antigravity response" }
  }

  // Fall back to the quota the plugin cached locally (refreshed on every use).
  if (account.cachedQuota) {
    const rows = rowsFromCached(account.cachedQuota)
    if (rows.length > 0) return { title, rows }
  }
  return { title, rows: [], note: "No connection to cloudcode-pa.googleapis.com" }
}
