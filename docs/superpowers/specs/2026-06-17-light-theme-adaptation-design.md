# Light Theme Adaptation Design

## Goal

为菜单栏 app 增加完整的浅色主题适配，解决当前在 macOS 浅色模式下的两大显示问题：

1. 原生滚动条（`.settings-modal` / `.range-modal` / `.select-list` / `.ranking-scroll`）显示为白底灰条，与暗色背景对比刺眼
2. 未声明 `color-scheme`，Chromium 跟随系统渲染原生 UI，但应用整体视觉与系统浅色不一致

视觉定位为「蒸汽波浅色版」：极淡紫白底 + 保留霓虹强调色。机制为「跟随系统 + 设置开关三选一（暗 / 亮 / 系统）」。

## Background

探查发现：

- `src/renderer/styles.css`（1281 行）全部硬编码暗色，仅 `:root` 定义了少量变量，其余颜色散写
- 完全缺失 `prefers-color-scheme` / `color-scheme` / `::-webkit-scrollbar` 任何主题相关样式
- `src/main/main.ts:335` 的 `BrowserWindow` 未设 `backgroundColor`，浅色模式下首帧白底闪烁
- `src/main/main.ts:290` tray icon 已 `setTemplateImage(true)`，自动适配菜单栏明暗，**无需改动**
- `src/renderer/i18n.ts:11` locale 用纯渲染层 `localStorage` 持久化，不走主进程文件 —— 主题开关可同构复用此模式
- `src/main/preload.ts` 暴露单一 `tokenMetrics` 对象，IPC 通道按 `domain:action` 命名

## Design

### 1. 架构与数据流（方案 A：渲染层 `data-theme` 驱动）

```
┌─ 渲染层 (renderer) ─────────────────────────────────────────────┐
│  localStorage["theme"]  ◀── 偏好 "dark"|"light"|"system"        │
│         │                                                        │
│  theme.ts (新模块)                                              │
│    • getThemeSource() / setThemeSource()  ── 读写 localStorage  │
│    • resolveTheme(pref, systemDark): "dark"|"light"  (纯函数)   │
│    • applyTheme(resolved)  ── documentElement                    │
│                              .setAttribute("data-theme", x)      │
│    • subscribeSystemTheme(cb)  ── matchMedia change 订阅         │
│         │                                                        │
│  App.tsx: useState + useEffect                                  │
│    1. 读 pref → resolveTheme → applyTheme                       │
│    2. 订阅 matchMedia（仅 pref=system 时重算）                   │
│    3. IPC setThemeSource(pref) 通知主进程 ──┐                   │
└─────────────────────────────────────────────┼──────────────────┘
                                              ▼ IPC
┌─ 主进程 (main) ──────────────────────────────────────────────────┐
│  ipcMain.handle("theme:set-source", (_, src) => {              │
│    nativeTheme.themeSource = src                                │
│  })                                                             │
│  → BrowserWindow 原生背景色跟随（消白闪）                        │
│  → Chromium 原生滚动条跟随（color-scheme 自动同步）              │
└─────────────────────────────────────────────────────────────────┘
```

**关键点**：

- 单一真理源是渲染层 localStorage，主进程仅作 IPC 同步的影子副本
- 数据流单向：用户切偏好 → 渲染层算最终主题 → 写 `data-theme` → IPC 通知主进程同步 `themeSource`
- `resolveTheme(pref, systemDark)` 是纯函数，三偏好 × 两系统状态全组合可单测

### 2. CSS 变量化策略

**全量提取**：将 `styles.css` 中 200+ 处硬编码颜色按语义层提到 `:root` 变量。

| 层 | 前缀 | 例 |
|---|---|---|
| 背景 | `--bg-*` | base / panel-solid / panel / overlay |
| 文字 | `--text-*` | primary / muted / dim |
| 强调 | `--neon-*` | cyan / pink / purple |
| Glow | `--glow-*` | cyan / pink |
| 交互表面 | `--surface-*` | button / input / hover |
| 边界 | `--divider-*` | base / strong / cyan |
| 状态 | `--status-*` | error / warning / success |

