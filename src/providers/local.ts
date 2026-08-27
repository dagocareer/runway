import type { PanelData, UsageRow } from "../types"

export const LOCAL_TITLE = "Local"
const DEFAULT_URL = "http://127.0.0.1:8000"

function modelLabel(model: string): string {
  const name = model.split("/").pop() ?? model
  return name.replace(/-4bit$/, "")
}

export async function fetchLocal(): Promise<PanelData> {
  const title = LOCAL_TITLE
  const baseUrl = (process.env.LOCAL_MODEL_URL ?? DEFAULT_URL).replace(/\/$/, "")
  try {
    const [modelsResponse, metricsResponse] = await Promise.all([fetch(`${baseUrl}/v1/models`), fetch(`${baseUrl}/runway/metrics`)])
    if (!modelsResponse.ok) return { title, rows: [], note: "Local model server unavailable" }
    const models = await modelsResponse.json().catch(() => null)
    const modelNames = Array.isArray(models?.data)
      ? models.data.map((entry: { id?: unknown }) => entry.id).filter((id: unknown): id is string => typeof id === "string")
      : []
    if (modelNames.length === 0) return { title, rows: [], note: "No local model loaded" }
    const metrics = metricsResponse.ok ? await metricsResponse.json().catch(() => null) : null
    const requests = typeof metrics?.requests === "number" ? metrics.requests.toLocaleString("en-US") : "—"
    const promptTokens = typeof metrics?.promptTokens === "number" ? metrics.promptTokens.toLocaleString("en-US") : "—"
    const completionTokens = typeof metrics?.completionTokens === "number" ? metrics.completionTokens.toLocaleString("en-US") : "—"
    const detail = `${requests} req · ${promptTokens} in tok · ${completionTokens} out tok`
    const rows = modelNames.map((model: string): UsageRow => ({ label: modelLabel(model), pct: null, detail }))
    return { title, rows }
  } catch { return { title, rows: [], note: "Local model server unavailable" } }
}
