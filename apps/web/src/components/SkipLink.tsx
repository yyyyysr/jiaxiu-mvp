import type { MouseEvent } from "react"

export function SkipLink() {
  function moveToMain(event: MouseEvent<HTMLAnchorElement>) {
    const target = document.getElementById("main-content")
    if (!target) return
    event.preventDefault()
    target.focus()
    target.scrollIntoView?.({ block: "start" })
  }

  return <a className="skip-link" href="#main-content" onClick={moveToMain}>跳至主要内容</a>
}
