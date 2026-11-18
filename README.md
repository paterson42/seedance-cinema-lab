# Seedance Seoul Commerce Lab — 체험 부스 웹 서비스

Seedance Seoul 행사 체험 부스를 위한 모바일 우선 체험 사이트의 **이커머스/광고 버전**입니다.
Cinema Lab(`main` 브랜치)과 같은 흐름/같은 서버 구조를 쓰고, 컨셉만 "영화 포스터/트레일러"에서 "브랜드 광고 키비주얼/숏폼 광고 영상"으로 바꿨습니다.

**QR 진입 → 전화번호 입력 → 광고 무드 선택 → 육하원칙 키워드 뽑기 → Seed 광고 카피/프롬프트 → Seedream 키비주얼(9:16) → Seedance 숏폼 광고 영상(비동기) → 결과 링크(카카오톡 ‘나와의 채팅’ 저장) / 재접속 조회 / 공유**

### Cinema Lab → Commerce Lab 대응표

흐름과 API/DB 스키마는 그대로 두고 화면 문구/콘텐츠/프롬프트/합성 레이아웃만 바꿨습니다. 그래서 코드 안의 이름은 원래 이름을 유지합니다.

| 코드/DB 이름 | Cinema Lab | Commerce Lab |
|---|---|---|
| `genre` | 영화 장르 8종 | 광고 무드 8종 (럭셔리, 빅세일, 숏폼, 미니멀, 라이프스타일, 뉴트로, 프레시, 블록버스터) |
| `categories` (who/when/where/what/how/why) | 누가/언제/어디서/무엇을/어떻게/왜 | 타깃 고객, 시즌/모먼트, 촬영 장소, **상품**, 연출 방식, 구매 포인트(USP) |
| `director` | 감독 이름 | 방문객 이름 — 키비주얼 상단 크레딧 `기획: ○○○`, 영상 스크린의 `@○○○` |
| `story.title` / `tagline` / `logline` / `synopsis` | 제목 / 태그라인 / 로그라인 / 시놉시스 | 상품명 / 헤드라인 카피 / 캠페인 컨셉 / 상세페이지 카피 |
| `poster` | 영화 포스터 | 광고 키비주얼 9:16 (상단 `기획: ○○○`, 헤드라인, 상품명, 가격, 특가 스티커, 구매 버튼, `광고 ID`, `Sponsored by BytePlus` 합성, 키워드는 넣지 않음) |
| `video` / `trailer` | 트레일러 | 숏폼 광고 영상 |
| ticket (결과 탭) | 영화 티켓 | 상품 카드 (가격, 할인율, 무드, 광고 ID) |
| seed | SEED NO. (main 에서는 숨김) | `광고 ID` 로 표시 |
| 단계 전환 | 클래퍼보드 | 배송 조회 카드 (주문 접수 → … → 배송 완료, `주문 완료!` 도장) |
| `/screen/poster` | 포스터 스크린 | 키비주얼 스크린 (‘신상 출시’ 간판, 가격표) |
| `/screen/trailer` | 예고편 스크린 | 숏폼 피드형 광고 영상 스크린 (오른쪽 액션 레일, 떠오르는 하트, `@이름` 캡션, 위로 넘기는 전환) |

> 화면 문구는 가능한 한 한국어로 씁니다(제품명 Seed, Seedream, Seedance, `Sponsored by BytePlus` 제외). 키비주얼 하단의 스폰서 문구는 `config/content.json` 의 `event.sponsor` 에서 바꿉니다(상단에는 `기획` 한 줄만 들어갑니다).
>
> 영상 스크린 왼쪽 위 로고 자리는 `public/brand/tiktok-logo.svg`(또는 `.png`) 파일이 있으면 표시됩니다. 공식 로고 파일을 넣어 주세요(`public/brand/README.md`).
>
> 가격/할인율은 광고 ID(seed)에서 계산한 **가상의 숫자**입니다(`offer()` — `public/app.js`, `public/screen/screen.js`). 상품도 모두 가상이며, 프롬프트는 실제 브랜드/로고/가격표가 이미지에 들어가지 않도록 지시합니다.

