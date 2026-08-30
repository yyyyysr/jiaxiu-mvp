import type { AssetRights, AssetTransform, Bounds, SplatAssetManifest, Vec3 } from "./types"

const MANIFEST_PATH = "assets/splats/jiaxiu-splat.manifest.json"
const EXPECTED_PROPERTIES = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
const IMMUTABLE_MANIFEST = {
  assetRights: {
    permission: "provided_by_user_for_project_use",
    licenseStatus: "not_documented",
    usageScope: "research_mvp_and_local_demonstration_only",
  },
  sourceSha256: "3F3EAC93EFCE9E2F62958096E337B28E9D99A9276319B16AC07CF77D47689E84",
  webSha256: "8D80419F17E04AC4C997F6F350B15B02C03617262328EFC3B25F9D631AF6892A",
  vertexCount: 262_144,
  recordBytes: 68,
  sourceBounds: {
    min: [-0.4138890505, -0.49820894, -0.3628318906],
    max: [0.4486659765, 0.5052185059, 0.360003233],
  },
  nonfiniteOpacity: { positiveInfinity: 27_591, negativeInfinity: 160 },
  opacityClamp: { positive: 16, negative: -16 },
  assetTransform: { sourceUpAxis: "-y", sourceFrontAxis: "+z", sourceToSceneQuaternion: [1, 0, 0, 0] },
  referenceImage: {
    path: "assets/splats/reference/original_pic.jpg",
    sha256: "601F19F3092BD967B6A3D2CDC71219AB50941985B9CB55158EE1557B5A96495C",
    width: 1080,
    height: 1621,
  },
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function parseHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-F0-9]{64}$/.test(value)) throw new Error(`${label} must be an uppercase SHA-256 hash`)
  return value
}

function parseVector(value: unknown, label: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) throw new Error(`${label} must be a finite Vec3`)
  return [value[0], value[1], value[2]]
}

function parseBounds(value: unknown): Bounds {
  if (!isRecord(value) || !hasExactKeys(value, ["min", "max"])) throw new Error("sourceBounds has unexpected fields")
  const min = parseVector(value.min, "sourceBounds min")
  const max = parseVector(value.max, "sourceBounds max")
  if (!min.every((entry, index) => entry < max[index])) throw new Error("sourceBounds must have positive extents")
  return { min, max }
}

function hasExactValues(value: unknown, expected: unknown): boolean {
  if (Object.is(value, expected)) return true
  if (Array.isArray(value) && Array.isArray(expected)) {
    return value.length === expected.length && value.every((entry, index) => hasExactValues(entry, expected[index]))
  }
  if (isRecord(value) && isRecord(expected)) {
    const keys = Object.keys(expected)
    return hasExactKeys(value, keys) && keys.every((key) => hasExactValues(value[key], expected[key]))
  }
  return false
}

function parseTransform(value: unknown): AssetTransform {
  if (!isRecord(value) || !hasExactKeys(value, ["sourceUpAxis", "sourceFrontAxis", "sourceToSceneQuaternion"])) throw new Error("assetTransform has unexpected fields")
  if (value.sourceUpAxis !== "-y" || value.sourceFrontAxis !== "+z") throw new Error("assetTransform has an uncalibrated axis contract")
  if (!Array.isArray(value.sourceToSceneQuaternion) || value.sourceToSceneQuaternion.length !== 4 || !value.sourceToSceneQuaternion.every((entry) => typeof entry === "number" && Number.isFinite(entry))) throw new Error("assetTransform quaternion is invalid")
  const quaternion = value.sourceToSceneQuaternion as [number, number, number, number]
  if (Math.abs(Math.hypot(...quaternion) - 1) > 1e-6) throw new Error("assetTransform quaternion must be normalized")
  return { sourceUpAxis: "-y", sourceFrontAxis: "+z", sourceToSceneQuaternion: quaternion }
}

function parseAssetRights(value: unknown): AssetRights {
  if (!isRecord(value) || !hasExactKeys(value, ["permission", "licenseStatus", "usageScope"])) throw new Error("assetRights has unexpected fields")
  if (!hasExactValues(value, IMMUTABLE_MANIFEST.assetRights)) throw new Error("assetRights does not match the reviewed usage boundary")
  return { ...IMMUTABLE_MANIFEST.assetRights }
}

