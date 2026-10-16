/* 주요 기능 회귀 확인 — 브라우저 E2E (가짜 Supabase 사용, 실제 DB 접속 없음)
   실행: node tests/e2e/regression-smoke.e2e.js
   사건 6개 · 국가별 서술 · TF-IDF/유사도 · 사료 연결 · 공동 표현 작성/검증 · 저장/조회 · 공감 ·
   공동 기억 지도 · 세대별 분석/소표본 보호 · 4개 언어 · 모바일 화면 */
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

async function newPage(context, base) {
  const page = await context.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route(url => !url.href.startsWith(base), r => r.abort());
  await page.route(/supabase-js|vendor\/supabase/, r => r.fulfill({ contentType: 'text/javascript', body: MOCK }));
  return page;
}

async function submit(page, text, lang) {
  await page.click('.tab[data-tab="shared"]');
  if (lang) {
    const on = await page.$eval(`[data-writing-lang="${lang}"]`, el => el.classList.contains('is-selected'));
    if (!on) await page.click(`[data-writing-lang="${lang}"]`);
  }
  await page.fill('#userNarrative', text);
  await page.click('#submitNarrative');
  await page.waitForFunction(() => /등록되었습니다|실패|빈칸|역사 용어/.test(document.getElementById('submitStatus').textContent));
  return page.$eval('#submitStatus', el => el.textContent);
}

(async () => {
  const { chromium } = loadPlaywright();
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  let exitCode = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await newPage(context, base);
    await page.goto(base + 'index.html');
    await page.evaluate(() => localStorage.setItem('sm_age_group', '10s'));

    // 사건 6개
    await page.click('.nav__menu a[data-view="participate"]');
    const ids = await page.$$eval('.event-card', els => els.map(e => e.dataset.eventId));
    check('사건 6개 표시 (임진왜란 → 재일조선인 순)', ids.length === 6 && ids[0] === 'imjin' && ids[1] === 'zainichi', ids.join(','));
    for (const id of ids) {
      await page.evaluate(i => openEventDetail(i), id);
      const n = await page.$$eval('.narrative-card', els => els.length);
      if (n !== 3) check(`${id}: 국가별 서술 3개`, false, String(n));
    }
    check('모든 사건에서 국가별 서술 3개 표시', true);

    // 국가별 서술 · TF-IDF · 유사도 · 근거 · 사료
    await page.evaluate(() => openEventDetail('imjin'));
    await page.click('.tab[data-tab="ai"]');
    check('한눈에 비교 표시', (await page.$$eval('#aiGlance [data-glance-term]', els => els.length)) > 3);
    await page.click('#aiAnalyzeBtn');
    const ai = await page.$eval('#aiResult', el => el.innerText);
    check('TF-IDF 키워드·코사인·Jaccard 표시', /TF-IDF/.test(ai) && /코사인/.test(ai) && /Jaccard/.test(ai));
    await page.click('#aiResult [data-nlp-term="침략"]');
    check('단어 선택 시 원문 근거 강조', (await page.$$eval('#nlpEvidence mark', els => els.length)) > 0);
    check('근거 아래 관련 사료 연결', (await page.$$eval('#nlpEvidence [data-goto-source]', els => els.length)) > 0);
    await page.click('#nlpEvidence [data-goto-source]');
    check('사료 카드로 이동', await page.isVisible('.source-card.is-focused'));
    await page.click('.source-card [data-evidence-term]');
    check('사료 → 분석 근거로 이동', await page.isVisible('#nlpEvidence'));

    // 입력값 검증
    let status = await submit(page, '이 사건은 ______로 시작되어, 조선이 참여한 전쟁이었다.');
    check('빈칸이 남은 문장은 제출 차단', /빈칸/.test(status), status);
    status = await submit(page, '1592년 일본이 대한민국을 침략한 전쟁이었다.');
    check('역사 용어 확인 안내 (비차단)', /역사 용어/.test(status), status);

    // 4개 언어 저장 · 조회
    const texts = [
      ['ko', '임진왜란은 일본의 침략으로 시작되어 조선과 명이 함께 맞선 전쟁이었다.'],
      ['zh', '万历朝鲜战争是日本侵略朝鲜引发的东亚国际战争。'],
      ['ja', '文禄・慶長の役は日本の出兵によって始まった東アジアの戦争である。'],
      ['en', 'The Imjin War began with the Japanese invasion of Joseon in 1592.']
    ];
    for (const [lang, t] of texts) {
      status = await submit(page, t, lang);
      if (!/등록되었습니다/.test(status)) check(`${lang} 제출`, false, status);
    }
    const db = await page.evaluate(() => window.__mockDb.read());
    const langs = db.shared_expressions.map(r => r.country_code).sort().join(',');
    check('한국어·중국어·일본어·영어 제출 저장', langs.includes('en') && langs.includes('ja') && langs.includes('ko') && langs.includes('zh'), langs);
    // 역사 용어 안내 문장은 첫 클릭에서 저장되지 않으므로(안내 후 재확인) 4개 언어 4건만 저장
    check('저장된 행 수 = 4 (용어 안내 문장은 확인 전 미저장)', db.shared_expressions.length === 4, String(db.shared_expressions.length));
    check('등록된 제안 목록 조회', (await page.$$eval('#sharedList .shared-item', els => els.length)) === 4);
    await page.click('[data-shared-language="zh"]');
    check('언어 필터 (中文)', (await page.$$eval('#sharedList .shared-item', els => els.length)) === 1);
    await page.click('[data-shared-language="all"]');

    // 공감
    await page.click('#sharedList [data-empathy-id]');
    await page.waitForTimeout(200);
    check('공감 등록', (await page.evaluate(() => window.__mockDb.read().expression_empathy.length)) === 1 &&
      await page.isVisible('#sharedList .shared-item__action.is-done'));

    // 공동 기억 지도 · 세대별 분석 · 소표본 보호
    await page.click('.tab[data-tab="memory"]');
    const memory = await page.$eval('#memoryResult', el => el.innerText);
    check('공동 기억 지도 분석 표시', /전체 제안/.test(memory) && /세대별 표현 차이/.test(memory));
    check('5명 미만 연령대는 세부 분석 숨김', /5명 미만|표본이 적어/.test(memory));
    await page.click('[data-age-filter="10s"]');
    check('연령대 필터 (소표본 안내)', /표본이 적어/.test(await page.$eval('#memoryResult', el => el.innerText)));
    check('데스크톱 흐름에서 페이지 오류 없음', page.__errors.length === 0, page.__errors.join(' | '));

    // 모바일
    const mobile = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const m = await newPage(mobile, base);
    await m.goto(base + 'index.html');
    const overflow = [];
    for (const tab of ['compare', 'ai', 'sources', 'shared', 'memory']) {
      await m.evaluate(t => { openEventDetail('zainichi'); switchTab(t); }, tab);
      await m.waitForTimeout(150);
      if (await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) overflow.push(tab);
    }
    check('모바일 375px: 모든 탭 가로 넘침 없음', overflow.length === 0, overflow.join(','));
    check('모바일에서 페이지 오류 없음', m.__errors.length === 0, m.__errors.join(' | '));
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
