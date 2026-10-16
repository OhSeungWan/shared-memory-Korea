/* ============================================================
   Shared Memory Project — memory-card.js
   QR 사건 링크 · My Memory Card (개인 결과 카드)
   ============================================================
   · 카드는 참여자가 이 기기에서 직접 쓴 문장과 고른 항목만으로 만듭니다.
     문장을 고치거나 요약하지 않고, "이해도가 높아졌다" 같은 평가도 만들지 않습니다.
   · 탐구 전/후 비교는 shared-memory-analyzer.js의 compareBeforeAfter 결과(실제 단어·개념 차이)만 씁니다.
   · "새롭게 발견한 관점" 후보는 이 사건의 국가별 서술 NLP 결과(eventNlp)와 사건 데이터에서 만듭니다.
   · 카드 내용은 어디에도 전송·저장하지 않습니다. (이미지 저장·인쇄는 참여자의 기기 안에서만 일어남)
   · 순수 함수는 Node 테스트에서도 그대로 쓰고, 그리기(drawCard)만 브라우저 Canvas를 씁니다.
   ============================================================ */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MemoryCard = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = { before: 500, after: 1000, discovery: 120, question: 120, customDiscovery: 80 };
  const MAX_DISCOVERIES = 3;
  const COUNTRY_NAMES = { korea: '한국', japan: '일본', china: '중국' };

  /* ---------- 1. 사건 링크 (QR) ---------- */

  const ROUTE_RE = /^#\/?e\/([A-Za-z0-9_-]{1,40})\/?$/;

  /**
   * 주소에서 사건 id를 찾습니다. 지원 형식: #/e/imjin · #e/imjin · ?e=imjin · ?event=imjin
   * 목록(validIds)에 없는 id는 무시합니다(잘못된 링크 → 첫 화면).
   */
  function parseEventRoute(hash, search, validIds) {
    const ids = Array.isArray(validIds) ? validIds : [];
    let id = null;
    const m = String(hash || '').match(ROUTE_RE);
    if (m) id = m[1];
    if (!id && search) {
      const q = String(search).replace(/^\?/, '').split('&');
      for (const part of q) {
        const [k, v] = part.split('=');
        if ((k === 'e' || k === 'event') && v) { id = decodeURIComponent(v); break; }
      }
    }
    return id && ids.indexOf(id) >= 0 ? id : null;
  }

  function eventHash(eventId) { return '#/e/' + eventId; }

  /** 사건 바로가기 주소. base는 쿼리·해시를 뺀 사이트 주소(location.origin + location.pathname) */
  function eventLink(base, eventId) {
    return String(base || '').replace(/[?#].*$/, '') + eventHash(eventId);
  }

  /* ---------- 2. 입력 정리 ---------- */

  /** 앞뒤 공백·제어 문자만 정리합니다. 길이를 넘으면 자르고 … 를 붙입니다(내용을 바꾸지 않음). */
  function cleanText(value, max) {
    const s = String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!max || s.length <= max) return s;
    return s.slice(0, max - 1).trimEnd() + '…';
  }

  /** 문장 길이에 따라 카드 글자 크기 단계를 고릅니다. (긴 문장도 카드가 깨지지 않도록) */
  function lengthTier(text) {
    const n = String(text || '').length;
    if (n <= 40) return 'short';
    if (n <= 100) return 'medium';
    if (n <= 220) return 'long';
    return 'xlong';
  }

  /* ---------- 3. 새롭게 발견한 관점 — 후보 ---------- */

  function plainTerms(list, n) {
    const out = [];
    (list || []).forEach(x => {
      const t = x && x.term;
      if (t && !x.isPhrase && t.indexOf(' ') < 0 && !/^[0-9]+$/.test(t) && out.indexOf(t) < 0 && out.length < n) out.push(t);
    });
    return out;
  }

  /**
   * 사건 데이터와 국가별 서술 NLP 결과에서 "발견" 후보를 만듭니다. 모든 단어는 실제 계산 결과에서 옵니다.
   * @returns {Array<{id, chip, text, source}>}  chip = 고를 때 보이는 짧은 이름, text = 카드에 적히는 문장
   */
  function discoveryOptions(event, eventNlp) {
    const out = [];
    if (!event) return out;
    const names = [event.title, event.titleJP, event.titleCN].filter(Boolean);
    if (names.length >= 2 && new Set(names).size >= 2) {
      out.push({
        id: 'names',
        chip: '부르는 이름이 다르다',
        text: `같은 사건을 부르는 이름이 다르다 — ${names.join(' · ')}`,
        source: 'event'
      });
    }
    if (eventNlp && eventNlp.distinctive) {
      ['korea', 'japan', 'china'].forEach(c => {
        const terms = plainTerms(eventNlp.distinctive[c], 2);
        if (!terms.length) return;
        out.push({
          id: 'distinct-' + c,
          chip: `${COUNTRY_NAMES[c]} 측: ${terms.join('·')}`,
          text: `${COUNTRY_NAMES[c]} 측 서술은 ‘${terms.join('’·‘')}’을(를) 두드러지게 쓴다`,
          source: 'nlp'
        });
      });
    }
    if (eventNlp && eventNlp.common) {
      const terms = plainTerms(eventNlp.common, 3);
      if (terms.length) {
        out.push({
          id: 'common',
          chip: `세 서술 공통: ${terms.join('·')}`,
          text: `세 서술 모두 ‘${terms.join('’·‘')}’을(를) 쓴다`,
          source: 'nlp'
        });
      }
    }
    return out;
  }

  /* ---------- 4. 탐구 전 → 후 (실제 차이만) ---------- */

  /**
   * compareBeforeAfter 결과에서 카드에 적을 "새로 쓴 말 / 계속 쓴 말"을 고릅니다.
   * 개념(다국어 개념 사전)을 먼저, 그 다음 실제 어휘. 평가 문구는 만들지 않습니다.
   */
  function summarizeChange(result) {
    if (!result) return null;
    const uniq = list => list.filter((x, i) => x && list.indexOf(x) === i);
    const tidy = list => (list || []).filter(t => typeof t === 'string' && !/^[0-9]+$/.test(t) && t.length <= 20);
    return {
      added: uniq(tidy(result.addedConcepts).concat(tidy(result.added))).slice(0, 5),
      kept: uniq(tidy(result.keptConcepts).concat(tidy(result.kept))).slice(0, 4)
    };
  }

  /* ---------- 5. 카드 모델 ---------- */

  function formatDate(d) {
    const date = d instanceof Date ? d : new Date(d || Date.now());
    if (isNaN(date.getTime())) return '';
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}.${p(date.getMonth() + 1)}.${p(date.getDate())}`;
  }

  /**
   * 카드에 들어갈 내용을 만듭니다. 입력이 없는 항목은 비워 두고(카드에서 숨김), 지어내지 않습니다.
   * @param {{event, before, after, discoveries, customDiscovery, question, change, flow, published, date}} input
   */
  function buildCardModel(input) {
    const i = input || {};
    const event = i.event || {};
    const before = cleanText(i.before, LIMITS.before);
    const after = cleanText(i.after, LIMITS.after);
    const picked = (Array.isArray(i.discoveries) ? i.discoveries : [])
      .map(d => cleanText(typeof d === 'string' ? d : d && d.text, LIMITS.discovery))
      .filter(Boolean);
    const custom = cleanText(i.customDiscovery, LIMITS.customDiscovery);
    if (custom) picked.push(custom);
    const discoveries = picked.filter((d, k) => picked.indexOf(d) === k).slice(0, MAX_DISCOVERIES);
    const flow = i.flow || {};
    const change = before && after ? summarizeChange(i.change) : null;

    return {
      eventId: event.id || '',
      title: event.title || '',
      era: event.era || '',
      mark: event.mark || '共',
      question: cleanText(event.question, 160),
      before,
      after,
      hasBefore: !!before,
      discoveries,
      myQuestion: cleanText(i.question, LIMITS.question),
      change,
      stamps: [
        { id: 'compare', mark: '讀', label: '세 나라 서술', done: !!flow.viewedCompare },
        { id: 'nlp', mark: '析', label: '비교 분석', done: !!flow.viewedNlp },
        { id: 'sources', mark: '史', label: '사료 확인', done: !!flow.viewedSources },
        { id: 'shared', mark: '共', label: '공개 참여', done: !!i.published }
      ],
      tiers: { before: lengthTier(before), after: lengthTier(after) },
      date: formatDate(i.date),
      ready: !!after
    };
  }

  /* ---------- 6. 줄바꿈 (Canvas 이미지용) ---------- */

  /**
   * 주어진 폭에 맞춰 줄을 나눕니다. 공백에서 먼저 나누고, 한 단어가 폭보다 길면 글자 단위로 나눕니다.
   * maxLines를 넘으면 마지막 줄 끝에 … 을 붙이고 truncated=true를 돌려줍니다.
   * @param {(s: string) => number} measure  글자 폭을 재는 함수 (Canvas measureText 또는 테스트용)
   */
  function wrapText(text, maxWidth, measure, maxLines) {
    const lines = [];
    const limit = maxLines || Infinity;
    const paragraphs = String(text || '').split('\n');
    let truncated = false;

    outer:
    for (const para of paragraphs) {
      const tokens = para.split(/(\s+)/).filter(t => t !== '');
      let line = '';
      const push = l => {
        if (lines.length >= limit) { truncated = true; return false; }
        lines.push(l.replace(/\s+$/, ''));
        return true;
      };
      for (const tok of tokens) {
        const candidate = line + tok;
        if (measure(candidate) <= maxWidth) { line = candidate; continue; }
        if (/^\s+$/.test(tok)) { if (!push(line)) break outer; line = ''; continue; }
        if (line.trim()) { if (!push(line)) break outer; line = ''; }
        if (measure(tok) <= maxWidth) { line = tok; continue; }
        for (const ch of Array.from(tok)) {
          if (measure(line + ch) > maxWidth && line) { if (!push(line)) break outer; line = ''; }
          line += ch;
        }
      }
      if (!push(line)) break;
    }

    if (truncated && lines.length) {
      let last = lines[lines.length - 1];
      while (last && measure(last + '…') > maxWidth) last = Array.from(last).slice(0, -1).join('');
      lines[lines.length - 1] = last.replace(/\s+$/, '') + '…';
    }
    return { lines, truncated };
  }

  /* ---------- 7. Canvas 그리기 (브라우저) ---------- */

  const COLORS = {
    bg: '#f5f1e8', paper: '#faf7ef', ink: '#1a1a1a', soft: '#4a4a4a', mute: '#8a8580',
    line: '#d8d2c4', accent: '#8b3a3a', accentSoft: '#e8d5b7',
    korea: '#c8364b', japan: '#2c3e7e', china: '#d4a017'
  };
  const SERIF = "'Noto Serif KR', 'Nanum Myeongjo', serif";
  const SANS = "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif";
  const LATIN = "'Cormorant Garamond', Georgia, serif";

  const AFTER_SIZE = { short: 50, medium: 42, long: 36, xlong: 32 };
  const BEFORE_SIZE = { short: 34, medium: 30, long: 28, xlong: 26 };

  /**
   * 카드를 1080px 폭 이미지로 그립니다. 높이는 내용에 맞춰 정해지며 최소 1350(4:5), 최대 1920입니다.
   * 문장이 길면 글자 크기를 줄이고, 그래도 넘치면 줄 수를 제한한 뒤 하단에 "(일부 생략)"을 표시합니다.
   * @returns {{width, height, truncated}}
   */
  function drawCard(canvas, model) {
    const W = 1080, PAD = 84, INNER = W - PAD * 2;
    const ctx = canvas.getContext('2d');
    const measureWith = font => s => { ctx.font = font; return ctx.measureText(s).width; };
    let truncated = false;
    const ops = [];
    let y = PAD + 24;

    const text = (str, font, color, x, yy, align) => ops.push(c => {
      c.font = font; c.fillStyle = color; c.textAlign = align || 'left'; c.textBaseline = 'alphabetic';
      c.fillText(str, x, yy);
    });
    const block = (str, font, size, color, lineH, maxLines, indent) => {
      const width = INNER - (indent || 0);
      const r = wrapText(str, width, measureWith(font), maxLines);
      if (r.truncated) truncated = true;
      r.lines.forEach(l => { y += lineH; text(l, font, color, PAD + (indent || 0), y); });
      return r;
    };
    const label = (str) => { y += 56; text(str, `600 22px ${SANS}`, COLORS.accent, PAD, y); y += 8; };
    const rule = (gap) => { y += gap || 36; const yy = y; ops.push(c => { c.strokeStyle = COLORS.line; c.lineWidth = 2; c.beginPath(); c.moveTo(PAD, yy); c.lineTo(W - PAD, yy); c.stroke(); }); };

    // 머리글: 브랜드 + 카드 이름
    text('SHARED MEMORY', `600 28px ${LATIN}`, COLORS.ink, PAD, y);
    text(`MY MEMORY CARD · ${model.date}`, `400 22px ${LATIN}`, COLORS.mute, W - PAD, y, 'right');
    rule(30);

    // 사건 + 도장
    const sealSize = 132;
    const sealY = y + 40;
    ops.push(c => {
      c.save();
      c.translate(W - PAD - sealSize / 2, sealY + sealSize / 2);
      c.rotate(-0.035);
      c.fillStyle = COLORS.accent;
      c.fillRect(-sealSize / 2, -sealSize / 2, sealSize, sealSize);
      c.font = `900 84px ${SERIF}`; c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(model.mark, 0, 6);
      c.restore();
    });
    y += 40;
    const titleWidth = INNER - sealSize - 30;
    const eraFont = `400 26px ${LATIN}`;
    y += 30; text(model.era, eraFont, COLORS.accent, PAD, y);
    const titleFont = `900 64px ${SERIF}`;
    wrapText(model.title, titleWidth, measureWith(titleFont), 2).lines.forEach(l => { y += 78; text(l, titleFont, COLORS.ink, PAD, y); });
    y = Math.max(y, sealY + sealSize);
    if (model.question) {
      y += 18;
      const qFont = `500 28px ${SERIF}`;
      wrapText(model.question, INNER, measureWith(qFont), 3).lines.forEach(l => { y += 42; text(l, qFont, COLORS.soft, PAD, y); });
    }
    rule(40);

    // 탐구 전
    label('탐구 전 · 나의 첫 생각');
    if (model.before) {
      const s = BEFORE_SIZE[model.tiers.before];
      block(`“${model.before}”`, `400 ${s}px ${SERIF}`, s, COLORS.soft, Math.round(s * 1.55), 4);
    } else {
      block('탐구 전 문장을 남기지 않았어요.', `400 26px ${SANS}`, 26, COLORS.mute, 40, 1);
    }

    // 화살표
    y += 30;
    const ay = y;
    ops.push(c => { c.fillStyle = COLORS.accent; c.font = `400 34px ${SANS}`; c.textAlign = 'left'; c.fillText('↓', PAD, ay + 10); });

    // 탐구 후
    label('탐구 후 · 나의 한 문장');
    const as = AFTER_SIZE[model.tiers.after];
    block(`“${model.after}”`, `700 ${as}px ${SERIF}`, as, COLORS.ink, Math.round(as * 1.5), 6);

    // 생각의 변화 (실제 단어 차이)
    if (model.change && (model.change.added.length || model.change.kept.length)) {
      y += 24;
      const chFont = `400 25px ${SANS}`;
      if (model.change.added.length) block(`새로 쓴 말  ${model.change.added.join(' · ')}`, chFont, 25, COLORS.soft, 40, 2);
      if (model.change.kept.length) block(`계속 쓴 말  ${model.change.kept.join(' · ')}`, chFont, 25, COLORS.mute, 40, 2);
    }

    // 발견한 관점
    if (model.discoveries.length) {
      rule(40);
      label('탐구하며 새롭게 발견한 관점');
      model.discoveries.forEach(d => {
        y += 8;
        const startY = y;
        block(d, `400 28px ${SANS}`, 28, COLORS.ink, 44, 2, 30);
        ops.push(c => { c.fillStyle = COLORS.accent; c.fillRect(PAD, startY + 22, 14, 3); });
      });
    }

    // 남은 질문
    if (model.myQuestion) {
      rule(40);
      label('아직 남은 나의 질문');
      block(model.myQuestion, `500 30px ${SERIF}`, 30, COLORS.ink, 46, 3);
    }

    // 탐구 기록 도장
    rule(48);
    y += 40;
    const stampR = 34;
    const stampsY = y + stampR;
    model.stamps.forEach((st, k) => {
      const cx = PAD + stampR + k * 200;
      ops.push(c => {
        c.beginPath(); c.arc(cx, stampsY, stampR, 0, Math.PI * 2);
        if (st.done) { c.fillStyle = COLORS.accent; c.fill(); }
        else { c.setLineDash([5, 5]); c.strokeStyle = COLORS.line; c.lineWidth = 2; c.stroke(); c.setLineDash([]); }
        c.font = `700 30px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = st.done ? '#fff' : COLORS.line; c.fillText(st.mark, cx, stampsY + 2);
        c.font = `400 20px ${SANS}`; c.fillStyle = st.done ? COLORS.soft : COLORS.mute; c.textBaseline = 'alphabetic';
        c.fillText(st.label, cx, stampsY + stampR + 32);
      });
    });
    y = stampsY + stampR + 32;

    // 하단
    y += 56;
    const footY = y;
    text('참여자가 직접 쓴 문장으로 만든 카드입니다. 정답이나 점수를 뜻하지 않습니다.', `400 20px ${SANS}`, COLORS.mute, PAD, footY);
    if (truncated) text('(긴 문장은 일부 생략)', `400 20px ${SANS}`, COLORS.mute, W - PAD, footY, 'right');
    y += 36;
    text('共  Shared Memory · 동북아 역사 공동 기억 프로젝트', `600 22px ${SERIF}`, COLORS.accent, PAD, y);

    const H = Math.min(1920, Math.max(1350, Math.ceil(y + PAD)));
    canvas.width = W;
    canvas.height = H;
    const c = canvas.getContext('2d');
    // 바탕: 한지색 + 이중 테두리 (박물관 소장 카드 느낌)
    c.fillStyle = COLORS.bg; c.fillRect(0, 0, W, H);
    c.fillStyle = COLORS.paper; c.fillRect(28, 28, W - 56, H - 56);
    c.strokeStyle = COLORS.ink; c.lineWidth = 3; c.strokeRect(28, 28, W - 56, H - 56);
    c.strokeStyle = COLORS.line; c.lineWidth = 1.5; c.strokeRect(44, 44, W - 88, H - 88);
    // 세 나라 색 띠 (상단)
    const band = (W - 56) / 3;
    [COLORS.korea, COLORS.japan, COLORS.china].forEach((col, k) => { c.fillStyle = col; c.globalAlpha = 0.85; c.fillRect(28 + band * k, 28, band, 8); });
    c.globalAlpha = 1;
    ops.forEach(op => op(c));
    return { width: W, height: H, truncated: truncated || y + PAD > 1920 };
  }

  return {
    LIMITS,
    MAX_DISCOVERIES,
    parseEventRoute,
    eventHash,
    eventLink,
    cleanText,
    lengthTier,
    discoveryOptions,
    summarizeChange,
    formatDate,
    buildCardModel,
    wrapText,
    drawCard
  };
});
