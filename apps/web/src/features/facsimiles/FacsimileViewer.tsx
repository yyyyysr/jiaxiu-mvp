import { PointerEvent as ReactPointerEvent, useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { resolveMediaUrl } from "../../lib/api"
import type { Facsimile } from "../../lib/types"

type FacsimileViewerProps = {
  items: Facsimile[]
  workTitle: string
  workText?: string
}

type FacsimileGroup = {
  key: string
  items: Facsimile[]
  preview?: Facsimile
  previewUrl: string | null
  master?: Facsimile
  masterUrl: string | null
}

type ViewMode = "fit" | "actual" | "custom"
type Pan = { x: number; y: number }
type Drag = { pointerId: number; startX: number; startY: number; origin: Pan }

const BROWSER_FORMATS = new Set(["jpg", "jpeg", "png"])

function groupKey(image: Facsimile): string {
  const sourceId = image.source_id?.trim()
  if (!sourceId) return `unpaired:${image.image_id}`
  return JSON.stringify([
    sourceId,
    image.scan_page,
    image.print_page.trim(),
    image.pixel_width,
    image.pixel_height,
    image.locator.trim(),
  ])
}

function groupFacsimiles(items: Facsimile[]): FacsimileGroup[] {
  const grouped = new Map<string, Facsimile[]>()
  items.forEach((item) => {
    const key = groupKey(item)
    grouped.set(key, [...(grouped.get(key) ?? []), item])
  })

  return [...grouped.entries()].map(([key, records]) => {
    const preview = records.find((item) => item.deployed && BROWSER_FORMATS.has(item.file_format.toLowerCase()) && resolveMediaUrl(item.public_url))
    const master = records.find((item) => item.deployed && item.file_format.toLowerCase() === "jp2" && resolveMediaUrl(item.public_url))
    return {
      key,
      items: records,
      preview,
      previewUrl: preview ? resolveMediaUrl(preview.public_url) : null,
      master,
      masterUrl: master ? resolveMediaUrl(master.public_url) : null,
    }
  }).sort((first, second) => first.items[0].sequence - second.items[0].sequence)
}

function imageTransform(pan: Pan, zoom: number, rotation: number): string {
  const transform = `scale(${zoom}) rotate(${rotation}deg)`
  return pan.x === 0 && pan.y === 0 ? transform : `translate(${pan.x}px, ${pan.y}px) ${transform}`
}

export function FacsimileViewer({ items, workTitle, workText = "" }: FacsimileViewerProps) {
  const groups = useMemo(() => groupFacsimiles(items), [items])
  const pages = useMemo(() => groups.filter((group) => group.preview && group.previewUrl), [groups])
  const [openPageIndex, setOpenPageIndex] = useState<number>()
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [viewMode, setViewMode] = useState<ViewMode>("fit")
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 })
  const [imageError, setImageError] = useState(false)
  const [fullscreenStatus, setFullscreenStatus] = useState("")
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<Drag | undefined>(undefined)
  const titleId = useId()
  const isOpen = openPageIndex !== undefined
  const openPage = openPageIndex === undefined ? undefined : pages[openPageIndex]
  const currentPageIndex = openPageIndex ?? 0

  function resetView(mode: ViewMode = "fit") {
    setZoom(1)
    setRotation(0)
    setViewMode(mode)
    setPan({ x: 0, y: 0 })
    setImageError(false)
    dragRef.current = undefined
  }

  function closeViewer() {
    setOpenPageIndex(undefined)
  }

  function selectPage(index: number) {
    if (index < 0 || index >= pages.length) return
    resetView()
    setOpenPageIndex(index)
  }

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setOpenPageIndex(undefined)
        return
      }
      if (event.key !== "Tab") return
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])") ?? [])]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable.at(-1) ?? first
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = previousOverflow
      restoreFocusRef.current?.focus()
    }
  }, [isOpen])

  function openViewer(group: FacsimileGroup, opener: HTMLElement) {
    const index = pages.findIndex((page) => page.key === group.key)
    if (index < 0) return
    restoreFocusRef.current = opener
    resetView()
    setFullscreenStatus("")
    setOpenPageIndex(index)
  }

  function setFitMode(mode: "fit" | "actual") {
    resetView(mode)
  }

  function adjustZoom(change: number) {
    setZoom((value) => Math.max(.5, Math.min(3, value + change)))
    setViewMode("custom")
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (viewMode === "fit") return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: pan }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPan({ x: drag.origin.x + event.clientX - drag.startX, y: drag.origin.y + event.clientY - drag.startY })
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = undefined
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // The capture can already be released when the pointer leaves the browser viewport.
    }
  }

  async function enterFullscreen() {
    if (!dialogRef.current || typeof dialogRef.current.requestFullscreen !== "function") {
      setFullscreenStatus("此浏览器不支持全屏查看。")
      return
    }
    try {
      await dialogRef.current.requestFullscreen()
      setFullscreenStatus("")
    } catch {
      setFullscreenStatus("无法进入全屏，请继续使用页面内查看器。")
    }
  }

  const workLines = workText.split(/\r?\n/).filter(Boolean)

  return (
    <div className="facsimile-viewer">
      {groups.map((group) => {
        return (
          <section className="facsimile-record" role="group" aria-label={`${workTitle}影像`} key={group.key}>
            <div className="facsimile-record__heading">
              <h3>{workTitle}</h3>
            </div>
            <div className="facsimile-record__actions">
              {group.preview && group.previewUrl ? (
                <button type="button" onClick={(event) => openViewer(group, event.currentTarget)} aria-label="查看影像">
                  <span aria-hidden="true">展</span> 查看影像
                </button>
              ) : (
                <p className="facsimile-record__unavailable">影像尚未部署</p>
              )}
              {group.master && group.masterUrl && (
                <a href={group.masterUrl} download={`${group.master.image_id}.jp2`} target="_blank" rel="noreferrer" aria-label="下载 JP2 母版">下载 JP2 母版</a>
              )}
            </div>
          </section>
        )
      })}

      {openPage && openPage.preview && openPage.previewUrl && createPortal(
        <div className="facsimile-lightbox" role="presentation">
          <div className="facsimile-lightbox__dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
            <header className="facsimile-lightbox__header">
              <div><p>ARCHIVAL READING DESK</p><h2 id={titleId}>{workTitle}</h2></div>
              <div className="facsimile-lightbox__readout">
                <span>{String(currentPageIndex + 1).padStart(2, "0")} / {String(pages.length).padStart(2, "0")}</span>
                <output aria-live="polite">{viewMode === "fit" ? "适合窗口" : viewMode === "actual" ? "原大 100%" : `${Math.round(zoom * 100)}% · ${rotation}°`}</output>
              </div>
            </header>
            <div className="facsimile-lightbox__controls" aria-label="影像查看工具">
              <button type="button" aria-label="缩小影像" onClick={() => adjustZoom(-.25)}>－</button>
              <button type="button" aria-label="放大影像" onClick={() => adjustZoom(.25)}>＋</button>
              <button type="button" aria-label="适合窗口" aria-pressed={viewMode === "fit"} onClick={() => setFitMode("fit")}>适窗</button>
              <button type="button" aria-label="原大 100%" aria-pressed={viewMode === "actual"} onClick={() => setFitMode("actual")}>原大</button>
              <button type="button" aria-label="顺时针旋转影像" onClick={() => setRotation((value) => (value + 90) % 360)}>旋转</button>
              <button type="button" aria-label="重置影像" onClick={() => resetView()}>复位</button>
              <button type="button" aria-label="上一页影像" disabled={currentPageIndex === 0} onClick={() => selectPage(currentPageIndex - 1)}>前页</button>
              <button type="button" aria-label="下一页影像" disabled={currentPageIndex === pages.length - 1} onClick={() => selectPage(currentPageIndex + 1)}>后页</button>
              <button type="button" aria-label="全屏查看影像" onClick={() => void enterFullscreen()}>全屏</button>
              <button type="button" aria-label="关闭影像查看器" onClick={closeViewer} ref={closeRef}>关闭</button>
            </div>
            {fullscreenStatus && <p className="facsimile-lightbox__status" role="status">{fullscreenStatus}</p>}
            <div className="facsimile-lightbox__body">
              <nav className="facsimile-lightbox__thumbnails" aria-label="影像缩略页">
                {pages.map((page, index) => (
                  <button type="button" key={page.key} aria-label={`选择影像 ${String(index + 1).padStart(2, "0")}`} aria-current={index === currentPageIndex ? "page" : undefined} onClick={() => selectPage(index)}>
                    <img src={page.previewUrl!} alt="" loading="lazy" />
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </button>
                ))}
              </nav>
              <div
                className={`facsimile-lightbox__stage${viewMode === "fit" ? "" : " is-pannable"}`}
                role="region"
                aria-label="可拖移的影像"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerEnd}
                onPointerCancel={handlePointerEnd}
              >
                {imageError ? (
                  <div className="facsimile-lightbox__error" role="alert"><b>影像载入失败</b><span>可切换其他页，或关闭查看器后重试。</span></div>
                ) : (
                  <img
                    className={`facsimile-lightbox__image--${viewMode === "fit" ? "fit" : "actual"}`}
                    src={openPage.previewUrl}
                    alt={workTitle}
                    draggable="false"
                    onDoubleClick={() => setFitMode(viewMode === "fit" ? "actual" : "fit")}
                    onError={() => setImageError(true)}
                    style={{ transform: imageTransform(pan, zoom, rotation) }}
                  />
                )}
              </div>
              <section className="facsimile-lightbox__transcript" role="region" aria-label="正文对读">
                <p>TEXT · 校录正文</p>
                <h3>{workTitle}</h3>
                <div lang="zh-Hans">{workLines.length > 0 ? workLines.map((line, index) => <p key={`${index}-${line}`}>{line}</p>) : <p>本页未附正文校录。</p>}</div>
              </section>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
