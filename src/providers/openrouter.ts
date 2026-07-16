import { homedir } from "node:os"
import { join } from "node:path"
import type { PanelData, UsageRow } from "../types"

export const OPENROUTER_TITLE = "OpenRouter"

const CREDITS_URL = "https://openrouter.ai/api/v1/credits"
const KEY_URL = "https://openrouter.ai/api/v1/key"
// Same keychain entry convoy uses (`convoy auth openrouter`): the management
// key that unlocks the exact /credits balance.
const KEYCHAIN_SERVICE = "convoy"
const KEYCHAIN_ACCOUNT = "openrouter"

async function readKeychain(): Promise<string | null> {
  if (process.platform !== "darwin") return null
  try {
    const proc = Bun.spawn(
      ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
      { stderr: "ignore" },
    )
    const out = await new Response(proc.stdout).text()
    if ((await proc.exited) !== 0) return null
    return out.trim() || null
  } catch {
    return null
  }
}

function opencodeAuthPath(): string {
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode", "auth.json")
}

/** Keychain management key → OPENROUTER_API_KEY → the key opencode already stores. */
async function resolveKey(): Promise<string | null> {
  const fromKeychain = await readKeychain()
  if (fromKeychain) return fromKeychain
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  try {
    const entry = (await Bun.file(opencodeAuthPath()).json())?.openrouter
    if (entry?.type === "api" && typeof entry.key === "string" && entry.key.length > 0) return entry.key
  } catch {}
  return null
}

const money = (n: number) => `$${n.toFixed(n >= 1 ? 2 : 4)}`

export async function fetchOpenRouter(): Promise<PanelData> {
  const title = OPENROUTER_TITLE
  const key = await resolveKey()
  if (!key) return { title, rows: [], note: "No key: set OPENROUTER_API_KEY or add OpenRouter to opencode" }
  const headers = { Authorization: `Bearer ${key}` }

  let res: Response
  try {
    res = await fetch(CREDITS_URL, { headers })
  } catch {
    return { title, rows: [], note: "No connection to openrouter.ai" }
  }

  const remainingRow = (amount: number): UsageRow => ({
    label: "Credits",
    pct: null,
    detail: `${money(amount)} left`,
  })

  if (res.ok) {
    const body = await res.json().catch(() => null)
    const total = body?.data?.total_credits
    const used = body?.data?.total_usage
    if (typeof total === "number" && typeof used === "number") {
      return { title, rows: [remainingRow(total - used)] }
    }
    return { title, rows: [], note: "Invalid response from the credits endpoint" }
  }
  if (res.status === 401) return { title, rows: [], note: "Invalid OpenRouter API key" }
  if (res.status !== 403) return { title, rows: [], note: `Error ${res.status} from the credits endpoint` }

  // 403: a regular inference key can't read /credits; /key works for any key.
  try {
    res = await fetch(KEY_URL, { headers })
  } catch {
    return { title, rows: [], note: "No connection to openrouter.ai" }
  }
  if (res.status === 401 || res.status === 403) return { title, rows: [], note: "Invalid OpenRouter API key" }
  if (!res.ok) return { title, rows: [], note: `Error ${res.status} from the key endpoint` }

  const body = (await res.json().catch(() => null))?.data
  if (body && typeof body.limit_remaining === "number") {
    return { title, rows: [remainingRow(body.limit_remaining)] }
  }
  // A limitless key has no remaining balance: show this month's spend instead.
  const monthly = typeof body?.usage_monthly === "number" ? body.usage_monthly : body?.usage
  if (typeof monthly === "number") {
    return { title, rows: [{ label: "Monthly", pct: null, detail: `${money(monthly)} spent` }] }
  }
  return { title, rows: [], note: "Invalid response from the key endpoint" }
}
