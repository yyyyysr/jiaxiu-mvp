import { Link } from "react-router-dom"

export function NotFoundPage() {
  return (
    <main className="page-shell app-error not-found-page" id="main-content" tabIndex={-1}>
      <p className="kicker">ARCHIVE MARGIN · 404</p>
      <div role="alert">
        <h1>未找到这页档案</h1>
        <p>这条路径不在当前读本中。您可以返回实景首页，或继续查阅已著录的甲秀楼题咏。</p>
      </div>
      <nav aria-label="未找到页面导航">
        <Link to="/">返回浮玉四时</Link>
        <Link to="/works">浏览题咏志</Link>
      </nav>
    </main>
  )
}
