import { useEffect, useId, useRef, type ReactNode } from "react"

type AdminDialogProps = {
  title: string
  children: ReactNode
  onClose: () => void
  closeLabel?: string
  initialFocus?: "first" | "last"
}

export function AdminDialog({ title, children, onClose, closeLabel = "关闭", initialFocus = "first" }: AdminDialogProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])")
    const target = initialFocus === "last" ? focusable?.item((focusable?.length ?? 1) - 1) : focusable?.item(0)
    target?.focus()
    return () => { returnFocusRef.current?.focus() }
  }, [initialFocus])

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== "Tab") return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])") ?? [])]
    if (!focusable.length) return
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return (
    <div className="admin-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleKeyDown}>
        <p className="kicker">ARCHIVE · CONFIRMATION</p>
        <h2 id={titleId}>{title}</h2>
        {children}
        <button className="admin-dialog__close" type="button" onClick={onClose}>{closeLabel}</button>
      </div>
    </div>
  )
}
