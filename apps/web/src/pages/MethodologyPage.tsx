export function MethodologyPage() {
  return (
    <main className="method-page page-shell" id="main-content" tabIndex={-1}>
      <header className="page-intro"><div className="vertical-slip" aria-hidden="true">凡例</div><div><p className="kicker">METHODOLOGY · 研究边界</p><h1>让每一处判断<br />都有来路</h1></div></header>
      <div className="method-grid">
        <section><span>一</span><h2>收录范围</h2><p>“直接题咏”是默认公开范围；同址前史、旧址关联及毗邻景观仅在读者主动选择时出现，不以相关性代替作品归属。</p></section>
        <section><span>二</span><h2>文本与版本</h2><p>正文、作者、纪年与来源分别著录。残篇、节录、归属争议和未复核文本均以研究状态明示，不用界面修辞掩盖不确定性。</p></section>
        <section><span>三</span><h2>影像部署</h2><p>清单著录与实体文件部署是两个状态。尚未部署的影像保留页码、定位与关联说明，但不会伪造可访问链接。</p></section>
        <section><span>四</span><h2>四时关联</h2><p>季节推荐只采用题名、纪年或正文中的明确证据。候选关联与经复核的主要作品分开呈现。</p></section>
      </div>
    </main>
  )
}