export function resolvePublicAssetUrl(baseUrl: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith("/") || relativePath.split("/").includes("..")) throw new Error("asset path must be relative to Vite BASE_URL")
  const normalizedBase = `${baseUrl || "/"}`.replace(/\/+$/, "") || "/"
  return `${normalizedBase === "/" ? "/" : `${normalizedBase}/`}${relativePath}`
}

export function validateSplatManifest(value: unknown): SplatAssetManifest {
  const keys = ["assetRights", "format", "sourceSha256", "webSha256", "vertexCount", "recordBytes", "properties", "sourceBounds", "nonfiniteOpacity", "opacityClamp", "assetTransform", "referenceImage"]
  if (!isRecord(value) || !hasExactKeys(value, keys)) throw new Error("unexpected manifest fields")
  if (value.format !== "binary_little_endian_ply" || value.recordBytes !== IMMUTABLE_MANIFEST.recordBytes || value.vertexCount !== IMMUTABLE_MANIFEST.vertexCount) throw new Error("manifest has an unexpected PLY contract")
  if (!Array.isArray(value.properties) || value.properties.join(",") !== EXPECTED_PROPERTIES.join(",")) throw new Error("manifest has unexpected PLY properties")
  if (!isRecord(value.nonfiniteOpacity) || !hasExactKeys(value.nonfiniteOpacity, ["positiveInfinity", "negativeInfinity"]) || !hasExactValues(value.nonfiniteOpacity, IMMUTABLE_MANIFEST.nonfiniteOpacity)) throw new Error("manifest has invalid opacity replacements")
  if (!isRecord(value.opacityClamp) || !hasExactValues(value.opacityClamp, IMMUTABLE_MANIFEST.opacityClamp)) throw new Error("manifest has invalid opacity clamp")
  if (!isRecord(value.referenceImage) || !hasExactKeys(value.referenceImage, ["path", "sha256", "width", "height"])) throw new Error("manifest has invalid reference image")
  const reference = value.referenceImage
  if (!hasExactValues(reference, IMMUTABLE_MANIFEST.referenceImage)) throw new Error("manifest has invalid reference image")
  const sourceBounds = parseBounds(value.sourceBounds)
  const assetTransform = parseTransform(value.assetTransform)
  const assetRights = parseAssetRights(value.assetRights)
  if (!hasExactValues(sourceBounds, IMMUTABLE_MANIFEST.sourceBounds)) throw new Error("manifest has unexpected source bounds")
  if (!hasExactValues(assetTransform, IMMUTABLE_MANIFEST.assetTransform)) throw new Error("manifest has unexpected asset transform")
  const sourceSha256 = parseHash(value.sourceSha256, "sourceSha256")
  const webSha256 = parseHash(value.webSha256, "webSha256")
  if (sourceSha256 !== IMMUTABLE_MANIFEST.sourceSha256 || webSha256 !== IMMUTABLE_MANIFEST.webSha256) throw new Error("manifest has unexpected immutable hashes")
  return {
    assetRights,
    format: value.format,
    sourceSha256,
    webSha256,
    vertexCount: value.vertexCount,
    recordBytes: value.recordBytes,
    properties: [...EXPECTED_PROPERTIES],
    sourceBounds,
    nonfiniteOpacity: value.nonfiniteOpacity as SplatAssetManifest["nonfiniteOpacity"],
    opacityClamp: value.opacityClamp as SplatAssetManifest["opacityClamp"],
    assetTransform,
    referenceImage: { ...IMMUTABLE_MANIFEST.referenceImage },
  }
}

export async function readSplatManifest(signal?: AbortSignal): Promise<SplatAssetManifest> {
  const response = await fetch(resolvePublicAssetUrl(import.meta.env.BASE_URL, MANIFEST_PATH), { signal, headers: { Accept: "application/json" } })
  if (!response.ok) throw new Error(`splat manifest request failed with status ${response.status}`)
  return validateSplatManifest(await response.json())
}

export function getSplatAssetUrl(): string {
  return resolvePublicAssetUrl(import.meta.env.BASE_URL, "assets/splats/jiaxiu-web.ply")
}
