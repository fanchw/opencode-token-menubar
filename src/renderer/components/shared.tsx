import { useEffect, useRef, useState } from "react"
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

export interface DropdownOption<T extends string | number> {
  value: T
  label: string
}

export function DropdownSelect<T extends string | number>({
  options,
  value,
  onChange,
  dropUp = false,
  ariaLabel,
}: {
  options: DropdownOption<T>[]
  value: T
  onChange: (value: T) => void
  dropUp?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleOutside)
    return () => document.removeEventListener("mousedown", handleOutside)
  }, [open])

  const selected = options.find((opt) => opt.value === value)

  return (
    <div className="dropdown-wrapper" ref={wrapperRef}>
      <button
        className="dropdown-trigger"
        onClick={() => setOpen((o) => !o)}
        type="button"
        aria-label={ariaLabel}
      >
        {selected?.label ?? value}
        <span className="dropdown-arrow">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div className={`dropdown-menu${dropUp ? " drop-up" : ""}`}>
          {options.map((opt) => (
            <button
              className={`dropdown-option${opt.value === value ? " active" : ""}`}
              key={String(opt.value)}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              type="button"
            >
              {opt.label}
              {opt.value === value ? <span className="dropdown-check">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export const pageSizeOptions = [10, 20, 50, 100, 200]

export function PageSizeSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <DropdownSelect
      dropUp
      ariaLabel={t("recent.pageSize", { size: value })}
      value={value}
      onChange={onChange}
      options={pageSizeOptions.map((size) => ({
        value: size,
        label: t("recent.pageSize", { size }),
      }))}
    />
  )
}
