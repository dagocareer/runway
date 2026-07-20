import { homedir } from "node:os"
import { join } from "node:path"
import type { PanelData } from "../types"

export const VERCEL_TITLE = "Vercel AI Gateway"

const CREDITS_URL = "https://ai-gateway.vercel.sh/v1/credits"

function opencodeAuthPath(): string {
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode", "auth.json")
}

function envCredential(name: "AI_GATEWAY_API_KEY" | "VERCEL_OIDC_TOKEN"): string | null {
  return process.env[name]?.trim() || null
}

/** Follow Vercel's env precedence, then use opencode as an implicit fallback. */
async function resolveCredential(): Promise<string | null> {
  const apiKey = envCredential("AI_GATEWAY_API_KEY")
  if (apiKey) return apiKey
  const oidcToken = envCredential("VERCEL_OIDC_TOKEN")
  if (oidcToken) return oidcToken
  try {
    const entry = (await Bun.file(opencodeAuthPath()).json())?.vercel
    if (entry?.type === "api" && typeof entry.key === "string" && entry.key.length > 0) return entry.key
  } catch {}
  return null
}

function decimal(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null
  if (typeof value === "string" && value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const money = (n: number) => `$${n.toFixed(Math.abs(n) >= 1 ? 2 : 4)}`

export async function fetchVercel(): Promise<PanelData> {
  const title = VERCEL_TITLE
  const credential = await resolveCredential()
  if (!credential) {
    return {
      title,
      rows: [],
      note: "No key: set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN, or add Vercel to opencode",
    }
  }

  let res: Response
  try {
    res = await fetch(CREDITS_URL, { headers: { Authorization: `Bearer ${credential}` } })
  } catch {
    return { title, rows: [], note: "No connection to ai-gateway.vercel.sh" }
  }

  if (res.status === 401) {
    return { title, rows: [], note: "Invalid or expired Vercel AI Gateway credential" }
  }
  if (!res.ok) return { title, rows: [], note: `Error ${res.status} from the credits endpoint` }

  const body = await res.json().catch(() => null)
  const balance = decimal(body?.balance)
  if (balance === null) return { title, rows: [], note: "Invalid response from the credits endpoint" }

  return {
    title,
    rows: [{ label: "Credits", pct: null, detail: `${money(balance)} left` }],
  }
}
