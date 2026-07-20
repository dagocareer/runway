import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fetchVercel } from "./vercel"

const originalFetch = globalThis.fetch
const originalEnv = {
  AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
  VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
}
let dataHome = ""

function restoreEnv(name: keyof typeof originalEnv) {
  const value = originalEnv[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

beforeEach(async () => {
  delete process.env.AI_GATEWAY_API_KEY
  delete process.env.VERCEL_OIDC_TOKEN
  dataHome = await mkdtemp(join(tmpdir(), "runway-vercel-"))
  process.env.XDG_DATA_HOME = dataHome
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  restoreEnv("AI_GATEWAY_API_KEY")
  restoreEnv("VERCEL_OIDC_TOKEN")
  restoreEnv("XDG_DATA_HOME")
  await rm(dataHome, { recursive: true, force: true })
})

describe("fetchVercel", () => {
  test("fetches and formats the documented string balance", async () => {
    process.env.AI_GATEWAY_API_KEY = "gateway-key"
    process.env.VERCEL_OIDC_TOKEN = "oidc-token"
    let requestUrl = ""
    let authorization: string | null = null
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input)
      authorization = new Headers(init?.headers).get("Authorization")
      return Response.json({ balance: "95.50", total_used: "4.50" })
    }) as unknown as typeof fetch

    const result = await fetchVercel()

    expect(requestUrl).toBe("https://ai-gateway.vercel.sh/v1/credits")
    expect(String(authorization)).toBe("Bearer gateway-key")
    expect(result).toEqual({
      title: "Vercel AI Gateway",
      rows: [{ label: "Credits", pct: null, detail: "$95.50 left" }],
    })
  })

  test("uses the project-scoped OIDC token before the opencode fallback", async () => {
    const authDir = join(dataHome, "opencode")
    await mkdir(authDir, { recursive: true })
    await writeFile(join(authDir, "auth.json"), JSON.stringify({ vercel: { type: "api", key: "opencode-key" } }))
    process.env.VERCEL_OIDC_TOKEN = "oidc-token"
    let authorization: string | null = null
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("Authorization")
      return Response.json({ balance: 10 })
    }) as unknown as typeof fetch

    await fetchVercel()

    expect(String(authorization)).toBe("Bearer oidc-token")
  })

  test("falls back to the API key stored by opencode", async () => {
    const authDir = join(dataHome, "opencode")
    await mkdir(authDir, { recursive: true })
    await writeFile(join(authDir, "auth.json"), JSON.stringify({ vercel: { type: "api", key: "opencode-key" } }))
    let authorization: string | null = null
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("Authorization")
      return Response.json({ balance: 10 })
    }) as unknown as typeof fetch

    await fetchVercel()

    expect(String(authorization)).toBe("Bearer opencode-key")
  })

  test("returns setup guidance when no credential is available", async () => {
    const result = await fetchVercel()

    expect(result.rows).toEqual([])
    expect(result.note).toContain("AI_GATEWAY_API_KEY")
  })

  test("rejects a malformed balance", async () => {
    process.env.AI_GATEWAY_API_KEY = "gateway-key"
    globalThis.fetch = (async () => Response.json({ balance: "not-a-number" })) as unknown as typeof fetch

    const result = await fetchVercel()

    expect(result.rows).toEqual([])
    expect(result.note).toBe("Invalid response from the credits endpoint")
  })

  test("reports rejected and unreachable credentials endpoints", async () => {
    process.env.AI_GATEWAY_API_KEY = "gateway-key"
    globalThis.fetch = (async () => new Response(null, { status: 401 })) as unknown as typeof fetch
    expect((await fetchVercel()).note).toBe("Invalid or expired Vercel AI Gateway credential")

    globalThis.fetch = (async () => new Response(null, { status: 403 })) as unknown as typeof fetch
    expect((await fetchVercel()).note).toBe("Error 403 from the credits endpoint")

    globalThis.fetch = (async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    expect((await fetchVercel()).note).toBe("No connection to ai-gateway.vercel.sh")
  })
})
