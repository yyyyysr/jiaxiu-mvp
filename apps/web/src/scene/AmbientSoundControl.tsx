import { useEffect, useRef, useState } from "react"

import { canUseAmbientSound, createAmbientSoundscape, type AmbientSoundscape } from "./ambientSound"
import type { SeasonId } from "./types"

type AmbientSoundControlProps = { season: SeasonId }
type SoundStatus = "off" | "starting" | "on" | "error"

export function AmbientSoundControl({ season }: AmbientSoundControlProps) {
  const [supported] = useState(canUseAmbientSound)
  const [status, setStatus] = useState<SoundStatus>("off")
  const soundRef = useRef<AmbientSoundscape | null>(null)
  const requestRef = useRef(0)

  useEffect(() => {
    soundRef.current?.setSeason(season)
  }, [season])

  useEffect(() => () => {
    requestRef.current += 1
    soundRef.current?.dispose()
    soundRef.current = null
  }, [])

  const toggle = async () => {
    if (status === "on") {
      requestRef.current += 1
      soundRef.current?.dispose()
      soundRef.current = null
      setStatus("off")
      return
    }
    if (!supported || status === "starting") return

    const request = requestRef.current + 1
    requestRef.current = request
    const sound = createAmbientSoundscape(season)
    setStatus("starting")
    try {
      await sound.start()
      if (request !== requestRef.current) {
        sound.dispose()
        return
      }
      sound.setSeason(season)
      soundRef.current = sound
      setStatus("on")
    } catch {
      sound.dispose()
      if (request === requestRef.current) setStatus("error")
    }
  }

  return (
    <div className="ambient-sound-control">
      <button
        type="button"
        aria-pressed={status === "on"}
        disabled={!supported || status === "starting"}
        aria-label={!supported ? "环境声不可用" : status === "on" ? "关闭四时环境声" : "开启四时环境声"}
        onClick={() => { void toggle() }}
      >
        <span aria-hidden="true">{status === "on" ? "〽" : "○"}</span>
        {!supported ? "环境声不可用" : status === "starting" ? "正在启声" : status === "on" ? "关闭环境声" : "聆听环境声"}
      </button>
      <p aria-live="polite">
        {!supported ? "当前浏览器不支持环境声" : status === "on" ? "已开启低音量生成声景" : status === "error" ? "环境声未能开启" : "默认静音 · 主动开启"}
      </p>
    </div>
  )
}
