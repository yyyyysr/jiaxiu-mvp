import type { ResearchStatus as ResearchStatusContract } from "../../lib/types"

const labels: Record<string, string> = {
  complete: "全文",
  fragment: "残篇或节录",
  confirmed: "已确认",
  attributed: "传为此作",
  disputed: "归属存疑",
  unverified: "尚待核验",
  candidate: "关联推荐",
  strict_jiaxiu: "直接题咏",
  site_origin: "旧址关联",
  nearby_prebuild: "同址前史",
  adjacent_complex: "毗邻景观",
}

type ResearchStatusProps = {
  status: ResearchStatusContract
  expanded?: boolean
}

export function ResearchStatus({ status, expanded = false }: ResearchStatusProps) {
  const alerts = [status.completeness, status.authenticity_status]
    .filter((value) => value in labels)
    .map((value) => labels[value])

  return (
    <div className="research-status" aria-label="研究状态">
      {alerts.map((label) => (
        <span className="research-status__alert" key={label}>{label}</span>
      ))}
      {expanded && (
        <dl className="research-status__details">
          <div><dt>收录范围</dt><dd>{labels[status.relation_scope] ?? status.relation_scope}</dd></div>
          <div><dt>真实性</dt><dd>{labels[status.authenticity_status] ?? status.authenticity_status}</dd></div>
          <div><dt>文本完整度</dt><dd>{labels[status.completeness] ?? status.completeness}</dd></div>
          <div><dt>文本校录</dt><dd>{status.transcription_status}</dd></div>
          <div><dt>年代判断</dt><dd>{status.date_certainty}</dd></div>
        </dl>
      )}
    </div>
  )
}
