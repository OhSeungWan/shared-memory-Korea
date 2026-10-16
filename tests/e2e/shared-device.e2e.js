/* 공용 기기 참여자 분리 — 브라우저 E2E (가짜 Supabase 사용, 실제 DB 접속 없음)
   실행: node tests/e2e/shared-device.e2e.js
   · Playwright가 필요합니다. 없으면 PLAYWRIGHT_MODULE 환경변수로 경로를 지정하세요.
   · npm test(단위 테스트)에는 포함되지 않습니다. */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright'].filter(Boolean);
  for (const c of candidates) { try { return require(c); } catch (e) { /* 다음 후보 */ } }
  console.log('SKIP: Playwright를 찾을 수 없습니다. (PLAYWRIGHT_MODULE로 경로 지정)');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..', '..');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${!cond && detail ? ' — ' + detail : ''}`);
}

async function preparePage(context, base) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => (page.__dialogAnswer === false ? d.dismiss() : d.accept()));
  // 외부 요청(폰트 등)은 차단하고, supabase-js 요청만 가짜 클라이언트로 바꿉니다.
  // (Playwright는 나중에 등록한 route를 먼저 적용하므로 차단 규칙을 먼저 등록)
  await page.route(url => !url.href.startsWith(base), r => r.abort());
  await page.route(/supabase-js|vendor\/supabase/, r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  page.__errors = errors;
  return page;
}

async function participate(page, { age, before, text }) {
  await page.click('#startButton');
  await page.click(`#agePicker [data-age-value="${age}"]`);
  await page.click('#agePickerNextBtn');
  await page.click('.event-card[data-event-id="imjin"]');
  await page.waitForSelector('#beforeInput');
  await page.fill('#beforeInput', before);
  await page.click('[data-before-action="save"]');
  await page.click('.tab[data-tab="shared"]');
  await page.fill('#userNarrative', text);
  await page.click('#submitNarrative');
  await page.waitForFunction(() => /등록되었습니다|실패/.test(document.getElementById('submitStatus').textContent));
}

