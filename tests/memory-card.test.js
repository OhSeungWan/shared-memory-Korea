/* QR 사건 링크 · My Memory Card 테스트 — 실행: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const Card = require('../memory-card.js');
const SM = require('../shared-memory-analyzer.js');
const NLP = require('../nlp-analyzer.js');
const eventsData = require('../events-data.js');

const ROOT = path.join(__dirname, '..');
const IDS = eventsData.map(e => e.id);
const imjin = eventsData.find(e => e.id === 'imjin');
const narratives = { korea: imjin.korea, japan: imjin.japan, china: imjin.china };
const monoMeasure = s => Array.from(String(s)).length * 10;   // 글자당 10px (테스트용)

test('사건 링크: #/e/id · #e/id · ?e= · ?event= 형식을 읽고, 없는 사건·이상한 값은 무시한다', () => {
  assert.equal(Card.parseEventRoute('#/e/imjin', '', IDS), 'imjin');
  assert.equal(Card.parseEventRoute('#e/zainichi', '', IDS), 'zainichi');
  assert.equal(Card.parseEventRoute('#/e/hiroshima/', '', IDS), 'hiroshima');
  assert.equal(Card.parseEventRoute('', '?e=culture', IDS), 'culture');
  assert.equal(Card.parseEventRoute('', '?utm=x&event=modern', IDS), 'modern');
  assert.equal(Card.parseEventRoute('#/e/nope', '', IDS), null);
  assert.equal(Card.parseEventRoute('#/e/<script>', '', IDS), null);
  assert.equal(Card.parseEventRoute('#/e/imjin?x', '', IDS), null);
  assert.equal(Card.parseEventRoute('#about', '', IDS), null);
  assert.equal(Card.parseEventRoute(undefined, undefined, IDS), null);
  assert.equal(Card.parseEventRoute('#/e/imjin', '', null), null);
});

test('사건 링크: 사이트 주소의 기존 쿼리·해시를 지우고 #/e/id를 붙인다', () => {
  assert.equal(Card.eventLink('https://oseungye.github.io/shared-memory-Korea/', 'imjin'), 'https://oseungye.github.io/shared-memory-Korea/#/e/imjin');
  assert.equal(Card.eventLink('https://x.org/index.html?e=old#/e/old', 'tribute'), 'https://x.org/index.html#/e/tribute');
  IDS.forEach(id => assert.equal(Card.parseEventRoute(Card.eventHash(id), '', IDS), id));
});

test('모든 사건에 역사적 질문(question)이 있고, 짧은 열린 질문이다', () => {
  eventsData.forEach(e => {
    assert.ok(typeof e.question === 'string' && e.question.length >= 10 && e.question.length <= 160, e.id);
    assert.match(e.question, /\?|까요/, e.id);
  });
});

test('카드 모델: 입력 문장을 바꾸지 않고 담는다 (앞뒤 공백·제어 문자만 정리)', () => {
  const m = Card.buildCardModel({ event: imjin, before: '  일본과 <조선>이 싸운 전쟁\u0007 ', after: '임진왜란은 국제 전쟁이었다.', date: new Date(2026, 9, 16) });
  assert.equal(m.before, '일본과 <조선>이 싸운 전쟁');
  assert.equal(m.after, '임진왜란은 국제 전쟁이었다.');
  assert.equal(m.title, '임진왜란');
  assert.equal(m.question, imjin.question);
  assert.equal(m.mark, '壬');
  assert.equal(m.date, '2026.10.16');
  assert.equal(m.ready, true);
  assert.equal(m.hasBefore, true);
});

test('카드 모델: 없는 항목은 비워 두고 지어내지 않는다', () => {
  const m = Card.buildCardModel({ event: imjin, after: '한 문장' });
  assert.equal(m.before, '');
  assert.equal(m.hasBefore, false);
  assert.equal(m.change, null);                 // 탐구 전 문장이 없으면 변화 비교 없음
  assert.deepEqual(m.discoveries, []);
  assert.equal(m.myQuestion, '');
  assert.ok(m.stamps.every(s => s.done === false));
  assert.equal(Card.buildCardModel({ event: imjin }).ready, false);
  assert.equal(Card.buildCardModel(null).ready, false);
});

test('카드 모델: 탐구 기록 도장은 실제 진행 기록과 공개 여부만 반영한다', () => {
  const m = Card.buildCardModel({ event: imjin, after: 'x', flow: { viewedCompare: true, viewedNlp: false, viewedSources: true }, published: false });
  assert.deepEqual(m.stamps.map(s => [s.id, s.done]), [['compare', true], ['nlp', false], ['sources', true], ['shared', false]]);
});

test('카드 모델: 발견은 최대 3개, 중복 제거, 직접 쓴 발견 포함', () => {
  const opts = [{ id: 'a', text: '가' }, { id: 'b', text: '나' }, { id: 'c', text: '가' }, { id: 'd', text: '라' }];
  const m = Card.buildCardModel({ event: imjin, after: 'x', discoveries: opts, customDiscovery: '직접' });
  assert.deepEqual(m.discoveries, ['가', '나', '라']);
  const m2 = Card.buildCardModel({ event: imjin, after: 'x', discoveries: [{ text: '가' }], customDiscovery: '  직접  ' });
  assert.deepEqual(m2.discoveries, ['가', '직접']);
});

test('카드 모델: 최대 길이를 넘으면 자르고 … 표시 (before 500, after 1000, 질문 120)', () => {
  const m = Card.buildCardModel({ event: imjin, before: 'ㄱ'.repeat(800), after: 'ㄴ'.repeat(1500), question: 'ㄷ'.repeat(300) });
  assert.equal(m.before.length, 500);
  assert.ok(m.before.endsWith('…'));
  assert.equal(m.after.length, 1000);
  assert.equal(m.myQuestion.length, 120);
  assert.equal(m.tiers.after, 'xlong');
});

test('글자 크기 단계: 짧은 문장은 크게, 긴 문장은 작게', () => {
  assert.equal(Card.lengthTier('짧다'), 'short');
  assert.equal(Card.lengthTier('가'.repeat(80)), 'medium');
  assert.equal(Card.lengthTier('가'.repeat(150)), 'long');
  assert.equal(Card.lengthTier('가'.repeat(500)), 'xlong');
  assert.equal(Card.lengthTier(null), 'short');
});

test('탐구 전/후 변화: compareBeforeAfter의 실제 차이만 쓰고 평가하지 않는다', () => {
  const before = '일본과 조선이 싸운 전쟁';
  const after = '일본의 침략으로 시작되어 조선과 명나라가 함께 맞선 국제 전쟁';
  const r = SM.compareBeforeAfter(before, after, { narratives });
  const m = Card.buildCardModel({ event: imjin, before, after, change: r });
  assert.ok(m.change.added.length > 0 && m.change.added.length <= 5);
  m.change.added.forEach(w => assert.ok(r.addedConcepts.includes(w) || r.added.includes(w), w));
  m.change.kept.forEach(w => assert.ok(r.keptConcepts.includes(w) || r.kept.includes(w), w));
  assert.ok(m.change.added.includes('침략'));
  assert.equal(JSON.stringify(m).match(/향상|성장|점수|정답/), null);
  // 같은 문장이면 새로 쓴 말이 없다
  const same = Card.summarizeChange(SM.compareBeforeAfter(before, before, { narratives }));
  assert.deepEqual(same.added, []);
  assert.equal(Card.summarizeChange(null), null);
});

test('발견 후보: 사건 이름 차이와 실제 NLP 결과 단어로만 만든다', () => {
  const nlp = NLP.analyzeEventData(imjin, eventsData);
  const opts = Card.discoveryOptions(imjin, nlp);
  const names = opts.find(o => o.id === 'names');
  assert.ok(names && names.text.includes(imjin.titleJP) && names.text.includes(imjin.titleCN));
  ['korea', 'japan', 'china'].forEach(c => {
    const o = opts.find(x => x.id === 'distinct-' + c);
    if (!o) return;
    const terms = [...o.text.matchAll(/‘([^’]+)’/g)].map(x => x[1]);
    terms.forEach(t => assert.ok(nlp.distinctive[c].some(d => d.term === t), `${c}:${t}`));
  });
  const common = opts.find(o => o.id === 'common');
  if (common) [...common.text.matchAll(/‘([^’]+)’/g)].forEach(x => assert.ok(nlp.common.some(e => e.term === x[1]), x[1]));
  assert.deepEqual(Card.discoveryOptions(null, nlp), []);
  assert.deepEqual(Card.discoveryOptions(imjin, null).map(o => o.id), ['names']);
  eventsData.forEach(e => assert.ok(Card.discoveryOptions(e, NLP.analyzeEventData(e, eventsData)).length >= 2, e.id));
});

test('줄바꿈: 폭을 넘지 않고, 긴 단어는 글자 단위로 나누고, 줄 수를 넘으면 …', () => {
  const r = Card.wrapText('가나다 라마바사 아자차카타파하', 60, monoMeasure);
  assert.deepEqual(r.lines, ['가나다', '라마바사', '아자차카타파', '하']);
  r.lines.forEach(l => assert.ok(monoMeasure(l) <= 60, l));
  const long = Card.wrapText('가'.repeat(100), 100, monoMeasure, 3);
  assert.equal(long.lines.length, 3);
  assert.equal(long.truncated, true);
  assert.ok(long.lines[2].endsWith('…') && monoMeasure(long.lines[2]) <= 100);
  const para = Card.wrapText('첫 줄\n둘째 줄', 1000, monoMeasure);
  assert.deepEqual(para.lines, ['첫 줄', '둘째 줄']);
  assert.deepEqual(Card.wrapText('', 100, monoMeasure).lines, ['']);
  assert.equal(Card.wrapText('짧다', 100, monoMeasure, 2).truncated, false);
});

test('QR 라이브러리: 수정 없는 원본 파일이 기록된 해시·버전과 일치하고, 사건 링크를 QR로 만든다', () => {
  const dir = path.join(ROOT, 'vendor', 'qrcode-generator');
  const info = JSON.parse(fs.readFileSync(path.join(dir, 'VERSION.json'), 'utf8'));
  const lib = fs.readFileSync(path.join(dir, 'qrcode.js'));
  assert.equal(info.package, 'qrcode-generator');
  assert.equal(info.license, 'MIT');
  assert.match(info.npmIntegrity, /^sha512-/);
  assert.equal(crypto.createHash('sha256').update(lib).digest('hex'), info.fileSha256);
  assert.match(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8'), /MIT License[\s\S]*Kazuhiko Arase/);
  assert.equal(/\beval\(|new Function\(|XMLHttpRequest|fetch\(|localStorage|document\.cookie/.test(lib.toString()), false);

  const qrcode = require('../vendor/qrcode-generator/qrcode.js');
  const link = Card.eventLink('https://oseungye.github.io/shared-memory-Korea/', 'zainichi');
  const qr = qrcode(0, 'M');
  qr.addData(link, 'Byte');
  qr.make();
  assert.ok(qr.getModuleCount() >= 21 && qr.getModuleCount() <= 57);
  assert.match(qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true }), /^<svg[\s\S]*<path/);
});

test('index.html: QR·카드 스크립트를 같은 주소에서 script.js보다 먼저 불러오고, 외부 QR 서비스를 쓰지 않는다', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  const at = s => srcs.indexOf(s);
  assert.ok(at('./vendor/qrcode-generator/qrcode.js') >= 0 && at('./memory-card.js') >= 0);
  assert.ok(at('./vendor/qrcode-generator/qrcode.js') < at('./script.js') && at('./memory-card.js') < at('./script.js'));
  assert.equal(/api\.qrserver|chart\.googleapis|quickchart/i.test(html), false);
  // 공개 등록은 별도 동의 체크와 함께, 카드 만들기와 분리되어 있다
  assert.match(html, /id="publishConsent"/);
  assert.match(html, /id="makeCardButton"/);
  // 카드 만들기는 STEP 3의 주요 행동(화면 아래 고정 버튼)이고, 공개 등록 영역(publishBox) 밖에 있다
  const pub = html.slice(html.indexOf('id="publishBox"'), html.indexOf('id="submitNarrative"'));
  assert.ok(pub.length > 0 && !pub.includes('makeCardButton'));
  assert.match(html, /data-step-main="3" id="makeCardButton"/);
});
