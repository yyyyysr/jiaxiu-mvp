import type { SceneConfig } from "./types"
import type { SeasonId } from "./types"

type SceneControlsProps = {
  config: SceneConfig
  season: SeasonId
  onSeason: (season: SeasonId) => void
}

export function SceneControls({ config, season, onSeason }: SceneControlsProps) {
  return (
    <div className="scene-controls">
      <div className="scene-controls__group" role="group" aria-label="四时光景">
        <p>四时光景</p>
        <div className="scene-controls__buttons">
          {config.seasons.map((item) => (
            <button key={item.id} type="button" className={`scene-control-hit-target ${season === item.id ? "is-active" : ""}`} onClick={() => onSeason(item.id)} aria-pressed={season === item.id}>
              <b>{item.label}</b><span>{item.ambience.replace("_", " · ")}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
