// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest"

import { resolveTheme, getThemeSource, setThemeSource, THEME_STORAGE_KEY } from "./theme.js"

describe("resolveTheme", () => {
  test("显式偏好 dark 时无视系统", () => {
    expect(resolveTheme("dark", true)).toBe("dark")
    expect(resolveTheme("dark", false)).toBe("dark")
  })

  test("显式偏好 light 时无视系统", () => {
    expect(resolveTheme("light", true)).toBe("light")
    expect(resolveTheme("light", false)).toBe("light")
  })

  test("偏好 system 时跟随系统", () => {
    expect(resolveTheme("system", true)).toBe("dark")
    expect(resolveTheme("system", false)).toBe("light")
  })
})

describe("getThemeSource / setThemeSource", () => {
  afterEach(() => {
    localStorage.clear()
  })

  test("默认返回 system", () => {
    expect(getThemeSource()).toBe("system")
  })

  test("setThemeSource 持久化到 localStorage", () => {
    setThemeSource("dark")
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark")
    expect(getThemeSource()).toBe("dark")
  })

  test("localStorage 异常时回退 system", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    expect(getThemeSource()).toBe("system")
    vi.restoreAllMocks()
  })

  test("脏数据回退 system", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "neon")
    expect(getThemeSource()).toBe("system")
  })
})
