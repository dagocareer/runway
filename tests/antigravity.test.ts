import { expect, test } from "bun:test"
import {
  aggregateFamilies,
  classifyQuotaFamily,
  oauthCredentials,
  rowsFromGroups,
  rowsFromQuotaBuckets,
} from "../src/providers/antigravity"

const NOW = 1_752_350_000_000
const HOUR = 3_600_000

test("classifyQuotaFamily groups claude, gemini-flash, and gemini-pro", () => {
  expect(classifyQuotaFamily("claude-opus-4-6-thinking")).toBe("claude")
  expect(classifyQuotaFamily("claude-sonnet-4-6", "Claude Sonnet 4.6")).toBe("claude")
  expect(classifyQuotaFamily("gemini-3.6-flash-high")).toBe("gemini-flash")
  expect(classifyQuotaFamily("gemini-2.5-flash", "Gemini 3.1 Flash Lite")).toBe("gemini-flash")
  expect(classifyQuotaFamily("gemini-3.1-pro-low")).toBe("gemini-pro")
  expect(classifyQuotaFamily("gemini-3-pro")).toBe("gemini-pro")
  expect(classifyQuotaFamily("gpt-oss-120b-medium")).toBeNull()
  expect(classifyQuotaFamily("tab_jump_flash_lite_preview")).toBeNull()
})

test("aggregateFamilies takes the min remaining fraction and earliest reset per family", () => {
  const groups = aggregateFamilies([
    { name: "gemini-3.6-flash-high", quotaInfo: { remainingFraction: 0.8, resetTime: "2026-08-01T10:00:00Z" } },
    { name: "gemini-3.6-flash-medium", quotaInfo: { remainingFraction: 0.5, resetTime: "2026-07-31T16:00:00Z" } },
    { name: "gemini-3.1-pro-low", quotaInfo: { remainingFraction: 0.9 } },
    { name: "claude-opus-4-6-thinking", quotaInfo: { remainingFraction: 1 } },
    { name: "chat_20706" }, // unclassified, skipped
  ])

  expect(groups["gemini-flash"]).toEqual({
    remainingFraction: 0.5,
    resetTime: "2026-07-31T16:00:00Z",
    modelCount: 2,
  })
  expect(groups["gemini-pro"]).toEqual({ remainingFraction: 0.9, resetTime: undefined, modelCount: 1 })
  expect(groups["claude"]).toEqual({ remainingFraction: 1, resetTime: undefined, modelCount: 1 })
  expect(groups["gpt-oss"]).toBeUndefined()
})

test("aggregateFamilies clamps fractions to 0..1 and handles missing quota", () => {
  const groups = aggregateFamilies([
    { name: "gemini-3.6-flash-high", quotaInfo: { remainingFraction: 1.5 } },
    { name: "gemini-3.6-flash-low", quotaInfo: { remainingFraction: -0.2 } },
    { name: "gemini-3.6-flash-medium" },
  ])
  expect(groups["gemini-flash"]).toEqual({
    remainingFraction: 0,
    resetTime: undefined,
    modelCount: 3,
  })
})

test("rowsFromGroups renders one row per family with pct and reset countdown", () => {
  const groups = aggregateFamilies([
    { name: "gemini-3.6-flash-high", quotaInfo: { remainingFraction: 0.7145613, resetTime: "2026-08-01T10:00:00Z" } },
    { name: "claude-opus-4-6-thinking", quotaInfo: { remainingFraction: 1, resetTime: "2026-08-01T10:00:00Z" } },
  ])
  const rows = rowsFromGroups(groups, NOW)
  expect(rows).toHaveLength(2)
  const flash = rows.find((r) => r.label === "Gemini Flash")
  expect(flash?.pct).toBe(29)
  expect(flash?.detail).toBe("1 model")
  expect(flash?.resetsAt).toBe(Date.parse("2026-08-01T10:00:00Z"))
  const claude = rows.find((r) => r.label === "Claude & GPT")
  expect(claude?.pct).toBe(0)
})

test("oauthCredentials requires both ANTIGRAVITY_CLIENT_ID and ANTIGRAVITY_CLIENT_SECRET", () => {
  expect(oauthCredentials({})).toBeNull()
  expect(oauthCredentials({ ANTIGRAVITY_CLIENT_ID: "client-id" })).toBeNull()
  expect(oauthCredentials({ ANTIGRAVITY_CLIENT_SECRET: "client-secret" })).toBeNull()
  expect(
    oauthCredentials({ ANTIGRAVITY_CLIENT_ID: "client-id", ANTIGRAVITY_CLIENT_SECRET: "client-secret" }),
  ).toEqual({ clientId: "client-id", clientSecret: "client-secret" })
})

test("renders weekly and five-hour quota buckets by model group", () => {
  const rows = rowsFromQuotaBuckets([
    { modelId: "gemini-3-flash", remainingFraction: 0.9822, resetTime: "2026-09-01T10:00:00Z", window: "weekly" },
    { modelId: "gemini-3-flash", remainingFraction: 0.991, resetTime: "2026-08-28T10:00:00Z", window: "five_hour" },
    { modelId: "claude-opus-4", remainingFraction: 1, window: "weekly" },
  ])
  expect(rows.map((row) => row.label)).toEqual(["Gemini Models Weekly", "Gemini Models Five Hour", "Claude & GPT Weekly"])
})
