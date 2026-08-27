import type { AntigravityUsageReport, IQuotaProvider, QuotaGroup, QuotaWindow } from "../types/quota"
import type { PanelData, UsageRow } from "../types"

export class AntigravityUsageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "AntigravityUsageError"
  }
}

function stripAnsi(text: string): string {
  return text.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "")
}

function parseWindow(block: string, label: string): QuotaWindow {
  const section = block.match(new RegExp(`${label}\\s*([\\s\\S]*?)(?=\\n\\s*(?:Weekly|Five Hour) Limit Remaining|$)`, "i"))?.[1]
  if (!section) throw new AntigravityUsageError(`Missing ${label} quota window`)
  const percentage = Number(section.match(/(\d+(?:\.\d+)?)%/)?.[1])
  if (!Number.isFinite(percentage)) throw new AntigravityUsageError(`Missing percentage for ${label}`)
  const resetInText = section.match(/Refreshes in\s+([^\n]+)/i)?.[1]?.trim()
  const rawText = section.replace(/\s+/g, " ").trim()
  return { percentage, remainingFraction: percentage / 100, label, resetInText, rawText }
}

export function parseOutput(rawText: string): AntigravityUsageReport {
  const text = stripAnsi(rawText).replace(/\r/g, "")
  const account = text.match(/^\s*Account:\s*(\S+)/im)?.[1]
  const heading = /(?:^|\n)\s*(GEMINI MODELS|CLAUDE AND GPT MODELS)\s*\n/gi
  const headings = [...text.matchAll(heading)]
  const quotaGroups: QuotaGroup[] = headings.map((match, index) => {
    const groupName = match[1]!
    const end = headings[index + 1]?.index ?? text.length
    const block = text.slice(match.index! + match[0].length, end)
    const models = block.match(/Models within this group:\s*(.+)/i)?.[1]?.split(",").map((model) => model.trim()).filter(Boolean) ?? []
    return { groupName, models, weekly: parseWindow(block, "Weekly Limit Remaining"), fiveHour: parseWindow(block, "Five Hour Limit Remaining") }
  })
  if (quotaGroups.length === 0) throw new AntigravityUsageError("No Antigravity quota groups found")
  return { account, quotaGroups, fetchedAt: new Date() }
}

export class AntigravityCliProvider implements IQuotaProvider<AntigravityUsageReport> {
  async fetch(): Promise<AntigravityUsageReport> {
    const process = Bun.spawn(["antigravity", "usage"], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text()])
    const exitCode = await process.exited
    if (exitCode !== 0) throw new AntigravityUsageError(`antigravity usage failed (${exitCode}): ${stderr.trim()}`)
    try { return parseOutput(stdout) } catch (error) {
      if (error instanceof AntigravityUsageError) throw error
      throw new AntigravityUsageError("Unable to parse antigravity usage output", { cause: error })
    }
  }
}

export async function fetchAntigravityCliPanel(): Promise<PanelData> {
  const report = await new AntigravityCliProvider().fetch()
  const rows: UsageRow[] = []
  for (const group of report.quotaGroups) {
    const models = group.models.join(", ")
    rows.push({ label: group.groupName === "GEMINI MODELS" ? "Gemini Models" : "Claude & GPT", pct: null, detail: models })
    for (const window of [group.weekly, group.fiveHour]) {
      rows.push({ label: window.label === "Weekly Limit Remaining" ? "Weekly" : "Five Hour", pct: 100 - window.percentage, detail: `${window.percentage}% remaining${window.resetInText ? ` · Refreshes in ${window.resetInText}` : " · Quota available"}` })
    }
  }
  return { title: "Google Antigravity", rows }
}
