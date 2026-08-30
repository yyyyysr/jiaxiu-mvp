export type SceneMode = "3d" | "2d"
export type SceneCapabilityReason = "webgl2-unavailable" | "data-saver" | "low-memory"

export type SceneCapabilityHints = {
  webgl2: boolean
  saveData: boolean
  deviceMemory?: number
}

export type SceneCapability = { mode: "3d" } | { mode: "2d"; reason: SceneCapabilityReason }

export function chooseInitialSceneMode(hints: SceneCapabilityHints): SceneCapability {
  if (!hints.webgl2) return { mode: "2d", reason: "webgl2-unavailable" }
  if (hints.saveData) return { mode: "2d", reason: "data-saver" }
  if (hints.deviceMemory !== undefined && hints.deviceMemory <= 2) return { mode: "2d", reason: "low-memory" }
  return { mode: "3d" }
}

type NavigatorWithCapabilityHints = Navigator & {
  deviceMemory?: number
  connection?: { saveData?: boolean }
}

export function detectSceneCapability(
  documentTarget: Document = document,
  navigatorTarget: NavigatorWithCapabilityHints = navigator,
): SceneCapability {
  let webgl2 = false
  try {
    const canvas = documentTarget.createElement("canvas")
    const context = canvas.getContext("webgl2", {
      antialias: false,
      failIfMajorPerformanceCaveat: true,
      powerPreference: "high-performance",
    })
    webgl2 = context !== null
    context?.getExtension("WEBGL_lose_context")?.loseContext()
  } catch {
    webgl2 = false
  }
  return chooseInitialSceneMode({
    webgl2,
    saveData: navigatorTarget.connection?.saveData === true,
    deviceMemory: navigatorTarget.deviceMemory,
  })
}
