#!/usr/bin/env bun
import { fetchClaude, CLAUDE_TITLE } from "../src/providers/claude"
import { fetchCodex, CODEX_TITLE } from "../src/providers/codex"
import { fetchOpenRouter, OPENROUTER_TITLE } from "../src/providers/openrouter"
import { fetchVercel, VERCEL_TITLE } from "../src/providers/vercel"
import { fetchAntigravity } from "../src/providers/antigravity"
import type { PanelData } from "../src/types"
import { fmtPanel } from "./format"

/** Renders fetched panels as plain text, one block per panel. */
export function render(panels: PanelData[], now: number): string {
  const blocks = panels.map((panel) => fmtPanel(panel, now).join("\n"))
  return blocks.join("\n\n")
}

const panels = await Promise.all([
  fetchClaude(),
  fetchCodex(),
  fetchOpenRouter(),
  fetchVercel(),
  fetchAntigravity(),
])

const output = `${render(panels, Date.now())}\n\nUpdated: ${new Date().toISOString()}`
console.log(output)
