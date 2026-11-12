# Seedance Seoul Cinema Lab — 체험 부스 웹 서비스

Seedance Seoul Cinema Lab 체험 부스를 위한 모바일 우선 체험 사이트입니다.

**QR 진입 → 전화번호 입력 → 장르 선택 → 육하원칙 키워드 뽑기 → Seed 스토리·프롬프트 → Seedream 포스터(2:3) → Seedance 트레일러(비동기) → 카카오톡 결과 알림 / 재접속 조회 / 공유**

- 외부 패키지 없음 (Node.js 22.13+ 내장 `node:sqlite`, `fetch`만 사용) → `npm install` 불필요
- `ARK_API_KEY`가 없으면 **데모(MOCK) 모드**로 전체 흐름이 그대로 돌아갑니다 (ffmpeg가 있으면 데모 포스터/영상도 실제 파일로 생성)

---

## 1. 빠른 시작

```bash
cp .env.example .env      # 필요 시 값 채우기 (비워두면 데모 모드)
npm start                 # http://localhost:3000
```

| 주소 | 용도 |
|---|---|
| `/` | 체험 사이트 (QR 코드가 가리킬 주소) |
| `/?booth=1` | 부스 태블릿 모드 — 완료 화면에서 "다음 관람객", 2분 무조작 시 자동 초기화 (`?booth=0`으로 해제) |
| `/r/<token>` | 결과 페이지 (카카오톡 링크 / 공유 링크, 기본 14일 유효) |
| `/admin` | 운영자 대시보드 — 부팅 로그에 출력되는 토큰 또는 `.env`의 `ADMIN_TOKEN` |
| `/screen/poster` | 현장 대형 스크린 ① 로비 포스터 월 (극장 라이트박스 + 새 작품 WORLD PREMIERE 소개) |
| `/screen/trailer` | 현장 대형 스크린 ② 예고편 상영관 (커튼 · 예고편 안내 카드 · 트레일러 · COMING SOON 엔드 카드) |

## 2. 실제 API 연결 (LIVE 모드)

`.env`에 BytePlus ModelArk 키를 넣으면 LIVE 모드로 전환됩니다.

```
ARK_API_KEY=xxxxxxxx
ARK_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3
SEED_LLM_MODEL=seed-1-6-250615          # 제목·로그라인·프롬프트 작성 (실패 시 템플릿으로 자동 대체)
SEEDREAM_MODEL=seedream-4-0-250828      # 포스터
SEEDANCE_MODEL=seedance-1-0-pro-250528  # 트레일러 (image-to-video)
```

> 모델 ID·해상도·길이는 모두 환경변수로 뺐습니다. 계정에서 활성화된 모델 ID(또는 Endpoint ID)로 바꿔 쓰세요.
> - Seedream이 `seed` 파라미터를 거부하면 `SEEDREAM_SEND_SEED=0`
> - 트레일러 길이는 PRD의 "8초 내외"에 맞춰 모델이 지원하는 값으로 (`SEEDANCE_DURATION`, 기본 10)

| 연동 | 호출 | 구현 위치 |
|---|---|---|
| Seed LLM | `POST /chat/completions` (JSON 출력) | `server/providers/ark.js` `chatJSON` |
| Seedream | `POST /images/generations` (`size` 2:3, `response_format=b64_json`, `seed`) | `generateImage` |
| Seedance | `POST /contents/generations/tasks` (포스터 원본 이미지 + 프롬프트) → `GET /contents/generations/tasks/{id}` 폴링 | `submitVideo` / `getVideoTask` |
| 카카오톡 | 알림톡 대행사/사내 발송 서버로 webhook POST | `server/providers/kakao.js` |

생성된 이미지/영상은 provider URL이 만료되기 전에 서버 `data/media/`로 내려받아 같은 출처로 서빙합니다 (재접속·카톡 링크·다운로드가 계속 동작하도록).

## 3. 카카오톡 결과 전달

PRD 4.6 메모처럼 알림톡은 **채널 개설 + 템플릿 심사 + 발신 프로필**이 먼저 필요합니다. 그래서 발송 자체는 어댑터로 분리했습니다.

- `KAKAO_PROVIDER=mock` (기본): 실제 발송 없이 `/admin` 의 "카카오톡 발송 기록"에 메시지 전문과 링크가 남습니다.
- `KAKAO_PROVIDER=webhook`: 트레일러가 완성되면 `KAKAO_WEBHOOK_URL`로 아래 JSON을 POST 합니다. 대행사(NHN Cloud, Solapi 등) API 형식에 맞춰 얇은 중계만 붙이면 됩니다.

