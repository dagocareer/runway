import { afterEach, describe, expect, test } from "bun:test"
import type { PanelData } from "../../src/types"

describe("local model provider", () => {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.LOCAL_MODEL_URL
  afterEach(() => { globalThis.fetch = originalFetch; if (originalUrl === undefined) delete process.env.LOCAL_MODEL_URL; else process.env.LOCAL_MODEL_URL = originalUrl })

  test("shows the loaded model and request/token counters", async () => {
    process.env.LOCAL_MODEL_URL = "http://127.0.0.1:8000"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith("/v1/models")) return Response.json({ data: [{ id: "glm-local" }] })
      if (url.endsWith("/runway/metrics")) return Response.json({ requests: 7, promptTokens: 1200, completionTokens: 450 })
      throw new Error(`Unexpected request: ${url}`)
    }) as typeof fetch
    const { fetchLocal } = await import("../../src/providers/local")
    const panel: PanelData = await fetchLocal()
    expect(panel.rows).toEqual([{ label: "glm-local", pct: null, detail: "7 req · 1,200 in tok · 450 out tok" }])
  })

  test("reports an unavailable local server", async () => {
    process.env.LOCAL_MODEL_URL = "http://127.0.0.1:8000"
    globalThis.fetch = (async () => { throw new Error("offline") }) as typeof fetch
    const { fetchLocal } = await import("../../src/providers/local")
    expect((await fetchLocal()).note).toBe("Local model server unavailable")
  })
})
