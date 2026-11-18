# Brand assets for the booth video screen

`/screen/trailer` shows the finished ads inside the For You feed, following the TikTok Product
Marketing Style Guide ("The For You Feed"):

- **Minimum UI** — the mode the guide lists for out-of-home and immersive content: top bar, sidebar,
  name and caption. No device frame, no notch, no system UI, no bottom navigation.
- **"For You" (추천)** is the selected tab.
- The UI is **not stylised or recoloured**, and nothing covers its icons or text.
- Our own message (the QR call to action) sits below the feed as a headline, outside the UI.

The guide also says not to redraw or restyle the UI, so the real icons and typeface are not in this
repository. Export them from the official kit (Brand portal → Downloads → "Static Layouts for External
Partners" / Design Libraries / TikTok Sans) and drop them into `public/brand/tiktok-ui/`. Each file is
picked up automatically on reload; until then a neutral placeholder icon is shown in its place.

| File (`.svg` preferred, `.png` also works) | Where it appears |
|---|---|
| `top-live` | top bar, left (LIVE) |
| `top-search` | top bar, right (search) |
| `like` | sidebar heart (white version) |
| `comment` | sidebar comment |
| `save` | sidebar bookmark |
| `share` | sidebar share |
| `TikTokSans-Regular.woff2`, `TikTokSans-Bold.woff2` | UI typeface (falls back to Noto Sans KR) |

Export icons in white on a transparent background, square, at least 96 px.

If the brand team prefers the Moderate UI (complete UI including the bottom navigation), say so:
the layout needs the bottom-navigation assets as well, and the QR call to action moves out of the frame.