**保留硬编码**（中立色，跨主题通用）：

- 图表数据色：Cache `#22c55e` / Fresh `#475569` / Output `#38bdf8`
- Rank 金银铜 badge 背景：`#facc15` / `#cbd5e1` / `#d97706`
- react-day-picker `--rdp-*` 局部变量

**CSS 文件结构**：

```css
:root {
  --bg-base: #0a0410;
  /* ... 全部暗色变量 ... */
  color-scheme: dark;
}

[data-theme="light"] {
  --bg-base: #f5f0fa;
  /* ... 仅覆盖变量，不重写选择器 ... */
  color-scheme: light;
}

/* 其余选择器全部引用 var(--*) */
```

**滚动条双保险**：

1. `color-scheme: dark|light` 让 Chromium 原生滚动条自动跟随
2. 额外自定义 `::-webkit-scrollbar`，统一蒸汽波美学（暗版淡青滑块 / 浅版淡紫滑块），避免系统滚动条过于突兀

```css
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(0, 240, 255, 0.2); border-radius: 4px; }
[data-theme="light"] ::-webkit-scrollbar-thumb { background: rgba(176, 38, 255, 0.25); }
```

### 3. 浅色调色板（蒸汽波浅色版）

**霓虹强调色「双轨」**：浅底上原 `#00f0ff` 亮度高、对比度不足（WCAG AA 失败）。策略：**装饰/glow/border 保留原色**，**文字场景统一降一档饱和度**走 Tailwind 600 级。

| 变量 | 暗色 | 浅色 |
|---|---|---|
| `--bg-base` | `#0a0410` | `#f5f0fa` |
| `--bg-panel-solid` | `#0d0820` | `#ffffff` |
| `--bg-panel` | `rgba(15,8,30,0.55)` | `rgba(255,255,255,0.72)` |
| `--bg-overlay` | `rgba(0,0,0,0.6)` | `rgba(40,30,60,0.45)` |
| `--grid-color` | `rgba(0,240,255,0.035)` | `rgba(176,38,255,0.04)` |
| `--text-primary` | `#e0e0f0` | `#2a2540` |
| `--text-muted` | `#6b6b8d` | `#6b6584` |
| `--text-dim` | `#4a4a6a` | `#9c97b3` |
| `--neon-cyan`（文字用） | `#00f0ff` | `#0891b2`（cyan-600） |
| `--neon-pink`（文字用） | `#ff2e97` | `#db2777`（pink-600） |
| `--neon-purple`（文字用） | `#b026ff` | `#9333ea`（purple-600） |
| `--glow-cyan` | `0 0 12px rgba(0,240,255,0.15)` | `0 0 12px rgba(8,145,178,0.25)` |
| `--glow-pink` | `0 0 12px rgba(255,46,151,0.15)` | `0 0 12px rgba(219,39,119,0.20)` |
| `--surface-button` | `rgba(20,10,35,0.5)` | `rgba(245,240,250,0.8)` |
| `--surface-input` | `rgba(20,10,35,0.4)` | `rgba(236,228,245,0.6)` |
| `--divider` | `rgba(75,75,110,0.1)` | `rgba(75,65,110,0.1)` |
| `--divider-strong` | `rgba(75,75,110,0.25)` | `rgba(75,65,110,0.18)` |
| `--divider-cyan` | `rgba(0,240,255,0.12)` | `rgba(8,145,178,0.2)` |

**状态色**（语义不变，浅色版用更深文字 + 极浅同色底）：

| 状态 | 暗色（文字 / 底） | 浅色（文字 / 底） |
|---|---|---|
| error | `#fca5a5` / `rgba(69,10,10,0.4)` | `#b91c1c` / `rgba(254,226,226,0.6)` |
| warning | `#fde68a` / `rgba(120,53,15,0.18)` | `#b45309` / `rgba(254,243,199,0.7)` |
| success | `#bbf7d0` / `rgba(20,83,45,0.2)` | `#15803d` / `rgba(220,252,231,0.7)` |
| missing | `#fbbf24` | `#b45309` |

