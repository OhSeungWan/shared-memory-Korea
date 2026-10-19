/* 네 번째 서술자 · 기억의 빈자리 — 브라우저 E2E (가짜 Supabase 사용, 실제 DB 접속 없음)
   실행: node tests/e2e/fourth-narrator.e2e.js   (전체: npm run test:e2e)
   AI 기록이 없을 때 '기록 전'과 질문 원문만 표시 · 세 나라만으로 빈자리 계산 · 비교 탭에서 이동 ·
   기록이 있을 때 답변 카드·회차 버튼·참고 번역·형식이 틀린 기록 제외 · HTML 이스케이프 · 모바일 화면
   · 기록이 있는 경우는 테스트 안에서만 ai-narratives-data.js 응답을 가짜(FAKE_) 기록으로 바꿔 확인합니다. 실제 AI 답변이 아닙니다. */
'use strict';
const { run } = require('./harness');

// 테스트 전용 기록: 일본어 3회(형식 맞음) + 중국어 1회(질문이 바뀐 기록 → 화면에서 빠져야 함)
const FAKE_AI_FILE = `
const aiNarrativesData = {
  questionsVersion: fourthNarratorData.questionsVersion,
  records: [1, 2, 3].map(run => ({
    eventId: 'hiroshima', lang: 'ja', run,
    prompt: fourthNarratorData.questions.hiroshima.ja,
    answer: 'FAKE_テスト回答' + run + (run === 1 ? ' 朝鮮人も被害を受けた。<b>太字</b>' : ' 多くの市民が被害を受けた。'),
    translationKo: 'FAKE_참고 번역 ' + run,
    model: 'test-model', collectedAt: '2026-10-22T00:00:00Z', params: {}
  })).concat([{
    eventId: 'hiroshima', lang: 'zh', run: 1, prompt: '바뀐 질문',
    answer: 'FAKE_被篡改的记录', translationKo: null,
    model: 'test-model', collectedAt: '2026-10-22T00:00:00Z', params: {}
  }])
};`;

