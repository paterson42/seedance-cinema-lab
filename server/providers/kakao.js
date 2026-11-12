// KakaoTalk result notification.
//  - mock    : no real send; recorded in kakao_outbox (visible on /admin)
//  - webhook : POSTs a JSON payload to KAKAO_WEBHOOK_URL, for an AlimTalk vendor
//              (NHN Cloud, Solapi, etc.) or an internal relay that owns the
//              channel/template approvals.
import { config } from '../config.js';
import { db, logEvent } from '../db.js';
import { decrypt } from '../privacy.js';

function record(session, payload, status, error) {
  db.prepare('INSERT INTO kakao_outbox (session_id, phone_masked, template, payload, status, error, ts) VALUES (?,?,?,?,?,?,?)').run(
    session.id,
    session.phone_masked,
    config.kakao.templateCode,
    JSON.stringify(payload),
    status,
    error || null,
    Date.now(),
  );
}

export function kakaoEnabled() {
  return config.kakao.provider === 'webhook' ? !!config.kakao.webhookUrl : true;
}

export async function sendTrailerReady(session) {
  if (!session.phone_enc) return 'skipped';
  const link = `${config.publicBaseUrl}/r/${session.result_token}`;
  const title = session.story?.title || '나의 영화';
  const director = session.director || 'YOU';
  const payload = {
    template_code: config.kakao.templateCode,
    variables: { director, title, link },
    text: `[Seedance Cinema Lab]\n${director} 감독님의 영화 <${title}> 트레일러가 완성되었습니다!\n\n아래 버튼을 눌러 포스터와 트레일러를 확인하고 저장하세요.\n(링크는 ${config.resultTtlDays}일간 유효합니다)`,
    buttons: [{ type: 'WL', name: '내 영화 보러가기', url_mobile: link, url_pc: link }],
  };

  if (config.kakao.provider !== 'webhook') {
    record(session, payload, 'mock_sent');
    logEvent(session.id, 'kakao_sent', { provider: 'mock' });
    console.log(`[kakao:mock] → ${session.phone_masked}  ${link}`);
    return 'mock_sent';
  }

  try {
    const res = await fetch(config.kakao.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.kakao.webhookToken ? { Authorization: `Bearer ${config.kakao.webhookToken}` } : {}),
      },
      body: JSON.stringify({ to: decrypt(session.phone_enc), ...payload }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    record(session, payload, 'sent');
    logEvent(session.id, 'kakao_sent', { provider: 'webhook' });
    return 'sent';
  } catch (e) {
    record(session, payload, 'failed', e.message);
    console.warn('[kakao] send failed:', e.message);
    return 'failed';
  }
}
