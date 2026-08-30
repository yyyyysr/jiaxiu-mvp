import { useId, useState } from "react"
import type { FormEvent } from "react"

import { useSceneStore } from "../../scene/store"
import type { SceneAction } from "../../scene/store"
import { MAX_MESSAGE_LENGTH, useGuide } from "./GuideProvider"
import type { GuideTurnView } from "./GuideProvider"
import { GuideThread } from "./GuideThread"

/** Away from a particular poem the guide offers the four seasonal doors into the archive. */
const GENERAL_PROMPTS = ["秋日登楼", "四季何景", "诗中甲秀", "从河岸看"] as const
/** With a poem open the prompts turn to the questions a reader actually asks of it. */
const SUBJECT_PROMPTS = ["这首诗的创作背景", "诗人此刻的心境", "风格偏豪放还是婉约", "与甲秀楼景观的关系"] as const

type GuideConsoleProps = {
  invitation?: string
  onSceneAction?: (action: SceneAction) => void
}

export function GuideConsole({ invitation, onSceneAction }: GuideConsoleProps) {
  const { turns, status, scope, lastQuestion, subject, ask, cancel, reset } = useGuide()
  const applySceneAction = useSceneStore((state) => state.applySceneAction)
  const [input, setInput] = useState("")
  const questionId = useId()

  const send = (message: string) => {
    ask(message)
    setInput("")
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    send(input)
  }

  const applyScene = (turn: GuideTurnView) => {
    const action = turn.response?.scene_action
    if (!action) return
    if (onSceneAction) onSceneAction(action)
    else applySceneAction(action)
  }

  const prompts = subject ? SUBJECT_PROMPTS : GENERAL_PROMPTS

  return (
    <div className="guide-console">
      {invitation && <p className="guide-panel__invitation">{invitation}</p>}
      {subject && (
        <p className="guide-subject">
          <span>正在读</span>
          <b>《{subject.title || "无题"}》</b>
          <span>{subject.authors || "作者待考"}</span>
        </p>
      )}

      <GuideThread turns={turns} pending={status === "pending"} onApplyScene={applyScene} />

      {status === "pending" && (
        <div className="guide-notice guide-notice--pending">
          <p role="status">浮玉客正在循诗思索</p>
          <button className="guide-hit-target" type="button" onClick={cancel}>取消本次提问</button>
        </div>
      )}
      {status === "cancelled" && <p className="guide-notice" role="status">已取消本次寻访，可换一问。</p>}
      {status === "rate-limited" && <p className="guide-notice guide-notice--error" role="alert">问得太密，且在水边稍候片刻再来。</p>}
      {status === "error" && (
        <div className="guide-notice guide-notice--error" role="alert">
          <p>问句未能抵达，网络或服务暂时不可用。</p>
          <button className="guide-hit-target" type="button" onClick={() => send(lastQuestion)}>再循此问</button>
        </div>
      )}

      <div className="guide-prompts" aria-label="快捷提问">
        {prompts.map((prompt, index) => (
          <button className="guide-hit-target" type="button" key={prompt} onClick={() => send(prompt)}>
            <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{prompt}
          </button>
        ))}
      </div>

      <form className="guide-form" aria-label="向浮玉客提问" onSubmit={submit}>
        <label htmlFor={questionId}>向浮玉客提问</label>
        <div>
          <input
            id={questionId}
            value={input}
            maxLength={MAX_MESSAGE_LENGTH}
            onChange={(event) => setInput(event.target.value)}
            placeholder="留一行问句……"
            autoComplete="off"
          />
          <button className="guide-hit-target" type="submit" disabled={!input.trim()}>送出问题</button>
        </div>
        <span aria-live="polite">{input.length} / {MAX_MESSAGE_LENGTH}</span>
      </form>

      <div className="guide-console__footer">
        <p>{scope === "account" ? "对话已随账户留存" : "临时对话 · 清除浏览器 Cookie 即重置"}</p>
        {turns.length > 0 && (
          <button className="guide-hit-target" type="button" onClick={reset}>清空对话</button>
        )}
      </div>
    </div>
  )
}
