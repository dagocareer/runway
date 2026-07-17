import { expect, test } from "bun:test"

import { rowText } from "../src/ui"

test("renders the next expiration countdown for an informational row", () => {
  const now = 1_000_000
  const expiresAt = now + (3 * 24 + 4) * 60 * 60 * 1000

  const text = rowText(
    { label: "Resets", pct: null, detail: "4 available", expiresAt },
    now,
    "#ffffff",
  )

  expect(text.chunks.map((chunk) => chunk.text).join("")).toContain(
    "4 available · next expires in 3d 4h",
  )
})
