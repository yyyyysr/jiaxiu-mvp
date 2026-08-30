import { api } from "../lib/api"
import type { RenderProfile, SceneConfig, SeasonId } from "./types"

export const SEASON_IDS = ["spring", "summer", "autumn", "winter"] as const satisfies readonly SeasonId[]

export const LOCAL_SCENE_CONFIG: SceneConfig = {
  version: 1,
  seasons: [
    { id: "spring", label: "春", sky: "#b9ced0", fog: "#cad8d2", foliage: "#78966b", water: "#769da0", particles: "rain", ambience: "spring_rain" },
    { id: "summer", label: "夏", sky: "#8fb8c3", fog: "#abc2ba", foliage: "#416f4d", water: "#4f8f94", particles: "mist", ambience: "summer_water" },
    { id: "autumn", label: "秋", sky: "#b6aa91", fog: "#c8baa0", foliage: "#9a7046", water: "#70878a", particles: "leaves", ambience: "autumn_wind" },
    { id: "winter", label: "冬", sky: "#929faa", fog: "#b4bec3", foliage: "#68716b", water: "#667d88", particles: "snow", ambience: "winter_stillness" },
  ],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function parseSeason(value: unknown, index: number): SceneConfig["seasons"][number] {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "label", "sky", "fog", "foliage", "water", "particles", "ambience"])) {
    throw new Error(`season ${index} has unexpected fields`)
  }
  if (!SEASON_IDS.includes(value.id as SeasonId)) throw new Error(`season ${index} has an invalid id`)
  if (![value.label, value.sky, value.fog, value.foliage, value.water, value.ambience].every((item) => typeof item === "string" && item)) {
    throw new Error(`season ${index} has invalid colour or label data`)
  }
  if (!["rain", "mist", "leaves", "snow"].includes(value.particles as string)) throw new Error(`season ${index} has invalid particles`)
  return { id: value.id as SeasonId, label: value.label as string, sky: value.sky as string, fog: value.fog as string, foliage: value.foliage as string, water: value.water as string, particles: value.particles as SceneConfig["seasons"][number]["particles"], ambience: value.ambience as string }
}

export function validateSceneConfig(value: unknown): SceneConfig {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "seasons"])) throw new Error("scene config has unexpected fields")
  if (value.version !== 1 || !Array.isArray(value.seasons)) throw new Error("scene config has invalid structure")
  const seasons = value.seasons.map(parseSeason)
  if (seasons.map((season) => season.id).join(",") !== SEASON_IDS.join(",")) throw new Error("scene config has an unexpected season whitelist")
  return { version: 1, seasons }
}

export async function loadSceneConfig(): Promise<SceneConfig> {
  try {
    return validateSceneConfig(await api.getSceneConfig())
  } catch {
    return validateSceneConfig(LOCAL_SCENE_CONFIG)
  }
}

export function getRenderProfile(viewportWidth: number, devicePixelRatio: number): RenderProfile {
  const ratio = Math.max(1, devicePixelRatio || 1)
  if (viewportWidth < 640) return { pixelRatio: Math.min(ratio, 1.25), lodSplatCount: 300_000, quality: "low" }
  if (viewportWidth < 1100) return { pixelRatio: Math.min(ratio, 1.5), lodSplatCount: 750_000, quality: "medium" }
  return { pixelRatio: Math.min(ratio, 1.75), lodSplatCount: 1_500_000, quality: "high" }
}
