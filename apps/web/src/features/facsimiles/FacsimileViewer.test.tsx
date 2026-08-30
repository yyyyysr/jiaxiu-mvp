import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { Facsimile } from "../../lib/types"
import { FacsimileViewer } from "./FacsimileViewer"

const items: Facsimile[] = [
  {
    image_id: "image-1", source_id: "source-1", public_url: "/api/v1/media/one.png",
    scan_page: 13, print_page: "71", image_role: "preview", file_format: "png",
    pixel_width: 1000, pixel_height: 1600, file_bytes: 100, sha256: "a", capture_method: "scan",
    quality_note: "clear", notes: "source", sequence: 1, locator: "", association_notes: "", listed: true, deployed: true,
  },
  {
    image_id: "image-2", source_id: "source-2", public_url: "/api/v1/media/two.png",
    scan_page: 14, print_page: "72", image_role: "preview", file_format: "png",
    pixel_width: 1000, pixel_height: 1600, file_bytes: 100, sha256: "b", capture_method: "scan",
    quality_note: "clear", notes: "source", sequence: 2, locator: "", association_notes: "", listed: true, deployed: true,
  },
]

it("hides page and high-resolution labels while retaining thumbnail order", async () => {
  const user = userEvent.setup()
  render(<FacsimileViewer items={items} workTitle="甲秀楼题咏" />)

  expect(screen.getAllByRole("heading", { name: "甲秀楼题咏" })).toHaveLength(2)
  expect(screen.queryByText(/扫描页|印刷页|高清影像|影像 1/)).not.toBeInTheDocument()

  await user.click(screen.getAllByRole("button", { name: "查看影像" })[0])

  expect(screen.getByText("01")).toBeInTheDocument()
  expect(screen.getByText("02")).toBeInTheDocument()
})
