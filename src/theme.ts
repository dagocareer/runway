import {
  fg,
  red,
  yellow,
  white,
  brightBlack,
  dim,
  type StylableInput,
  type TextChunk,
  type ThemeMode,
} from "@opentui/core"

/** Paints a fragment with color/style (same shape as `fg(...)`, `red`, etc.). */
type Paint = (input: StylableInput) => TextChunk

export interface Theme {
  mode: ThemeMode
  /** Labels and secondary text: row names, countdowns, notes. */
  label: Paint
  /** Primary readable text: detail and `%` below the threshold. */
  text: Paint
  /** Empty bar track (`░`). */
  track: Paint
  /** "·" glyph (on pace) and filler space. */
  pace: Paint
  /** "▼" glyph (spending below pace). */
  paceOk: Paint
  /** High usage / "▲" glyph (above pace). */
  danger: Paint
  /** Medium usage. */
  warn: Paint
  /** Panel border color (`BoxRenderable.borderColor`). */
  border: string
}

// On dark we keep the named ANSI colors: they honor whatever palette the user
// has configured in their terminal, just like before.
const DARK: Theme = {
  mode: "dark",
  label: brightBlack,
  text: white,
  track: fg("#3a3a3a"),
  pace: dim,
  paceOk: fg("#4a9b5e"),
  danger: red,
  warn: yellow,
  border: "#444444",
}

// On light we pin hex values: over a light background ANSI "white"/"brightBlack"
// are illegible (near-invisible text), so we pick tones with enough contrast.
// `yellow` disappears too, hence the dark amber.
const LIGHT: Theme = {
  mode: "light",
  label: fg("#6b7076"),
  text: fg("#1c1e21"),
  track: fg("#c9ccd1"),
  pace: fg("#9aa0a6"),
  paceOk: fg("#1f8a4c"),
  danger: fg("#c1272d"),
  warn: fg("#a86500"),
  border: "#c3c7cc",
}

/** Returns the palette for a mode; defaults to dark when unknown/null. */
export function themeFor(mode: ThemeMode | null | undefined): Theme {
  return mode === "light" ? LIGHT : DARK
}

let active: Theme = DARK

/** Active theme; read by the render functions on every `draw()`. */
export function activeTheme(): Theme {
  return active
}

/** Sets the active theme. Returns `true` if it actually changed. */
export function setTheme(mode: ThemeMode | null | undefined): boolean {
  const next = themeFor(mode)
  if (next === active) return false
  active = next
  return true
}
