type GuidePortraitProps = {
  className?: string
  /** The surrounding control already names the guide; then the figure is pure ornament. */
  decorative?: boolean
  /** Which backdrop it stands on — the dark scene and the folded rail, or the light page. */
  ground?: "dark" | "light"
}

/**
 * The guide's ink-wash figure. It stands beside the folio on the scene home and travels with the
 * reader on every other page, folded into the dock's rail or opened beside the conversation.
 * The drawing is the same either way; only the tinting changes with the ground behind it.
 */
export function GuidePortrait({
  className,
  decorative = false,
  ground = "dark",
}: GuidePortraitProps) {
  const classes = [
    "guide-portrait",
    ground === "light" ? "guide-portrait--ink" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <svg
      className={classes}
      viewBox="0 0 128 176"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "浮玉客水墨剪影"}
      aria-hidden={decorative || undefined}
    >
      <path className="guide-portrait__wash" d="M19 157c17-22 15-48 31-62 8-7 18-8 27-3 17 10 18 41 36 65-22 11-73 11-94 0Z" />
      <path className="guide-portrait__robe" d="M38 157c7-22 9-45 24-55l8-2c17 9 18 33 28 57M46 123c13 7 31 6 43-2M57 105c-2 15 0 36 7 52" />
      <path className="guide-portrait__head" d="M50 70c0-16 9-28 22-28 12 0 21 11 21 27 0 17-8 30-21 30-12 0-22-13-22-29Z" />
      <path className="guide-portrait__hair" d="M49 65c4-27 36-36 45-8 3 10-3 18-4 26-4-7-7-15-7-25-8 8-17 12-34 7Z" />
      <path className="guide-portrait__hat" d="M49 43c7-6 14-9 22-9 8 0 16 3 23 9M58 34c0-9 5-15 13-15 7 0 12 6 12 15M71 19V7" />
      <path className="guide-portrait__face" d="M61 70h3m14 0h3M66 84c5 2 9 2 14 0" />
      <path className="guide-portrait__fan" d="M19 139c17-9 31-9 45 1l-4 17c-15-7-28-7-41 0v-18Zm2 1 38 15" />
      <circle className="guide-portrait__seal" cx="106" cy="31" r="10" />
      <path className="guide-portrait__seal-mark" d="m101 27 5 8 5-8m-10 8h10" />
    </svg>
  )
}
