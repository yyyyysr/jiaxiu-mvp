import type { Bounds, CameraPose, Quaternion, SplatAssetManifest, Vec3 } from "./types"

/**
 * The single opening view of the Jiaxiu scene: the head-on river-bank reference
 * look from `assets/splats/reference/original_pic.jpg`, rotated 135° around the
 * tower toward the captured +X side (i.e. the reference 45° panned view rotated
 * a further 90° to the right, opening on a back-right three-quarter view). The
 * reader may then orbit freely with the mouse — full 360° horizontally.
 *
 * Derived from the reference pose { position: [0, 0.32, 1.8], target: [0, 0.42, 0] }
 * by rotating the position around the target's vertical axis by -135°:
 * offset = [0, -0.1, 1.8] → [1.8*sin135°, -0.1, -1.8*cos135°] = [1.272792, -0.1, -1.272792].
 */
export const INITIAL_SCENE_RATIOS: CameraPose = {
  position: [1.272792, 0.32, -1.272792],
  target: [0, 0.42, 0],
}

export const INITIAL_FIELD_OF_VIEW_DEGREES = 43

/**
 * Vertical and distance bounds for the free 360° orbit. The azimuth is left
 * unclamped so a reader can drag all the way around the tower; the model is a
 * partial external capture, so some angles reveal uncaptured background.
 */
export const CAPTURED_EXTERIOR_LIMITS = {
  minPolarAngle: 0.7,
  maxPolarAngle: 1.78,
  minDistanceRatio: 0.52,
  maxDistanceRatio: 1.95,
} as const

function normalizeQuaternion([x, y, z, w]: Quaternion): Quaternion {
  const magnitude = Math.hypot(x, y, z, w)
  if (!Number.isFinite(magnitude) || magnitude === 0) throw new Error("asset transform quaternion must be finite and non-zero")
  return [x / magnitude, y / magnitude, z / magnitude, w / magnitude]
}

function rotateVector([x, y, z]: Vec3, quaternion: Quaternion): Vec3 {
  const [qx, qy, qz, qw] = normalizeQuaternion(quaternion)
  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ]
}

function transformedBounds(bounds: Bounds, quaternion: Quaternion): Bounds {
  const points: Vec3[] = []
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) points.push(rotateVector([x, y, z], quaternion))
    }
  }
  return {
    min: [Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1])), Math.min(...points.map((point) => point[2]))],
    max: [Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1])), Math.max(...points.map((point) => point[2]))],
  }
}

export function applyAssetTransformAndFit(sourceBounds: Bounds, quaternion: Quaternion, targetHeight = 6) {
  const finalBounds = transformedBounds(sourceBounds, quaternion)
  const sourceHeight = finalBounds.max[1] - finalBounds.min[1]
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0 || targetHeight <= 0) throw new Error("splat bounds must have positive height")
  const scale = targetHeight / sourceHeight
  const cleanZero = (value: number) => Object.is(value, -0) ? 0 : value
  const position: Vec3 = [
    cleanZero(-((finalBounds.min[0] + finalBounds.max[0]) / 2) * scale),
    cleanZero(-finalBounds.min[1] * scale),
    cleanZero(-((finalBounds.min[2] + finalBounds.max[2]) / 2) * scale),
  ]
  return { transformedBounds: finalBounds, scale, position, fittedHeight: targetHeight }
}

type SplatTransformTarget = {
  quaternion: { set: (x: number, y: number, z: number, w: number) => unknown }
  scale: { setScalar: (scale: number) => unknown }
  position: { set: (x: number, y: number, z: number) => unknown }
  updateMatrixWorld: (force: boolean) => unknown
}

/**
 * Applies the prepared, hash-bound measurement rather than transient runtime bounds.
 * SparkJS can temporarily expose an empty source while it constructs direct-PLY LoD.
 */
export function fitSplatFromManifest(
  splat: SplatTransformTarget,
  manifest: Pick<SplatAssetManifest, "sourceBounds" | "assetTransform">,
) {
  const fit = applyAssetTransformAndFit(
    manifest.sourceBounds,
    manifest.assetTransform.sourceToSceneQuaternion,
  )
  splat.quaternion.set(...manifest.assetTransform.sourceToSceneQuaternion)
  splat.scale.setScalar(fit.scale)
  splat.position.set(...fit.position)
  splat.updateMatrixWorld(true)
  return fit
}

/**
 * Derives the single fitted-height opening camera pose from the ratio pair, so
 * the reader always begins at the reference river-bank view before they orbit.
 */
export function deriveInitialPose(fittedHeight: number, center: Vec3 = [0, 0, 0]): CameraPose {
  const target = INITIAL_SCENE_RATIOS.target.map((value, axis) => center[axis] + value * fittedHeight) as Vec3
  const position = INITIAL_SCENE_RATIOS.position.map((value, axis) => center[axis] + value * fittedHeight) as Vec3
  return { position, target }
}