**Rank card 浅色版**：底色 gradient 中的暗色面板锚点 `rgba(15,8,30,0.5)` → 浅色面板锚点 `rgba(255,255,255,0.6)`；rank-1/2/3 strong 文字色用对应更深档（如 `#fef3c7` → `#78350f`）；badge 金银铜饱和度保留。

### 4. 组件改动清单

**新增**：

| 文件 | 职责 |
|---|---|
| `src/renderer/theme.ts` | ThemeSource 类型 + localStorage 读写 + resolveTheme 纯函数 + applyTheme + subscribeSystemTheme |
| `src/renderer/theme.test.ts` | resolveTheme 全组合单测 + localStorage 异常 fallback |
| `src/shared/theme.ts` | ThemeSource 类型 + ThemeApi 接口（与 TokenMetricsApi 同构） |

**修改**：

| 文件 | 改动 |
|---|---|
| `src/renderer/styles.css` | 全量变量化（200+ 处引用 `var(--*)`）；`:root` 加 `color-scheme: dark`；新增 `[data-theme="light"]` 覆盖块；新增 `::-webkit-scrollbar` 双套配色 |
| `src/renderer/App.tsx` | 新增 `useState<ThemeSource>` + `useEffect`（订阅 matchMedia + applyTheme + IPC 同步） |
| `src/renderer/components/SettingsModal.tsx` | `settings-language` 下新增 `settings-theme` 段，三按钮，复用 `lang-buttons` 样式与回调模式 |
| `src/renderer/locales/en.json` + `zh.json` | 新增 4 key：`settings.theme` / `settings.theme.dark` / `settings.theme.light` / `settings.theme.system` |
| `src/main/preload.ts` | `tokenMetrics` 对象新增 `setThemeSource` |
| `src/main/main.ts` | 新增 `ipcMain.handle("theme:set-source", ...)` → `nativeTheme.themeSource = src` |
| `index.html` | 加 `<meta name="color-scheme" content="dark light">` 防御性声明 |

### 5. 测试策略

- **纯函数单测**（`theme.test.ts`）：
  - `resolveTheme("dark", *) === "dark"`、`("light", *) === "light"`
  - `resolveTheme("system", true) === "dark"`、`("system", false) === "light"`
  - `getThemeSource()` localStorage 抛异常返回 `"system"` fallback
- **既有测试不破**：`App.test.ts` 用源码字符串断言不挂载，无需 mock matchMedia
- **CSS 验证**：手动切系统主题 + 设置开关三态，DevTools 改 `<html data-theme>` 即时预览
- **构建验证**：`bun run build` 确认无样式回归

### 6. 错误处理

| 场景 | 兜底 |
|---|---|
| localStorage 读取失败（隐私模式/异常） | `getThemeSource()` 返回 `"system"` |
| `matchMedia` 不支持 | `subscribeSystemTheme` 视为永远 `dark`，不抛错 |
| IPC `theme:set-source` 失败 | 不阻塞渲染；`data-theme` 已应用，仅 BrowserWindow 原生背景可能闪一次 |
| 未知 localStorage 值（手改脏数据） | 解析失败回 `"system"` |

## Non-Goals

- 不实现主题切换动画（颜色直接切换）
- 不为 rank card 金银铜单独主题化（保留为中立语义色）
- 不动图表配色（CLAUDE.md 明确 Cache/Fresh/Output 不变）
- 不动 tray icon（已 template image）
- 不引入 CSS-in-JS 或运行时主题注入（保留 styles.css 单文件结构）

## Risks & Future Evaluation

- **首帧闪烁**：`index.html` 的 `color-scheme` meta + 主进程默认 `nativeTheme.themeSource = "system"` 已能消除大部分。若验证后仍有跳变，在 `index.html` 注入 5 行 inline `<script>` 提前读 localStorage 设 `data-theme`（作为可选兜底任务）
- **rank card 浅色视觉验收**：金银铜在白底精致感难一次到位，实现后需视觉验收，必要时迭代
- **未来扩展**：若需「高对比度」「色弱友好」等额外主题，`ThemeSource` 可扩展为 union，CSS 增 `[data-theme="xxx"]` 块即可，架构无需重构