```json
{
  "to": "01012345678",
  "template_code": "SCL_TRAILER_READY",
  "variables": { "director": "홍길동", "title": "편지의 이름", "link": "https://.../r/abc" },
  "text": "[Seedance Cinema Lab]\n홍길동 감독님의 영화 <편지의 이름> 트레일러가 완성되었습니다! ...",
  "buttons": [{ "type": "WL", "name": "내 영화 보러가기", "url_mobile": "https://.../r/abc", "url_pc": "https://.../r/abc" }]
}
```

- 미연동 구간 대체 수단(PRD 3단계-3): 결과 화면의 **결과 요약 복사**, **결과 링크 복사**, Web Share(모바일에서 카카오톡 선택 가능)
- `KAKAO_JS_KEY`를 넣으면 결과 화면에 **카카오톡으로 공유하기**(Kakao SDK) 버튼이 추가됩니다.

## 3-1. 현장 대형 스크린

- 관람객이 포스터 화면 / 결과 화면의 **"현장 대형 스크린에 상영하기"** 카드에서 포스터 · 트레일러를 각각 제출 (카카오톡 결과 링크에서도 가능)
- 대형 스크린 PC에서 `/screen/poster`, `/screen/trailer` 를 열고 화면 클릭(또는 F 키) → 전체 화면. 6초마다 새 제출을 가져오고, 새 작품이 먼저 소개/상영됩니다
- 노출 관리: `/admin` 의 "대형 스크린"에서 작품별 숨기기/다시 상영 (숨기면 상영 중이던 것도 즉시 내려감)
- `SCREEN_AUTO_APPROVE=0` 이면 운영자가 승인해야 상영, `SCREEN_KEY=xxx` 를 지정하면 스크린 주소에 `?key=xxx` 필요
- 포스터를 다시 만들거나 영상을 다시 생성하면 이전 제출은 내려가고 다시 제출해야 합니다

## 4. 동시 접속·네트워크 대응 (PRD 2장, 7장)

- **생성 큐**: DB 기반 디스패처. 포스터 동시 생성 `POSTER_CONCURRENCY`(기본 6), Seedance 동시 작업 `VIDEO_MAX_INFLIGHT`(기본 10). 대기 순번을 화면에 표시
- **재시도**: 429/5xx는 지수 백오프로 자동 재시도, 클라이언트도 네트워크 오류 시 자동 재시도 + 상단 "연결 불안정" 배너
- **자리 이탈 허용**: 영상 작업은 서버가 task id로 폴링 → 완료 시 카카오톡 발송. 서버가 재시작돼도 대기/진행 중 작업을 이어서 처리
- **재접속**: 같은 브라우저는 쿠키로 진행 단계 자동 복원. 다른 기기는 "내 결과 다시 보기"(전화번호 + 감독 이름)
- **비용 제한**: 세션당 포스터 `POSTER_MAX_PER_SESSION`(3), 영상 `VIDEO_MAX_PER_SESSION`(2). 실패한 생성은 횟수에 포함하지 않음

## 5. 개인정보·안전 (PRD 7장)

- 전화번호는 AES-256-GCM 암호화 저장 + 조회용 HMAC 해시만 보관, 화면/대시보드에는 마스킹(`010-****-5678`)
- 필수 동의(수집·이용) / 선택 동의(마케팅) 분리, 동의 시각 저장
- `RETENTION_DAYS`(30) 지난 세션의 전화번호 자동 파기, 결과 링크는 `RESULT_TTL_DAYS`(14) 후 만료
- 결과 링크는 추측 불가능한 토큰, 미디어 파일명도 랜덤
- 키워드는 운영자 정의 풀에서만 선택(자유 입력 없음), 감독 이름은 금칙어 필터(`config/content.json` 의 `bannedWords`) + 길이 제한. 모델 안전 정책 위반 시 사용자 친화 메시지 + 재시도
- 운영 시 반드시 `APP_SECRET`, `ADMIN_TOKEN` 고정값 지정 (비우면 `data/`에 자동 생성)

## 6. 콘텐츠 관리 (F-11)

