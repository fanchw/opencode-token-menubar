import { useState } from "react"
import type React from "react"

import { t } from "../i18n.js"

export interface HoverTip {
  x: number
  y: number
  text: string
}

export function TipCell({
  className,
  tip,
  children,
  onHover,
}: {
  className?: string
  tip: string
  children: React.ReactNode
  onHover: (pos: HoverTip | null) => void
}) {
  return (
    <span
      className={className}
      onMouseMove={(e) => onHover({ x: e.clientX, y: e.clientY, text: tip })}
      onMouseLeave={() => onHover(null)}
    >
      {children}
    </span>
  )
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-card">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  )
}

export const pageSizeOptions = [10, 20, 50, 100, 200]

export function PageSizeSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="page-size-wrapper">
      <button className="page-size-trigger" onClick={() => setOpen((o) => !o)} type="button">
        {t("recent.pageSize", { size: value })}
        <span className="page-size-arrow">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <>
          <div className="page-size-backdrop" onClick={() => setOpen(false)} />
          <div className="page-size-dropdown">
            {pageSizeOptions.map((opt) => (
              <button
                className={`page-size-option${opt === value ? " active" : ""}`}
                key={opt}
                onClick={() => { onChange(opt); setOpen(false) }}
                type="button"
              >
                {t("recent.pageSize", { size: opt })}
                {opt === value ? <span className="page-size-check">✓</span> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