- 외부 패키지 없음 (Node.js 22.13+ 내장 `node:sqlite`, `fetch`만 사용) → `npm install` 불필요
- 완성된 광고 영상에는 키비주얼의 글자(기획자 이름, 상품명, 가격, 버튼)가 ffmpeg로 얹힙니다. 부스 피드 스크린은 자체 UI가 있어 글자 없는 원본을 재생합니다. ffmpeg가 없거나 `VIDEO_OVERLAY=0`이면 글자 없는 영상 그대로 나갑니다
- `ARK_API_KEY`가 없으면 **데모(MOCK) 모드**로 전체 흐름이 그대로 돌아갑니다 (ffmpeg가 있으면 데모 키비주얼/영상도 실제 파일로 생성)

---

## 1. 빠른 시작

```bash
cp .env.example .env      # 필요 시 값 채우기 (비워두면 데모 모드)
npm start                 # http://localhost:3000
```

| 주소 | 용도 |
|---|---|
| `/` | 체험 사이트 (QR 코드가 가리킬 주소) |
| `/?booth=1` | 부스 태블릿 모드 — 완료 화면에서 "다음 셀러", 2분 무조작 시 자동 초기화 (`?booth=0`으로 해제) |
| `/r/<token>` | 결과 페이지 (카카오톡 링크 / 공유 링크, 기본 14일 유효) |
| `/admin` | 운영자 대시보드 — 부팅 로그에 출력되는 토큰 또는 `.env`의 `ADMIN_TOKEN` |
| `/screen/poster` | 부스 왼쪽 세로 스크린 ① 키비주얼 (9:16 전체 화면으로 한 장씩 + 새 광고 신상 출시 소개 + QR 안내) |
| `/screen/trailer` | 부스 오른쪽 세로 스크린 ② 광고 영상 (광고 영상 안내 카드, 9:16 광고 영상, 엔드 카드) |

## 2. 실제 API 연결 (LIVE 모드)

`.env`에 BytePlus ModelArk 키를 넣으면 LIVE 모드로 전환됩니다.

```
ARK_API_KEY=xxxxxxxx
ARK_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3
SEED_LLM_MODEL=seed-1-6-250615          # 상품명/카피/프롬프트 작성 (실패 시 템플릿으로 자동 대체)
SEEDREAM_MODEL=seedream-4-0-250828      # 키비주얼
SEEDANCE_MODEL=seedance-1-0-pro-250528  # 광고 영상 (image-to-video)
```

> 모델 ID/해상도/길이는 모두 환경변수로 뺐습니다. 계정에서 활성화된 모델 ID(또는 Endpoint ID)로 바꿔 쓰세요.
> - Seedream이 `seed` 파라미터를 거부하면 `SEEDREAM_SEND_SEED=0`
> - 광고 영상 길이는 "8초 내외"에 맞춰 모델이 지원하는 값으로 (`SEEDANCE_DURATION`, 기본 10)

| 연동 | 호출 | 구현 위치 |
|---|---|---|
| Seed LLM | `POST /chat/completions` (JSON 출력) | `server/providers/ark.js` `chatJSON` |
| Seedream | `POST /images/generations` (`size` 9:16, 1080x1920, `response_format=b64_json`, `seed`) | `generateImage` |
| Seedance | `POST /contents/generations/tasks` (9:16 키비주얼 원본 이미지 + 프롬프트 → 영상도 9:16) → `GET /contents/generations/tasks/{id}` 폴링 | `submitVideo` / `getVideoTask` |
| 카카오톡 | 알림톡 대행사/사내 발송 서버로 webhook POST | `server/providers/kakao.js` |

생성된 이미지/영상은 provider URL이 만료되기 전에 서버 `data/media/`로 내려받아 같은 출처로 서빙합니다 (재접속/카톡 링크/다운로드가 계속 동작하도록).

## 3. 카카오톡 결과 전달

알림톡은 **채널 개설 + 템플릿 심사 + 발신 프로필**이 먼저 필요합니다. 그래서 발송 자체는 어댑터로 분리했습니다.

