import type { CSSProperties } from "react"

import type { SeasonId } from "./types"

type SeasonAtmosphereProps = {
  season: SeasonId
  reducedMotion: boolean
}

type AtmosphereConfig = {
  asset: string
  count: number
  label: string
  kind: "rain" | "sun" | "leaf" | "snow"
}

type AtmosphereStyle = CSSProperties & Record<`--${string}`, string>

const ASSET_ROOT = `${import.meta.env.BASE_URL}assets/seasonal`

const ATMOSPHERES: Record<SeasonId, AtmosphereConfig> = {
  spring: { asset: "season-rain.png", count: 52, label: "春季氛围：新绿春雨", kind: "rain" },
  summer: { asset: "season-sun-glow.png", count: 1, label: "夏季氛围：艳阳高照", kind: "sun" },
  autumn: { asset: "season-maple-leaf.png", count: 22, label: "秋季氛围：枫叶飘落", kind: "leaf" },
  winter: { asset: "season-snowflake.png", count: 30, label: "冬季氛围：雪花飘落", kind: "snow" },
}

function atmosphereStyle(index: number, kind: AtmosphereConfig["kind"]): AtmosphereStyle {
  const spread = (index * 37 + 11) % 103
  const depth = (index * 19 + 7) % 11
  const duration = kind === "rain" ? 1.1 + depth * .055 : kind === "leaf" ? 7.2 + depth * .42 : 8.8 + depth * .5
  const size = kind === "rain" ? 25 + depth * 2.1 : kind === "leaf" ? 58 + depth * 5.2 : 42 + depth * 3.8
  const drift = kind === "rain" ? 8 + depth * .7 : (index % 2 === 0 ? 1 : -1) * (38 + depth * 5)

  return {
    "--season-x": `${spread}%`,
    "--season-y": `${8 + (index * 29 + depth * 5) % 78}%`,
    "--season-delay": `${-(index * .73 % duration)}s`,
    "--season-duration": `${duration}s`,
    "--season-size": `${size}px`,
    "--season-drift": `${drift}px`,
    "--season-drift-start": `${drift * -.35}px`,
    "--season-drift-mid": `${drift * .45}px`,
    "--season-turn": kind === "rain" ? "8deg" : `${(index * 47 + depth * 13) % 360}deg`,
    "--season-opacity": `${.56 + depth * .035}`,
  }
}

export function SeasonAtmosphere({ season, reducedMotion }: SeasonAtmosphereProps) {
  const atmosphere = ATMOSPHERES[season]
  const assetUrl = `${ASSET_ROOT}/${atmosphere.asset}`

  return (
    <figure
      className={`season-atmosphere season-atmosphere--${atmosphere.kind}${reducedMotion ? " is-reduced-motion" : ""}`}
      aria-label={atmosphere.label}
      role="img"
    >
      <span className="season-atmosphere__tone" aria-hidden="true" />
      {atmosphere.kind === "sun" && <span className="season-atmosphere__sunbeams" aria-hidden="true" />}
      <span className="season-atmosphere__elements" aria-hidden="true">
        {Array.from({ length: atmosphere.count }, (_, index) => (
          <img
            alt=""
            className="season-atmosphere__element"
            decoding="async"
            draggable={false}
            key={index}
            src={assetUrl}
            style={atmosphere.kind === "sun" ? undefined : atmosphereStyle(index, atmosphere.kind)}
          />
        ))}
      </span>
    </figure>
  )
}
