import { Link } from "react-router-dom"

export function FacsimileUpload({ workId }: { workId: string }) {
  return <Link className="facsimile-upload__trigger" to={`/contribute?work_id=${encodeURIComponent(workId)}`}>
    <span aria-hidden="true">＋</span> 登录后补充此篇扫描
  </Link>
}