- `KAKAO_PROVIDER=off` (기본): 알림톡을 보내지 않습니다. 대신 광고 영상 대기/결과 화면의 **"카카오톡 ‘나와의 채팅’에 저장"** 버튼으로 방문객이 직접 결과 링크를 자기 카카오톡에 저장합니다 (휴대폰 공유 시트, `KAKAO_JS_KEY` 가 있으면 카카오 SDK). 휴대폰 번호는 결과 재조회용으로만 쓰입니다.
- `KAKAO_PROVIDER=mock`: 실제 발송 없이 `/admin` 의 "카카오톡 발송 기록"에 메시지 전문과 링크가 남습니다.
- `KAKAO_PROVIDER=webhook`: 광고 영상이 완성되면 `KAKAO_WEBHOOK_URL`로 아래 JSON을 POST 합니다. 대행사(NHN Cloud, Solapi 등) API 형식에 맞춰 얇은 중계만 붙이면 됩니다.

```json
{
  "to": "01012345678",
  "template_code": "SCM_AD_READY",
  "variables": { "brand": "길동상회", "director": "길동상회", "title": "메종 세럼", "link": "https://.../r/abc" },
  "text": "[Seedance Commerce Lab]\n길동상회 브랜드의 신상품 <메종 세럼> 광고 영상이 완성되었습니다! ...",
  "buttons": [{ "type": "WL", "name": "내 광고 보러가기", "url_mobile": "https://.../r/abc", "url_pc": "https://.../r/abc" }]
}
```

- 미연동 구간 대체 수단: 결과 화면의 **결과 요약 복사**, **결과 링크 복사**, Web Share(모바일에서 카카오톡 선택 가능)
- `KAKAO_JS_KEY`를 넣으면 결과 화면에 **카카오톡으로 공유하기**(Kakao SDK) 버튼이 추가됩니다.

## 3-1. 현장 대형 스크린

- 키비주얼, 광고 영상은 완성되면 **자동으로** 부스 스크린에 걸립니다 (방문객이 고르지 않음). 키비주얼은 휴대폰이 카피를 얹은 버전을 올리는 순간 걸리고, 그 업로드가 20초 안에 오지 않으면 원본 키비주얼로 걸립니다. 휴대폰에는 상태(곧 자동으로 걸려요 / 송출 중)만 보여요
- 대형 스크린 PC에서 `/screen/poster`, `/screen/trailer` 를 열고 화면 클릭(또는 F 키) → 전체 화면. 두 화면 모두 세로 9:16 기준(가로 모니터에서는 가운데 세로로 표시), QR 안내 화살표는 `?qr=left|right` 로 바꿀 수 있어요. 6초마다 새 제출을 가져오고, 새 광고가 먼저 소개/송출됩니다
- 노출 관리: `/admin` 의 "대형 스크린"에서 광고별 숨기기/다시 송출 (숨기면 송출 중이던 것도 즉시 내려감)
- `SCREEN_AUTO_APPROVE=0` 이면 운영자가 승인해야 송출, `SCREEN_KEY=xxx` 를 지정하면 스크린 주소에 `?key=xxx` 필요
- 키비주얼을 다시 만들거나 영상을 다시 생성하면 이전 것은 내려가고, 새로 완성된 것이 자동으로 다시 걸립니다
- **사전 등록 명단**: `/admin` 의 "사전 등록 명단"에서 번호를 붙여넣기/CSV/TXT 파일로 올리고 "명단 제한"을 켜면, 명단에 있는 번호만 입장/생성할 수 있어요 (번호 원문은 저장하지 않고 해시와 가린 번호만 저장). 엑셀에서 앞자리 0이 빠진 번호, +82 형식도 인식합니다
- **1인 체험 횟수**: 번호당 2회 (`PHONE_MAX_FLOWS`). 키비주얼을 만든 체험 1회 = 1회로 세고, 같은 체험 안에서 다시 만들기/실패는 세지 않아요. 명단 제한을 꺼도 적용되고, `/admin` 에서 번호별로 +1회를 줄 수 있어요
- **테스트 번호** `TEST_PHONES` (기본 `00000000000`): 명단/체험 횟수/하루 한도/체험당 한도 없이 생성할 수 있어요. 번호는 서버 설정에만 있고 페이지 코드에는 들어가지 않아요
- 개인정보는 체험 결과 재조회용으로만 받고, 마케팅 수신 동의는 받지 않아요
- 휴대폰 번호당 하루(서울 시간) 한도: 광고 영상 3편, 키비주얼 10장, 광고 카피 30회 (`PHONE_DAILY_*`). "처음부터 다시"로 새로 시작해도 합산되고, 실패한 생성은 세지 않습니다
- 한 방문객은 한 번에 하나만 생성합니다. 키비주얼/광고 영상을 만드는 중에 같은 버튼을 다시 누르면 진행 중인 작업을 그대로 보여 주고, 광고 무드/광고 카피/키비주얼 재생성 등 다른 요청은 `409 BUSY` 로 막혀 대기 화면으로 돌아갑니다 (뒤로 가기도 대기 화면으로)

