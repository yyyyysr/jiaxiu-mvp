import type { SeasonId } from "./types"

export type AmbientProfile = { filterFrequency: number; gain: number; playbackRate: number }

const AMBIENT_PROFILES: Record<SeasonId, AmbientProfile> = {
  spring: { filterFrequency: 1_650, gain: 0.026, playbackRate: 1.12 },
  summer: { filterFrequency: 980, gain: 0.032, playbackRate: 0.82 },
  autumn: { filterFrequency: 1_320, gain: 0.022, playbackRate: 0.94 },
  winter: { filterFrequency: 620, gain: 0.014, playbackRate: 0.74 },
}

export type AmbientSoundscape = {
  start: () => Promise<void>
  setSeason: (season: SeasonId) => void
  dispose: () => void
}

export function getAmbientProfile(season: SeasonId): AmbientProfile {
  return AMBIENT_PROFILES[season]
}

export function canUseAmbientSound(): boolean {
  return typeof window !== "undefined" && typeof window.AudioContext === "function"
}

function makeRiverNoise(context: AudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * 2))
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  let seed = 0x6d2b79f5
  let brown = 0
  for (let index = 0; index < data.length; index += 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
    const white = seed / 0xffffffff * 2 - 1
    brown = (brown + white * 0.025) / 1.025
    data[index] = brown * 2.4
  }
  return buffer
}

export function createAmbientSoundscape(initialSeason: SeasonId): AmbientSoundscape {
  if (!canUseAmbientSound()) throw new Error("Web Audio is unavailable")
  const context = new AudioContext({ latencyHint: "playback" })
  const source = context.createBufferSource()
  const filter = context.createBiquadFilter()
  const gain = context.createGain()
  source.buffer = makeRiverNoise(context)
  source.loop = true
  filter.type = "lowpass"
  filter.Q.value = 0.55
  source.connect(filter).connect(gain).connect(context.destination)
  let started = false
  let disposed = false

  const applySeason = (season: SeasonId, immediate = false) => {
    const profile = getAmbientProfile(season)
    const at = context.currentTime
    if (immediate) {
      filter.frequency.setValueAtTime(profile.filterFrequency, at)
      gain.gain.setValueAtTime(profile.gain, at)
      source.playbackRate.setValueAtTime(profile.playbackRate, at)
    } else {
      filter.frequency.setTargetAtTime(profile.filterFrequency, at, 0.45)
      gain.gain.setTargetAtTime(profile.gain, at, 0.55)
      source.playbackRate.setTargetAtTime(profile.playbackRate, at, 0.5)
    }
  }
  applySeason(initialSeason, true)

  return {
    async start() {
      if (disposed || started) return
      await context.resume()
      if (disposed) return
      source.start()
      started = true
    },
    setSeason(season) {
      if (!disposed) applySeason(season)
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (started) {
        try { source.stop() } catch { /* The node may already have stopped. */ }
      }
      source.disconnect()
      filter.disconnect()
      gain.disconnect()
      void context.close()
    },
  }
}
