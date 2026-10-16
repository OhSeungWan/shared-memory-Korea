/* Supabase JS 저장소 내 보관 — 브라우저 E2E (외부 CDN 차단, 실제 DB 접속 없음)
   실행: node tests/e2e/offline-vendor.e2e.js
   · 같은 주소(로컬 서버) 밖으로 나가는 요청은 모두 막습니다. → 학교망에서 CDN이 차단된 상황
   · Supabase API 요청은 가짜 응답으로 바꾸거나(정상 경로) 실패시킵니다(네트워크 장애 경로). */
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

const SUPABASE = /^https:\/\/[a-z0-9]+\.supabase\.co\//;

async function openPage(browser, base, apiHandler, viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
  const page = await context.newPage();
  const external = [];
  const api = [];
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  // 1) 같은 주소 밖 요청은 모두 차단 (CDN·폰트 포함) — Supabase API는 아래에서 따로 처리
  await page.route(url => !url.href.startsWith(base) && !SUPABASE.test(url.href), r => { external.push(r.request().url()); r.abort(); });
  // 2) Supabase API: 실제 서버로 보내지 않음
  await page.route(SUPABASE, r => {
    const req = r.request();
    api.push({ method: req.method(), url: req.url(), body: req.postData() });
    return apiHandler(r, req);
  });
  page.__external = external;
  page.__api = api;
  return { context, page };
}

const json = (r, status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

(async () => {
  const { chromium } = loadPlaywright();
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  let exitCode = 0;
  try {
    /* ---------- 1. CDN 차단 + 정상 API (가짜 응답) ---------- */
    const rows = [];
    const ok = await openPage(browser, base, (r, req) => {
      const u = req.url();
      if (u.includes('/rpc/public_expressions')) return json(r, 200, rows);
      if (u.includes('/rpc/empathy_counts')) return json(r, 200, []);
      if (u.includes('/rpc/participation_summary')) return json(r, 200, [{ participants: rows.length, completed_participants: 0, expressions: rows.length }]);
      if (u.includes('/rpc/age_group_participants')) return json(r, 200, []);
      if (u.includes('/rest/v1/shared_expressions') && req.method() === 'POST') {
        const body = JSON.parse(req.postData())[0];
        const row = Object.assign({ id: 1000 + rows.length, created_at: new Date().toISOString(), age_group_suppressed: false }, body);
        rows.unshift(row);
        return json(r, 201, [{ id: row.id }]);
      }
      if (u.includes('/rest/v1/expression_participants')) return r.fulfill({ status: 201, body: '' });
      return json(r, 404, { message: 'not mocked' });
    });
    let page = ok.page;
    await page.goto(base + 'index.html');
    check('외부 CDN 없이 supabase-js가 로드됨 (window.supabase.createClient)', await page.evaluate(() => !!(window.supabase && typeof window.supabase.createClient === 'function')));
    check('Supabase 클라이언트(db)가 만들어짐', await page.evaluate(() => typeof db !== 'undefined' && db !== null && typeof db.from === 'function'));
    check('외부 스크립트 요청이 없음 (CDN 시도 0건)', !page.__external.some(u => /\.js(\?|$)/.test(u) || /jsdelivr|unpkg|cdnjs/.test(u)), page.__external.join(', '));
    check('페이지 기본 JS 동작 (사건 카드 6개 렌더)', (await page.$$eval('.event-card', els => els.length)) === 6);
    await page.evaluate(() => { localStorage.setItem('sm_age_group', '10s'); openEventDetail('imjin'); switchTab('shared'); });
    await page.waitForFunction(() => /첫 번째 제안|아직 등록된/.test(document.getElementById('sharedList').textContent));
    check('실제 라이브러리로 목록 조회 요청 (public_expressions RPC)', page.__api.some(a => a.method === 'POST' && /\/rpc\/public_expressions$/.test(a.url)));
    await page.fill('#userNarrative', '임진왜란은 일본의 침략으로 시작되어 조선과 명이 함께 맞선 전쟁이었다.');
    await page.click('#submitNarrative');
    await page.waitForFunction(() => /등록되었습니다|실패/.test(document.getElementById('submitStatus').textContent));
    check('실제 라이브러리로 등록 성공 (가짜 응답)', /등록되었습니다/.test(await page.$eval('#submitStatus', el => el.textContent)));
    const insert = page.__api.find(a => a.method === 'POST' && /\/rest\/v1\/shared_expressions\?/.test(a.url));
    check('등록 요청에 id·created_at을 보내지 않음 (DB 허용 컬럼과 호환)', insert && !/[?&,"]id[",&]/.test(decodeURIComponent(insert.url)) && !/created_at/.test(insert.url), insert && insert.url);
    check('등록 후 목록에 반영', (await page.$$eval('#sharedList .shared-item', els => els.length)) === 1);
    check('정상 경로에서 페이지 오류 없음', page.__errors.length === 0, page.__errors.join(' | '));
    await ok.context.close();

    /* ---------- 2. 네트워크 장애 (Supabase API 연결 실패) ---------- */
    const down = await openPage(browser, base, r => r.abort('internetdisconnected'), { width: 390, height: 844 });
    page = down.page;
    await page.goto(base + 'index.html');
    check('API 장애여도 페이지가 열림 (사건 카드 6개)', (await page.$$eval('.event-card', els => els.length)) === 6);
    check('API 장애 시 참여자 수 문구는 숨김', await page.$eval('#participantCount', el => el.hidden));
    await page.evaluate(() => { localStorage.setItem('sm_age_group', '10s'); openEventDetail('imjin'); switchTab('shared'); });
    await page.waitForFunction(() => /불러오지 못했습니다/.test(document.getElementById('sharedList').textContent));
    const listMsg = await page.$eval('#sharedList', el => el.textContent);
    check('목록 실패 시 네트워크 안내 표시', /네트워크에 연결할 수 없습니다/.test(listMsg), listMsg);
    await page.fill('#userNarrative', '네트워크가 끊긴 상태에서 쓴 문장입니다.');
    await page.click('#submitNarrative');
    await page.waitForFunction(() => /실패/.test(document.getElementById('submitStatus').textContent));
    const saveMsg = await page.$eval('#submitStatus', el => el.textContent);
    check('등록 실패 시 네트워크 안내 표시', /네트워크에 연결할 수 없습니다/.test(saveMsg), saveMsg);
    check('등록 실패 시 작성한 문장 유지', (await page.inputValue('#userNarrative')) === '네트워크가 끊긴 상태에서 쓴 문장입니다.');
    await page.click('.tab[data-tab="memory"]');
    check('공동 기억 지도 탭도 오류 안내로 표시', /불러오지 못해/.test(await page.$eval('#memoryResult', el => el.textContent)));
    await page.click('.tab[data-tab="ai"]');
    check('API 장애와 무관하게 서술 비교 분석 동작', (await page.$$eval('#aiGlance [data-glance-term]', els => els.length)) > 3);
    check('네트워크 장애 경로에서 페이지 오류 없음', page.__errors.length === 0, page.__errors.join(' | '));
    await down.context.close();
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