## 4. 동시 접속/네트워크 대응

- **생성 큐**: DB 기반 디스패처. 키비주얼 동시 생성 `POSTER_CONCURRENCY`(기본 6), Seedance 동시 작업 `VIDEO_MAX_INFLIGHT`(기본 10). 대기 순번을 화면에 표시
- **재시도**: 429/5xx는 지수 백오프로 자동 재시도, 클라이언트도 네트워크 오류 시 자동 재시도 + 상단 "연결 불안정" 배너
- **자리 이탈 허용**: 영상 작업은 서버가 task id로 폴링 → 완료 시 카카오톡 발송. 서버가 재시작돼도 대기/진행 중 작업을 이어서 처리
- **재접속**: 같은 브라우저는 쿠키로 진행 단계 자동 복원. 다른 기기는 "내 결과 다시 보기"(전화번호 + 브랜드 이름)
- **비용 제한**: 세션당 키비주얼 `POSTER_MAX_PER_SESSION`(3), 영상 `VIDEO_MAX_PER_SESSION`(2). 실패한 생성은 횟수에 포함하지 않음

## 5. 개인정보/안전

- 전화번호는 AES-256-GCM 암호화 저장 + 조회용 HMAC 해시만 보관, 화면/대시보드에는 마스킹(`010-****-5678`)
- 필수 동의(수집 및 이용) / 선택 동의(마케팅) 분리, 동의 시각 저장
- `RETENTION_DAYS`(30) 지난 세션의 전화번호 자동 파기, 결과 링크는 `RESULT_TTL_DAYS`(14) 후 만료
- 결과 링크는 추측 불가능한 토큰, 미디어 파일명도 랜덤
- 키워드는 운영자 정의 풀에서만 선택(자유 입력 없음), 브랜드 이름은 금칙어 필터(`config/content.json` 의 `bannedWords`) + 길이 제한. 모델 안전 정책 위반 시 사용자 친화 메시지 + 재시도
- 운영 시 반드시 `APP_SECRET`, `ADMIN_TOKEN` 고정값 지정 (비우면 `data/`에 자동 생성)

## 6. 콘텐츠 관리

광고 무드 8종(`genres`), 육하원칙 6 카테고리 × 10 키워드, 안내 문구는 `config/content.json` 에 있습니다. `/admin` 하단 편집기에서 바로 수정/저장할 수 있고(유효성 검사 + `.bak` 백업), 서버 재시작 없이 반영됩니다.

- 광고 무드(`genres`): 키비주얼 스타일(`style`), 광고 영상 카메라 워크(`motion`), 상품명 패턴(`titles`, `{n}` 자리에 상품 명사), 헤드라인 카피(`taglines`), 상세페이지 카피 마무리 문장(`tail`), 무드 카드 그림은 `public/genres/<id>.svg`
- 키워드: 화면용 한국어(`ko`) + 프롬프트용 영어(`en`), "무엇을"(상품) 키워드는 상품명용 명사(`n`) 필수. 템플릿 문장이 자연스럽도록 `who`/`what`/`why`는 명사구, `where`는 "~에서", `how`는 "~로/~처럼" 형태로 써 주세요

## 7. 이벤트 로깅

