import { useEffect, useRef } from "react"

import { GuideAnswer } from "./GuideAnswer"
import type { GuideTurnView } from "./GuideProvider"

type GuideThreadProps = {
  turns: GuideTurnView[]
  pending: boolean
  onApplyScene: (turn: GuideTurnView) => void
}

export function GuideThread({ turns, pending, onApplyScene }: GuideThreadProps) {
  const endRef = useRef<HTMLLIElement>(null)

  // Keep the newest exchange in view without dragging the surrounding page along with it.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" })
  }, [turns.length, pending])

  if (turns.length === 0) return null

  return (
    <ol className="guide-thread" aria-label="浮玉客对话记录">
      {turns.map((turn) => (
        <li key={turn.id} className={`guide-turn guide-turn--${turn.role}`}>
          {turn.role === "user" ? (
            <p className="guide-turn__question"><span aria-hidden="true">问</span>{turn.content}</p>
          ) : turn.response ? (
            <GuideAnswer response={turn.response} onApplyScene={() => onApplyScene(turn)} />
          ) : (
            <p className="guide-turn__answer">{turn.content}</p>
          )}
        </li>
      ))}
      <li className="guide-thread__end" ref={endRef} aria-hidden="true" />
    </ol>
  )
}
