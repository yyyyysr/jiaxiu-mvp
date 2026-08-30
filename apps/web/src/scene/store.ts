import { create } from "zustand"
import { createStore } from "zustand/vanilla"

import { SEASON_IDS } from "./config"
import type { QualityLevel, SeasonId } from "./types"

export type SceneAction = { season?: unknown }

export type SceneStore = {
  season: SeasonId
  quality?: QualityLevel
  setSeason: (season: unknown) => void
  setQuality: (quality: unknown) => void
  applySceneAction: (action: SceneAction) => void
}

const isSeason = (value: unknown): value is SeasonId => SEASON_IDS.includes(value as SeasonId)
const isQuality = (value: unknown): value is QualityLevel => value === "low" || value === "medium" || value === "high"

const buildStore = (set: (partial: Partial<SceneStore>) => void, get: () => SceneStore): SceneStore => ({
  season: "autumn",
  quality: undefined,
  setSeason: (season) => { if (isSeason(season)) set({ season }) },
  setQuality: (quality) => { if (isQuality(quality)) set({ quality }) },
  applySceneAction: (action) => {
    const state = get()
    set({ season: isSeason(action.season) ? action.season : state.season })
  },
})

export const createSceneStore = () => createStore<SceneStore>(buildStore)
export const useSceneStore = create<SceneStore>(buildStore)