단계별 이벤트(`session_start` → `phone_ok` → `genre_selected` → `story_built` → `poster_requested/done` → `video_requested/done` → `kakao_sent` → `result_viewed`)와 저장/공유/복사 행동을 `events` 테이블에 기록합니다. `/admin` 에서 퍼널, 평균 생성 시간, 실패 내역, 최근 체험 목록(리드), 카카오톡 발송 기록을 볼 수 있습니다.

## 8. 구조

```
server/
  index.js            HTTP 서버, API 라우트, 정적/미디어(Range 지원) 서빙
  config.js           .env 로딩, 설정값
  db.js               SQLite 스키마 (sessions / events / kakao_outbox)
  jobs.js             키비주얼/영상 생성 큐, Seedance 폴링, 보관기간 정리
  story.js            Seed LLM 광고 카피 + 템플릿 폴백, 이미지/영상 프롬프트 조립
  privacy.js          전화번호 정규화/암호화/해시
  content.js          content.json 로딩/검증
  providers/ark.js    Seed, Seedream, Seedance 어댑터 (+ 데모 모드)
  providers/kakao.js  카카오톡 알림 어댑터 (mock / webhook)
public/
  index.html, styles.css, app.js   체험 SPA (키비주얼의 브랜드/카피/가격/CTA 오버레이는 canvas로 합성)
  admin.html                       운영자 대시보드
config/content.json   광고 무드, 키워드 풀, 안내 문구
data/                 app.db, media/ (런타임 생성, git 제외)
```

### API 요약

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/bootstrap` | 콘텐츠, 모드, 현재 세션 |
| POST | `/api/session` | 새 체험 세션 (`keepPhone`: 재체험 시 번호 유지) |
| POST | `/api/session/phone` | 번호 검증/암호화/동의 저장 |
| POST | `/api/session/genre` | 광고 무드 저장 |
| POST | `/api/story` | 키워드 + 방문객 이름(`director`) → 광고 ID(seed) 발급, 광고 카피/프롬프트 생성 |
| POST | `/api/poster` | 키비주얼 생성 큐 등록 |
| POST | `/api/poster/final` | 텍스트 합성된 최종 키비주얼 업로드 (결과 링크/OG 이미지용) |
| POST | `/api/video` | 광고 영상 생성 큐 등록 |
| GET | `/api/session` | 진행 상태 폴링 |
| GET | `/api/result/:token` | 결과 페이지 데이터 |
| POST | `/api/lookup` | 번호 + 브랜드 이름으로 결과 조회 |
| POST | `/api/event` | 클라이언트 이벤트 로깅 |
| POST | `/api/screen/submit` | (예전 수동 제출용, 지금은 자동 송출) 키비주얼/광고 영상 대형 스크린 제출 (`kind`, 쿠키 또는 `token`) |
| GET | `/api/screen/feed?kind=poster\|trailer` | 대형 스크린용 송출 목록 |

## 9. 행사 운영 체크리스트

1. HTTPS 도메인으로 배포하고 `PUBLIC_BASE_URL` 지정 → 이 주소로 QR 코드 제작 (카카오톡 링크/OG 미리보기도 이 주소 사용)
2. 단일 프로세스 + `data/` 디렉터리 영속 볼륨. 리버스 프록시(nginx 등) 뒤에 둘 경우 `X-Forwarded-For` 전달, 업로드 본문 8MB 이상 허용
3. 행사 전 `ARK_API_KEY`로 모델 ID/쿼터 확인 → `/admin`에서 평균 생성 시간 확인 후 `POSTER_CONCURRENCY`, `VIDEO_MAX_INFLIGHT`를 계정 Rate limit에 맞게 조정
4. 카카오 알림톡 채널/템플릿 심사 완료 후 `KAKAO_PROVIDER=webhook`
5. 부스 태블릿은 `/?booth=1` 로 한 번 접속해 두기
6. 대형 스크린 PC 2대에서 `/screen/poster`, `/screen/trailer` 전체 화면 (절전 모드 해제)
7. Cinema Lab 데모와 같은 호스트에서 함께 돌릴 때는 포트만 다르게 주면 됩니다 (`PORT=3001`). 세션 쿠키 이름이 달라(`scm_sid`) 브라우저 세션이 섞이지 않고, 체크아웃 폴더가 다르면 `data/`(DB/미디어)도 따로 쌓입니다
