import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PanelData } from "../../src/types"

describe("Codex reset credits", () => {
  let codexHome: string
  let fetchCodex: () => Promise<PanelData>
  const originalFetch = globalThis.fetch

  beforeAll(async () => {
    codexHome = await mkdtemp(join(tmpdir(), "runway-codex-"))
    await Bun.write(
      join(codexHome, "auth.json"),
      JSON.stringify({ tokens: { access_token: "test-token", account_id: "test-account" } }),
    )
    process.env.CODEX_HOME = codexHome
    ;({ fetchCodex } = await import("../../src/providers/codex"))
  })

  afterAll(async () => {
    globalThis.fetch = originalFetch
    delete process.env.CODEX_HOME
    await rm(codexHome, { recursive: true, force: true })
  })

  test("shows every available reset credit even when none applies to the current window", async () => {
    globalThis.fetch = mockCodexFetch({
      rate_limit_reset_credits: {
        available_count: 4,
        applicable_available_count: 0,
      },
    })

    const panel = await fetchCodex()

    expect(panel.rows).toContainEqual({
      label: "Resets",
      pct: null,
      detail: "4 available",
    })
  })

  test("includes the next available reset credit expiry", async () => {
    globalThis.fetch = mockCodexFetch(
      { rate_limit_reset_credits: { available_count: 3 } },
      {
        credits: [
          { status: "available", expires_at: "2026-08-12T18:00:04.610Z" },
          { status: "redeemed", expires_at: "2026-07-20T12:00:00.000Z" },
          { status: "available", expires_at: "2026-07-27T00:02:10.692Z" },
        ],
      },
    )

    const panel = await fetchCodex()

    expect(panel.rows).toContainEqual({
      label: "Resets",
      pct: null,
      detail: "3 available",
      expiresAt: Date.parse("2026-07-27T00:02:10.692Z"),
    })
  })

  test("sets a deadline on the optional reset credit details request", async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/wham/usage")) {
        return Response.json({ rate_limit_reset_credits: { available_count: 2 } })
      }
      if (url.endsWith("/wham/profiles/me")) return Response.json({})
      if (url.endsWith("/wham/rate-limit-reset-credits")) {
        if (!init?.signal) throw new Error("Expected reset credit request to have an abort signal")
        const signal = init.signal
        return await new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    }) as typeof fetch

    const panel = await fetchCodex()

    expect(panel.rows).toContainEqual({ label: "Resets", pct: null, detail: "2 available" })
  }, 3_000)
})

function mockCodexFetch(usage: Record<string, unknown>, resetCredits?: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith("/wham/usage")) return Response.json(usage)
    if (url.endsWith("/wham/profiles/me")) return Response.json({})
    if (url.endsWith("/wham/rate-limit-reset-credits") && resetCredits) return Response.json(resetCredits)
    throw new Error(`Unexpected request: ${url}`)
  }) as typeof fetch
}
