import { describe, expect, test } from "vitest"

import appSource from "./App.tsx?raw"

describe("App date range picker", () => {
  test("uses react-day-picker as a two-month range picker", () => {
    expect(appSource).toContain('from "react-day-picker"')
    expect(appSource).toContain("<DayPicker")
    expect(appSource).toContain("mode=\"range\"")
    expect(appSource).toContain("numberOfMonths={2}")
  })
})