(async () => {
  const { chromium } = loadPlaywright();
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  let exitCode = 0;
  try {
    /* ---------- 1. 학생 A → 학생 B (같은 기기) ---------- */
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    let page = await preparePage(context, base);
    await page.goto(base + 'index.html');
    check('처음 온 사람에게는 "새 참여자로 시작" 안내가 보이지 않음', await page.$eval('.page--home [data-newcomer-note]', el => el.hidden));

    const A = { age: '10s', before: 'A가 쓴 탐구 전 문장', text: '임진왜란은 일본의 침략으로 시작된 국제전쟁이었다는 A의 문장' };
    await participate(page, A);
    let db = await page.evaluate(() => window.__mockDb.read());
    const rowA = db.shared_expressions[0];
    const keyA = db.expression_participants[0] && db.expression_participants[0].participant_key;
    check('A의 제출이 저장됨 (A의 탐구 전 문장 포함)', rowA && rowA.before_content === A.before && rowA.age_group === '10s');
    check('제출 후 탐구 전 문장이 이 기기에서 지워짐', await page.evaluate(() => localStorage.getItem('sm_before_imjin') === null));
    check('제출 후 탐구 전 카드에 A의 문장이 보이지 않음', !(await page.$eval('#beforeCard', el => el.innerText)).includes(A.before));
    check('제출 직후 "다음 학생" 안내가 보임', await page.isVisible('#submitNext [data-new-participant]'));

    // 새로고침 → 이전 기록 안내
    await page.reload();
    check('새로고침 후 이전 참여 기록 안내가 보임', !(await page.$eval('.page--home [data-newcomer-note]', el => el.hidden)));
    check('새로고침 후에도 A의 참여자 키는 유지 (같은 학생이 계속하는 경우)', await page.evaluate(k => localStorage.getItem('sm_participant_key') === k, keyA));

    // B: 새 참여자로 시작
    await page.click('.page--home [data-newcomer-note] [data-new-participant]');
    check('초기화 후 Shared Memory 키가 남지 않음', await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sm_')).length === 0));
    check('초기화 안내 문구 표시', await page.isVisible('#newParticipantStatus'));
    check('연령대 선택이 다시 열림', await page.isVisible('#agePicker'));
    const B = { age: '20s', before: 'B가 쓴 탐구 전 문장', text: '임진왜란은 조선과 명과 일본이 참여한 전쟁이었다는 B의 문장' };
    await page.click('#agePicker [data-age-value="20s"]');
    await page.click('#agePickerNextBtn');
    await page.click('.event-card[data-event-id="imjin"]');
    await page.waitForSelector('#beforeInput');
    check('B의 탐구 전 입력창이 비어 있음', (await page.inputValue('#beforeInput')) === '');
    check('B 화면에 A의 문장이 보이지 않음', !(await page.$eval('.page--detail', el => el.innerText)).includes(A.before));
    check('B의 진행 표시가 처음 상태 (제출 완료 표시 없음)', !(await page.$eval('#flowProgress', el => el.innerText)).includes('탐구를 모두 마쳤습니다'));
    await page.fill('#beforeInput', B.before);
    await page.click('[data-before-action="save"]');
    await page.click('.tab[data-tab="shared"]');
    await page.fill('#userNarrative', B.text);
    await page.click('#submitNarrative');
    await page.waitForFunction(() => /등록되었습니다/.test(document.getElementById('submitStatus').textContent));
    db = await page.evaluate(() => window.__mockDb.read());
    const rowB = db.shared_expressions[1];
    const keyB = db.expression_participants[1] && db.expression_participants[1].participant_key;
    check('B의 제출에는 B의 탐구 전 문장만 포함', rowB && rowB.before_content === B.before && !JSON.stringify(rowB).includes(A.before));
    check('B의 연령대는 B가 고른 값', rowB && rowB.age_group === '20s');
    check('B의 참여자 키가 A와 다름', keyB && keyA && keyB !== keyA, `${keyA} / ${keyB}`);
    check('DB에 저장된 A의 데이터는 유지됨 (삭제·수정 요청 없음)', db.shared_expressions.length === 2 && db.shared_expressions[0].content === A.text &&
      (await page.evaluate(() => window.__mockDb.calls.every(c => c.op === 'insert' || c.op === 'rpc'))));
    await page.reload();
    check('새로고침 후에도 B의 키 유지 (A로 돌아가지 않음)', await page.evaluate(k => localStorage.getItem('sm_participant_key') === k, keyB));
    check('A·B 진행 중 페이지 오류 없음', page.__errors.length === 0, page.__errors.join(' | '));

    /* ---------- 2. 작성 중 확인 · 제출 실패 시 보존 ---------- */
    page = await preparePage(context, base);
    await page.goto(base + 'index.html');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload();
    await page.click('#startButton');
    await page.click('#agePicker [data-age-value="10s"]');
    await page.click('#agePickerNextBtn');
    await page.click('.event-card[data-event-id="imjin"]');
    await page.waitForSelector('#beforeInput');
    await page.fill('#beforeInput', 'C의 탐구 전 문장');
    await page.click('[data-before-action="save"]');
    await page.click('.tab[data-tab="shared"]');
    await page.fill('#userNarrative', 'C가 작성 중인 문장');
    page.__dialogAnswer = false;
    let dialogText = '';
    page.once('dialog', d => { dialogText = d.message(); });
    await page.click('#flowProgress [data-new-participant]');
    check('작성 중이면 초기화 전에 확인 창을 띄움', /작성 중인 문장/.test(dialogText) && /탐구 전 문장/.test(dialogText), dialogText);
    check('확인 창에서 취소하면 아무것도 지우지 않음', (await page.inputValue('#userNarrative')) === 'C가 작성 중인 문장' &&
      await page.evaluate(() => localStorage.getItem('sm_before_imjin') === 'C의 탐구 전 문장'));
    await page.evaluate(() => { window.__mockDb.failInsert = true; });
    await page.click('#submitNarrative');
    await page.waitForFunction(() => /실패/.test(document.getElementById('submitStatus').textContent));
    check('제출 실패 시 작성 중인 문장 유지', (await page.inputValue('#userNarrative')) === 'C가 작성 중인 문장');
    check('제출 실패 시 탐구 전 문장 유지', await page.evaluate(() => localStorage.getItem('sm_before_imjin') === 'C의 탐구 전 문장'));
    page.__dialogAnswer = true;
    await page.click('#flowProgress [data-new-participant]');
    check('확인 후 초기화하면 작성 중 문장도 지워짐', (await page.inputValue('#userNarrative')) === '' &&
      await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sm_')).length === 0));
    check('작성 중 확인·실패 흐름에서 페이지 오류 없음', page.__errors.length === 0, page.__errors.join(' | '));
    await context.close();

    /* ---------- 3. localStorage를 쓸 수 없는 환경 ---------- */
    const noStorage = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await noStorage.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
    page = await preparePage(noStorage, base);
    await page.goto(base + 'index.html');
    await participate(page, { age: '10s', before: 'D의 문장', text: '저장소가 막힌 환경에서도 참여할 수 있다는 D의 문장' });
    db = await page.evaluate(() => window.__mockDb.read());
    check('저장소가 막혀도 참여·제출 가능 (탐구 전 문장도 함께 저장)', db.shared_expressions.length === 1 && db.shared_expressions[0].before_content === 'D의 문장');
    await page.click('#submitNext [data-new-participant]');
    check('저장소가 막혀도 새 참여자로 시작 가능', await page.isVisible('#agePicker'));
    check('저장소가 막힌 환경에서 페이지 오류 없음', page.__errors.length === 0, page.__errors.join(' | '));
    check('모바일 폭에서 가로 넘침 없음', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await noStorage.close();
  } catch (e) {
    console.error('E2E 실행 오류:', e);
    exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  process.exit(failed || exitCode ? 1 : 0);
})();
