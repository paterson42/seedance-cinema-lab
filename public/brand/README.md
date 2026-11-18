# Brand assets for the booth video screen

`/screen/trailer` shows the finished ads inside the For You feed, following the TikTok Product
Marketing Style Guide ("The For You Feed"):

- **Minimum UI** — the mode the guide lists for out-of-home and immersive content: top bar, sidebar,
  name and caption. No device frame, no notch, no system UI, no bottom navigation.
- **"For You" (추천)** is the selected tab.
- The UI is **not stylised or recoloured**, and nothing covers its icons or text.
- The screen is only a player: there is no call to action or other message on top of the feed.

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
the layout then needs the bottom-navigation assets as well.

## BytePlus 마크

`byteplus-icon-white.png`, `byteplus-icon-black.png`은 제공받은 공식 파일입니다. 키비주얼 하단 스폰서 문구 앞에는 흰색 버전이 들어갑니다. 검정 버전은 밝은 배경용으로 보관만 하고 있습니다.
