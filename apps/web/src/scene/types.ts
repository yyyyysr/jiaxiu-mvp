export type SeasonId = "spring" | "summer" | "autumn" | "winter"
export type QualityLevel = "low" | "medium" | "high"
export type Vec3 = [number, number, number]
export type Quaternion = [number, number, number, number]

export type Bounds = { min: Vec3; max: Vec3 }

export type AssetTransform = {
  sourceUpAxis: "-y"
  sourceFrontAxis: "+z"
  sourceToSceneQuaternion: Quaternion
}

export type AssetRights = {
  permission: "provided_by_user_for_project_use"
  licenseStatus: "not_documented"
  usageScope: "research_mvp_and_local_demonstration_only"
}

export type SplatAssetManifest = {
  assetRights: AssetRights
  format: "binary_little_endian_ply"
  sourceSha256: string
  webSha256: string
  vertexCount: number
  recordBytes: 68
  properties: string[]
  sourceBounds: Bounds
  nonfiniteOpacity: { positiveInfinity: number; negativeInfinity: number }
  opacityClamp: { positive: number; negative: number }
  assetTransform: AssetTransform
  referenceImage: { path: string; sha256: string; width: number; height: number }
}

export type CameraPose = { position: Vec3; target: Vec3 }

export type SceneSeasonConfig = {
  id: SeasonId
  label: string
  sky: string
  fog: string
  foliage: string
  water: string
  particles: "rain" | "mist" | "leaves" | "snow"
  ambience: string
}

export type SceneConfig = {
  version: 1
  seasons: SceneSeasonConfig[]
}

export type RenderProfile = {
  pixelRatio: number
  lodSplatCount: number
  quality: QualityLevel
}

export type SplatSceneOptions = {
  manifest: SplatAssetManifest
  initialSeason: SeasonId
  quality?: QualityLevel
  reducedMotion: boolean
  signal?: AbortSignal
  onProgress?: (progress: number | null) => void
  onReady?: () => void
}

export type SceneController = {
  setSeason: (season: SeasonId) => void
  setQuality: (quality: QualityLevel) => void
  setReducedMotion: (reducedMotion: boolean) => void
  dispose: () => void
}
