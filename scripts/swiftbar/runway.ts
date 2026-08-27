#!/usr/bin/env bun
// <xbar.title>Runway Usage</xbar.title>
// <xbar.version>v1.0</xbar.version>
// <xbar.author>David</xbar.author>
// <xbar.desc>Live usage for Claude Max, Codex, OpenRouter, Vercel AI Gateway and Google Antigravity</xbar.desc>
// <xbar.dependencies>bun</xbar.dependencies>
// <swiftbar.runInBash>false</swiftbar.runInBash>

// SwiftBar plugin: renders the runway providers as a menu bar item.
// Refresh every 5 minutes via the `5m` suffix in the plugin file name.
//
// SwiftBar runs this file through a symlink in its plugins folder. Bun resolves
// import.meta.dir to the real file location, so the relative imports and the
// repo root below stay correct wherever the repo lives.
import { resolve } from "node:path"
import { fetchClaude, CLAUDE_TITLE } from "../../src/providers/claude"
import { fetchCodex, CODEX_TITLE } from "../../src/providers/codex"
import { fetchOpenRouter, OPENROUTER_TITLE } from "../../src/providers/openrouter"
import { fetchVercel, VERCEL_TITLE } from "../../src/providers/vercel"
import { fetchAntigravity, ANTIGRAVITY_TITLE } from "../../src/providers/antigravity"
import type { UsageRow } from "../../src/types"
import { render, type MenuService } from "./format"

const RUNWAY_REPO = resolve(import.meta.dir, "..", "..")

const geminiFlash = (rows: UsageRow[]) => rows.find((row) => row.label === "Gemini Flash") ?? null

const [claude, codex, openrouter, vercel, antigravity] = await Promise.all([
  fetchClaude(),
  fetchCodex(),
  fetchOpenRouter(),
  fetchVercel(),
  fetchAntigravity(),
])

const services: MenuService[] = [
  { short: "Claude", title: CLAUDE_TITLE, accent: "#d97757", panel: claude, headline: (rows) => rows[0] ?? null },
  { short: "Codex", title: CODEX_TITLE, accent: "#74aa9c", panel: codex, headline: (rows) => rows[0] ?? null },
  { short: "Antigravity", title: ANTIGRAVITY_TITLE, accent: "#4285f4", panel: antigravity, headline: geminiFlash },
  { short: "OpenRouter", title: OPENROUTER_TITLE, accent: "#8b5cf6", panel: openrouter, headline: () => null },
  { short: "Vercel", title: VERCEL_TITLE, accent: "#0070f3", panel: vercel, headline: () => null },
]

console.log(
  render(services, Date.now(), {
    ansi: true,
    openRunwayScript: `${RUNWAY_REPO}/scripts/swiftbar/open-runway.sh`,
  }),
)
