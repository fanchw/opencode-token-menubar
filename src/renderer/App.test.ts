import { describe, expect, test } from "vitest"

import filterBarSource from "./components/FilterBar.tsx?raw"

describe("FilterBar date range picker", () => {
  test("uses react-day-picker as a two-month range picker", () => {
    expect(filterBarSource).toContain('from "react-day-picker"')
    expect(filterBarSource).toContain("<DayPicker")
    expect(filterBarSource).toContain("mode=\"range\"")
    expect(filterBarSource).toContain("numberOfMonths={2}")
  })
})
