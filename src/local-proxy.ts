#!/usr/bin/env bun
const backend = process.env.LOCAL_MODEL_BACKEND ?? "http://127.0.0.1:8001"
let requests = 0
let promptTokens = 0
let completionTokens = 0

async function recordUsage(response: Response): Promise<void> {
  const text = await response.clone().text().catch(() => "")
  const matches = [...text.matchAll(/"usage"\s*:\s*(\{[^}]+\})/g)]
  const usageText = matches.at(-1)?.[1]
  if (!usageText) return
  let usage: { prompt_tokens?: number; completion_tokens?: number }
  try { usage = JSON.parse(usageText) }
  catch { return }
  promptTokens += usage.prompt_tokens ?? 0
  completionTokens += usage.completion_tokens ?? 0
}

Bun.serve({
  port: Number(process.env.LOCAL_MODEL_PROXY_PORT ?? 8000),
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/runway/metrics") return Response.json({ requests, promptTokens, completionTokens, totalTokens: promptTokens + completionTokens })
    const upstream = await fetch(`${backend}${url.pathname}${url.search}`, { method: request.method, headers: request.headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body })
    if (url.pathname === "/v1/chat/completions" && upstream.ok) { requests++; void recordUsage(upstream) }
    return upstream
  },
})

console.log("Local model proxy listening on :8000 → :8001")
