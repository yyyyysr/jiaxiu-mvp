import { resolvePublicAssetUrl } from "./splatManifest"
import type { SeasonId } from "./types"

type SceneFallbackProps = { detail?: string; title?: string; season?: SeasonId }

const TWO_DIMENSIONAL_IMAGE = resolvePublicAssetUrl(
  import.meta.env.BASE_URL,
  "assets/splats/reference/2d_image.PNG",
)

const SEASON_LABEL: Record<SeasonId, string> = {
  spring: "春水新涨",
  summer: "夏树含风",
  autumn: "秋光入槛",
  winter: "冬水含烟",
}

export function SceneFallback({ detail, title = "实景泼溅暂不可用", season }: SceneFallbackProps) {
  return (
    <section className={`scene-fallback${season ? ` scene-fallback--${season}` : ""}`} aria-live="polite">
      <img
        className="scene-fallback__image"
        src={TWO_DIMENSIONAL_IMAGE}
        alt="甲秀楼二维影像"
        decoding="async"
      />
      <div className="scene-fallback__status">
        <p className="scene-fallback__eyebrow">TWO-DIMENSIONAL VIEW · 二维影像</p>
        <h2>{title}</h2>
        {season && <p className="scene-fallback__season-caption">{SEASON_LABEL[season]}</p>}
        <p>{detail ?? "当前显示二维影像；研究文本与季节控制仍可使用。"}</p>
      </div>
    </section>
  )
}
