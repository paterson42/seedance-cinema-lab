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

`byteplus-icon-white.png`, `byteplus-icon-black.png`은 제공받은 공식 파일입니다. 키비주얼 하단 스폰서 문구는 이제 아이콘 없이 글자만 들어가므로, 두 파일 모두 보관만 하고 있습니다.

## 카카오톡 로고

`kakaotalk-logo.svg`는 Wikimedia Commons의 `File:KakaoTalk_logo.svg` 원본 그대로입니다 (Kakao Corp., 퍼블릭 도메인 표기, 상표권은 별도). 색이나 모양을 바꾸지 않고 사용합니다.
