/* Shared Archive — 브라우저 E2E (가짜 Supabase 사용, 실제 DB 접속 없음)
   실행: node tests/e2e/shared-archive.e2e.js   (전체: npm run test:e2e)
   공개 동의 이후 제안만 카드로 표시 · 사건별 탐색 · 공감 연결 · 사건 탐구로 이동 ·
   링크/연락처가 담긴 문장 등록 차단 · 모바일 화면 */
'use strict';
const { run } = require('./harness');

// 가짜 DB 초기 데이터 (등록 순서 = 시간 순서)
const SEED = {
  shared_expressions: [
    { id: 201, event_key: 'imjin', author_name: '시범', country_code: 'ko', content: '동의 분리 전 시범 제안', created_at: '2026-10-08T03:00:00Z' },
    { id: 202, event_key: 'imjin', author_name: '하늘', country_code: 'ko', content: '침략의 피해와 <b>저항</b>을 함께 기억하는 전쟁', created_at: '2026-10-17T03:00:00Z' },
    { id: 203, event_key: 'zainichi', author_name: '익명', country_code: 'ja', content: '植民地支配の中で形成された共同体の記憶', created_at: '2026-10-18T03:00:00Z' }
  ],
  expression_participants: [],
  expression_empathy: [],
  nextId: 300
};

