const IDLE_DELAY_MS = 30_000
const TOUR_STEP_DELAY_MS = 12_000

export type IdleTour = {
  notifyInteraction: () => void
  setReducedMotion: (reducedMotion: boolean) => void
  dispose: () => void
}

type IdleTourOptions = {
  reducedMotion: boolean
  onStep: () => void
}

export function createIdleTour({ reducedMotion, onStep }: IdleTourOptions): IdleTour {
  let motionReduced = reducedMotion
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  const scheduleStep = () => {
    if (disposed || motionReduced) return
    clear()
    timer = setTimeout(() => {
      timer = undefined
      if (disposed || motionReduced) return
      onStep()
      scheduleStep()
    }, TOUR_STEP_DELAY_MS)
  }

  const scheduleIdle = () => {
    if (disposed || motionReduced) return
    clear()
    timer = setTimeout(() => {
      timer = undefined
      if (disposed || motionReduced) return
      onStep()
      scheduleStep()
    }, IDLE_DELAY_MS)
  }
  scheduleIdle()

  return {
    notifyInteraction() {
      if (disposed) return
      clear()
      scheduleIdle()
    },
    setReducedMotion(next) {
      if (disposed || next === motionReduced) return
      motionReduced = next
      clear()
      if (!next) scheduleIdle()
    },
    dispose() {
      if (disposed) return
      disposed = true
      clear()
    },
  }
}