run('fourth-narrator', async ({ browser, base, check, mockPage, presetContinue }) => {
  async function openFourth(context, eventId) {
    const page = await mockPage(context);
    await page.goto(base + 'index.html#/e/' + eventId);
    await page.waitForSelector('#flowProgress [data-step-goto="2"]');
    await page.click('#flowProgress [data-step-goto="2"]');
    return page;
  }

  // 1) 기록 없음 (실제 배포 상태)
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(presetContinue);
  const page = await openFourth(ctx, 'hiroshima');
  check('비교 탭에 네 번째 서술자 안내 버튼', await page.isVisible('[data-tab-content="compare"] .fourth-cta'));
  await page.click('[data-tab-content="compare"] .fourth-cta');
  check('안내 버튼으로 네 번째 서술자 탭 열림', await page.isVisible('[data-tab-content="fourth"].active'));
  check('탐구 단계는 STEP 2 유지', await page.$eval('.page--detail', el => el.dataset.step) === '2');
  check('기록이 없으면 "기록 전" 안내', /아직 기록 전/.test(await page.textContent('#fourthNarrator')));
  check('AI 답변 카드는 없음 (답변을 지어 넣지 않음)', !(await page.$('#fourthNarrator .fourth-card')));
  check('세 언어 질문 원문 표시', (await page.$$eval('#fourthNarrator .fourth-q', els => els.length)) === 3);
  const heads = await page.$$eval('#memoryGaps thead th', els => els.map(e => e.textContent.trim()));
  check('빈자리 표는 세 나라만 비교', heads.join('|') === '요소|한국 측|일본 측|중국 측', heads.join('|'));
  const victims = await page.$$eval('#memoryGaps tbody tr', rows => {
    const r = rows.find(x => /조선인 피해자/.test(x.querySelector('th').textContent));
    return r ? [...r.querySelectorAll('td')].map(td => td.className.replace('gap-cell ', '')) : null;
  });
  check('조선인 피해자: 일본 측 요약이 빈자리', victims && victims.join(',') === 'gap-cell--present,gap-cell--gap,gap-cell--present', String(victims));
  check('빈자리 요약 문장에 일본 측·조선인 피해자', /일본 측에는 ‘조선인 피해자’/.test(await page.textContent('#memoryGaps .gap-summary')));
  check('계산 방법과 한계 안내', /왜곡이나 의도를 뜻하지 않습니다/.test(await page.textContent('#memoryGaps')));
  await page.click('.tab[data-tab="compare"]');
  await page.click('.tab[data-tab="fourth"]');
  check('탭 메뉴로도 열림', await page.isVisible('#memoryGaps .gap-table'));
  check('페이지 오류 없음 (기록 없음)', page.__errors.length === 0, page.__errors.join(' / '));
  await ctx.close();

  // 2) 기록이 있을 때 (테스트 전용 가짜 기록)
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx2.addInitScript(presetContinue);
  const page2 = await mockPage(ctx2);
  await page2.route(/ai-narratives-data\.js/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE_AI_FILE }));
  await page2.goto(base + 'index.html#/e/hiroshima');
  await page2.waitForSelector('#flowProgress [data-step-goto="2"]');
  await page2.click('#flowProgress [data-step-goto="2"]');
  await page2.click('.tab[data-tab="fourth"]');
  const cards = await page2.$$eval('#fourthNarrator .fourth-card .fourth-card__title', els => els.map(e => e.textContent.trim()));
  check('형식이 맞는 일본어 기록만 카드로 표시 (질문이 바뀐 중국어 기록 제외)', cards.join('|') === 'AI · 일본어로 물었을 때', cards.join('|'));
  check('회차 버튼 3개', (await page2.$$eval('#fourthNarrator [data-ai-run]', els => els.length)) === 3);
  const answer1 = await page2.$eval('#fourthNarrator .fourth-card__answer', el => el.innerHTML);
  check('답변은 HTML로 해석하지 않음', answer1.includes('&lt;b&gt;') && !(await page2.$('#fourthNarrator .fourth-card__answer b')), answer1);
  await page2.click('#fourthNarrator [data-ai-run="2"]');
  check('회차를 바꾸면 그 답변 표시', /FAKE_テスト回答2/.test(await page2.textContent('#fourthNarrator .fourth-card__answer')));
  check('바꾼 회차 버튼이 눌린 상태', await page2.$eval('#fourthNarrator [data-ai-run="2"]', el => el.getAttribute('aria-pressed')) === 'true');
  check('한국어 참고 번역 (AI 번역) 표시', /FAKE_참고 번역 2/.test(await page2.textContent('#fourthNarrator .fourth-card__translation')));
  check('모델·수집일 표시', /모델 test-model/.test(await page2.textContent('#fourthNarrator .fourth-card__meta')));
  const heads2 = await page2.$$eval('#memoryGaps thead th', els => els.map(e => e.textContent.trim()));
  check('빈자리 표에 AI(일본어) 열 추가, 중국어 열 없음', heads2.join('|') === '요소|한국 측|일본 측|중국 측|AI · 일본어', heads2.join('|'));
  const aiCell = await page2.$$eval('#memoryGaps tbody tr', rows => {
    const r = rows.find(x => /조선인 피해자/.test(x.querySelector('th').textContent));
    const td = r.querySelectorAll('td')[3];
    return { cls: td.className, text: td.textContent };
  });
  check('3회 중 1회만 나온 요소는 없음으로 보고 횟수 표시', /gap-cell--gap/.test(aiCell.cls) && /1\/3/.test(aiCell.text), JSON.stringify(aiCell));
  check('페이지 오류 없음 (기록 있음)', page2.__errors.length === 0, page2.__errors.join(' / '));
  await ctx2.close();

  // 3) 모바일
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx3.addInitScript(presetContinue);
  const page3 = await openFourth(ctx3, 'imjin');
  await page3.click('.tab[data-tab="fourth"]');
  check('모바일에서 빈자리 표 표시', await page3.isVisible('#memoryGaps .gap-table'));
  const overflow = await page3.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('모바일 폭에서 가로 넘침 없음 (표는 상자 안에서만 스크롤)', overflow <= 1, `넘침 ${overflow}px`);
  check('페이지 오류 없음 (모바일)', page3.__errors.length === 0, page3.__errors.join(' / '));
  await ctx3.close();
});