run('shared-archive', async ({ browser, base, check, mockPage, presetContinue }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(presetContinue);
  await context.addInitScript(seed => {
    if (!sessionStorage.getItem('__mock_db')) sessionStorage.setItem('__mock_db', JSON.stringify(seed));
  }, SEED);
  const page = await mockPage(context);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + 'index.html');

  const cardIds = () => page.$$eval('#archiveList .archive-card', els => els.map(e => e.dataset.expressionId));
  const waitList = () => page.waitForFunction(() => !/불러오는 중/.test(document.getElementById('archiveList').textContent));

  // 상단 메뉴 → 아카이브
  await page.click('.nav__menu a[data-page="archive"]');
  await waitList();
  check('상단 메뉴로 Shared Archive 화면 열림', await page.isVisible('.page--archive.active'));
  check('사건 6개를 고를 수 있음', (await page.$$eval('#archiveEventTabs [data-archive-event]', els => els.length)) === 6);
  check('처음에는 첫 사건(임진왜란) 선택', await page.$eval('#archiveEventTabs [aria-selected="true"]', el => el.dataset.archiveEvent) === 'imjin');
  let ids = await cardIds();
  check('공개 동의 분리 이후 제안만 카드로 표시 (시범 제안 제외)', ids.length === 1 && ids[0] === '202', ids.join(','));
  const text = await page.$eval('#archiveList .archive-card .shared-item__text', el => el.innerHTML);
  check('카드 문장은 HTML로 해석하지 않음', text.includes('&lt;b&gt;') && !(await page.$('#archiveList .archive-card b')), text);
  check('카드에 사건의 역사적 질문 표시', /역사적 질문/.test(await page.$eval('#archiveEventHead', el => el.textContent)));
  check('댓글 기능 없음', !(await page.$('.page--archive textarea, .page--archive [data-comment]')));

  // 공감
  await page.click('#archiveList [data-archive-empathy="202"]');
  await page.waitForFunction(() => /공감했어요/.test(document.querySelector('#archiveList [data-archive-empathy="202"]').textContent));
  const btn = await page.$eval('#archiveList [data-archive-empathy="202"]', el => ({ text: el.textContent.replace(/\s+/g, ' ').trim(), disabled: el.disabled }));
  check('공감하면 수가 1 오르고 다시 누를 수 없음', /공감했어요 · 1/.test(btn.text) && btn.disabled, btn.text);
  const empathyRows = await page.evaluate(() => window.__mockDb.read().expression_empathy);
  check('기존 공감 테이블에 1건 저장 (expression_id 202)', empathyRows.length === 1 && String(empathyRows[0].expression_id) === '202', JSON.stringify(empathyRows));

  // 사건 바꾸기
  await page.click('#archiveEventTabs [data-archive-event="zainichi"]');
  await page.waitForFunction(() => document.querySelector('#archiveList .archive-card')?.dataset.expressionId === '203');
  check('사건을 바꾸면 그 사건의 표현만 표시', (await cardIds()).join(',') === '203');
  check('작성 언어 표시', /日本語/.test(await page.$eval('#archiveList .archive-card', el => el.textContent)));
  await page.click('#archiveEventTabs [data-archive-event="culture"]');
  await page.waitForFunction(() => /아직 이 사건에 공개된/.test(document.getElementById('archiveList').textContent));
  check('공개된 표현이 없는 사건은 안내 문구', (await cardIds()).length === 0);

  // 사건 탐구로 이동
  await page.click('#archiveEventTabs [data-archive-event="imjin"]');
  await waitList();
  await page.click('[data-archive-explore="imjin"]');
  check('“이 사건 직접 탐구하기”로 사건 화면 열림', await page.isVisible('.page--detail.active') && await page.evaluate(() => currentEventId) === 'imjin');

  // 링크·연락처가 담긴 문장은 등록하지 않음
  await page.evaluate(() => localStorage.setItem('sm_age_group', '10s'));
  await page.click('#flowProgress [data-step-goto="3"]').catch(() => {});
  await page.click('.tab[data-tab="shared"]');
  const before = await page.evaluate(() => window.__mockDb.read().shared_expressions.length);
  await page.fill('#userNarrative', '임진왜란은 침략 전쟁이었다. 자세한 내용은 https://example.com 참고');
  await page.check('#publishConsent');
  await page.click('#submitNarrative');
  await page.waitForFunction(() => /링크/.test(document.getElementById('submitStatus').textContent));
  check('링크가 담긴 문장은 등록 차단', (await page.evaluate(() => window.__mockDb.read().shared_expressions.length)) === before);
  await page.fill('#userNarrative', '임진왜란은 침략 전쟁이었다. 연락은 010-1234-5678');
  await page.click('#submitNarrative');
  await page.waitForFunction(() => /전화번호/.test(document.getElementById('submitStatus').textContent));
  check('전화번호가 담긴 문장은 등록 차단', (await page.evaluate(() => window.__mockDb.read().shared_expressions.length)) === before);

  // 정상 등록 → 아카이브에 반영
  await page.fill('#userNarrative', '1592년부터 1598년까지 이어진 침략 전쟁의 피해를 함께 기억한다.');
  if (!(await page.isChecked('#publishConsent'))) await page.check('#publishConsent');
  await page.click('#submitNarrative');
  await page.waitForFunction(() => /등록되었습니다/.test(document.getElementById('submitStatus').textContent));
  await page.click('.nav__menu a[data-page="archive"]');
  await waitList();
  ids = await cardIds();
  check('새로 공개 등록한 표현이 아카이브 맨 앞에 표시', ids.length === 2 && ids[0] === '300', ids.join(','));
  check('데스크톱 흐름에서 페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await context.close();

  // 모바일
  const mctx = await browser.newContext({ viewport: { width: 375, height: 760 } });
  await mctx.addInitScript(seed => {
    if (!sessionStorage.getItem('__mock_db')) sessionStorage.setItem('__mock_db', JSON.stringify(seed));
  }, SEED);
  const m = await mockPage(mctx);
  const merrors = [];
  m.on('pageerror', e => merrors.push(e.message));
  await m.goto(base + 'index.html');
  const navFits = await m.evaluate(() => {
    const last = document.querySelector('.nav__menu a:last-child').getBoundingClientRect();
    return last.right <= window.innerWidth && document.documentElement.scrollWidth <= window.innerWidth;
  });
  check('모바일: 상단 메뉴 4개가 화면 안에 들어옴', navFits);
  await m.click('.nav__menu a[data-page="archive"]');
  await m.waitForFunction(() => document.querySelectorAll('#archiveList .archive-card').length === 1);
  check('모바일: 아카이브 가로 넘침 없음', await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  check('모바일에서 페이지 오류 없음', merrors.length === 0, merrors.join(' | '));
  await mctx.close();
});