장르 8종, 육하원칙 6 카테고리 × 10 키워드, 안내 문구는 `config/content.json` 에 있습니다. `/admin` 하단 편집기에서 바로 수정·저장할 수 있고(유효성 검사 + `.bak` 백업), 서버 재시작 없이 반영됩니다.

- 장르: 포스터 스타일(`style`), 트레일러 카메라 워크(`motion`), 제목 패턴(`titles`, `{n}` 자리에 키워드 명사), 태그라인
- 키워드: 화면용 한국어(`ko`) + 프롬프트용 영어(`en`), "무엇을" 키워드는 제목용 명사(`n`) 필수

## 7. 이벤트 로깅 (F-10)

단계별 이벤트(`session_start` → `phone_ok` → `genre_selected` → `story_built` → `poster_requested/done` → `video_requested/done` → `kakao_sent` → `result_viewed`)와 저장·공유·복사 행동을 `events` 테이블에 기록합니다. `/admin` 에서 퍼널, 평균 생성 시간, 실패 내역, 최근 체험 목록(리드), 카카오톡 발송 기록을 볼 수 있습니다.

## 8. 구조

```
server/
  index.js            HTTP 서버 · API 라우트 · 정적/미디어(Range 지원) 서빙
  config.js           .env 로딩, 설정값
  db.js               SQLite 스키마 (sessions / events / kakao_outbox)
  jobs.js             포스터·영상 생성 큐, Seedance 폴링, 보관기간 정리
  story.js            Seed LLM 스토리 + 템플릿 폴백, 이미지·영상 프롬프트 조립
  privacy.js          전화번호 정규화·암호화·해시
  content.js          content.json 로딩/검증
  providers/ark.js    Seed · Seedream · Seedance 어댑터 (+ 데모 모드)
  providers/kakao.js  카카오톡 알림 어댑터 (mock / webhook)
public/
  index.html, styles.css, app.js   체험 SPA (포스터 텍스트 오버레이는 canvas로 합성)
  admin.html                       운영자 대시보드
config/content.json   장르 · 키워드 풀 · 안내 문구
data/                 app.db, media/ (런타임 생성, git 제외)
```

### API 요약

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/bootstrap` | 콘텐츠, 모드, 현재 세션 |
| POST | `/api/session` | 새 체험 세션 (`keepPhone`: 재체험 시 번호 유지) |
| POST | `/api/session/phone` | 번호 검증·암호화·동의 저장 |
| POST | `/api/session/genre` | 장르 저장 |
| POST | `/api/story` | 키워드 + 감독 이름 → SEED NO. 발급, 스토리·프롬프트 생성 |
| POST | `/api/poster` | 포스터 생성 큐 등록 |
| POST | `/api/poster/final` | 텍스트 합성된 최종 포스터 업로드 (결과 링크·OG 이미지용) |
| POST | `/api/video` | 트레일러 생성 큐 등록 |
| GET | `/api/session` | 진행 상태 폴링 |
| GET | `/api/result/:token` | 결과 페이지 데이터 |
| POST | `/api/lookup` | 번호 + 감독 이름으로 결과 조회 |
| POST | `/api/event` | 클라이언트 이벤트 로깅 |
| POST | `/api/screen/submit` | 포스터/트레일러 대형 스크린 제출 (`kind`, 쿠키 또는 `token`) |
| GET | `/api/screen/feed?kind=poster\|trailer` | 대형 스크린용 상영 목록 |

## 9. 행사 운영 체크리스트

1. HTTPS 도메인으로 배포하고 `PUBLIC_BASE_URL` 지정 → 이 주소로 QR 코드 제작 (카카오톡 링크·OG 미리보기도 이 주소 사용)
2. 단일 프로세스 + `data/` 디렉터리 영속 볼륨. 리버스 프록시(nginx 등) 뒤에 둘 경우 `X-Forwarded-For` 전달, 업로드 본문 8MB 이상 허용
3. 행사 전 `ARK_API_KEY`로 모델 ID/쿼터 확인 → `/admin`에서 평균 생성 시간 확인 후 `POSTER_CONCURRENCY`, `VIDEO_MAX_INFLIGHT`를 계정 Rate limit에 맞게 조정
4. 카카오 알림톡 채널·템플릿 심사 완료 후 `KAKAO_PROVIDER=webhook`
5. 부스 태블릿은 `/?booth=1` 로 한 번 접속해 두기
6. 대형 스크린 PC 2대에서 `/screen/poster`, `/screen/trailer` 전체 화면 (절전 모드 해제)
