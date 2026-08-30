import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark"
import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"

import {
  CAPTURED_EXTERIOR_LIMITS,
  INITIAL_FIELD_OF_VIEW_DEGREES,
  deriveInitialPose,
  fitSplatFromManifest,
} from "./cameraRig"
import { getRenderProfile } from "./config"
import { getSplatAssetUrl } from "./splatManifest"
import { createThreeEnvironment } from "./threeEnvironment"
import type { QualityLevel, SceneController, SplatSceneOptions } from "./types"

function abortedError(): DOMException {
  return new DOMException("Splat scene initialization was aborted", "AbortError")
}

export async function createSplatScene(canvas: HTMLCanvasElement, options: SplatSceneOptions): Promise<SceneController> {
  if (options.signal?.aborted) throw abortedError()

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(INITIAL_FIELD_OF_VIEW_DEGREES, 1, 0.01, 100)
  const profile = getRenderProfile(canvas.clientWidth || window.innerWidth, window.devicePixelRatio)
  const initialQuality = options.quality ?? profile.quality
  renderer.setPixelRatio(profile.pixelRatio)
  const spark = new SparkRenderer({ renderer, enableLod: true, lodSplatCount: profile.lodSplatCount, sortRadial: true })
  scene.add(spark)

  let disposed = false
  let controls: OrbitControls | undefined
  let environment: ReturnType<typeof createThreeEnvironment> | undefined
  let splat: SplatMesh | undefined
  let resizeObserver: ResizeObserver | undefined
  let windowResize: (() => void) | undefined
  let activeQuality: QualityLevel = initialQuality
  let reducedMotion = options.reducedMotion

  const renderSize = () => {
    const width = Math.max(1, canvas.clientWidth || canvas.parentElement?.clientWidth || window.innerWidth)
    const height = Math.max(1, canvas.clientHeight || canvas.parentElement?.clientHeight || window.innerHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    renderer.setAnimationLoop(null)
    resizeObserver?.disconnect()
    if (windowResize) window.removeEventListener("resize", windowResize)
    options.signal?.removeEventListener("abort", dispose)
    controls?.dispose()
    environment?.dispose()
    if (splat) {
      scene.remove(splat)
      splat.dispose()
    }
    scene.remove(spark)
    spark.dispose()
    renderer.dispose()
  }
  options.signal?.addEventListener("abort", dispose, { once: true })

  try {
    const response = await fetch(getSplatAssetUrl(), {
      signal: options.signal,
      headers: { Accept: "application/octet-stream" },
    })
    if (!response.ok || !response.body) throw new Error(`PLY request failed with status ${response.status}`)
    if (disposed || options.signal?.aborted) throw abortedError()
    const lengthHeader = Number.parseInt(response.headers.get("Content-Length") ?? "", 10)
    const streamLength = Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : undefined

    splat = new SplatMesh({
      stream: response.body,
      streamLength,
      fileName: "jiaxiu-web.ply",
      lod: true,
      onProgress(event) {
        const progress = event.lengthComputable && event.total > 0 ? event.loaded / event.total : null
        options.onProgress?.(progress)
      },
    })
    scene.add(splat)
    await splat.initialized
    if (disposed || options.signal?.aborted) throw abortedError()

    const fit = fitSplatFromManifest(splat, options.manifest)
    const initial = deriveInitialPose(fit.fittedHeight)
    camera.position.set(...initial.position)
    controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = false
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE
    controls.touches.ONE = THREE.TOUCH.ROTATE
    controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE
    controls.target.set(...initial.target)
    controls.minPolarAngle = CAPTURED_EXTERIOR_LIMITS.minPolarAngle
    controls.maxPolarAngle = CAPTURED_EXTERIOR_LIMITS.maxPolarAngle
    controls.minDistance = CAPTURED_EXTERIOR_LIMITS.minDistanceRatio * fit.fittedHeight
    controls.maxDistance = CAPTURED_EXTERIOR_LIMITS.maxDistanceRatio * fit.fittedHeight
    controls.update()
    environment = createThreeEnvironment(scene, splat, options.reducedMotion, options.initialSeason)

    const setQuality = (quality: QualityLevel) => {
      activeQuality = quality
      spark.lodSplatCount = quality === "low" ? 300_000 : quality === "medium" ? 750_000 : 1_500_000
    }
    setQuality(activeQuality)

    const setReducedMotion = (next: boolean) => {
      if (disposed || next === reducedMotion) return
      reducedMotion = next
      environment?.setReducedMotion(next)
    }

    renderSize()
    const RuntimeResizeObserver = globalThis.ResizeObserver
    if (typeof RuntimeResizeObserver === "function") {
      resizeObserver = new RuntimeResizeObserver(renderSize)
      resizeObserver.observe(canvas)
    } else {
      windowResize = renderSize
      globalThis.addEventListener("resize", windowResize)
    }

    renderer.setAnimationLoop((time) => {
      if (disposed) return
      controls?.update()
      environment?.update(time)
      renderer.render(scene, camera)
    })

    const controller: SceneController = {
      setSeason(season) {
        environment?.setSeason(season)
      },
      setQuality,
      setReducedMotion,
      dispose,
    }
    options.onReady?.()
    return controller
  } catch (error) {
    dispose()
    throw error
  }
}
