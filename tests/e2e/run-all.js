/* tests/e2e/*.e2e.js 를 모두 실행하고 요약합니다. — 실행: npm run test:e2e
   종료 코드: 0 = 모두 실제 실행·통과 / 1 = 하나라도 실패 / 2 = 실패는 없지만 실행하지 못한(SKIPPED) 테스트가 있음
   (E2E_ALLOW_SKIP=1 이면 SKIPPED가 있어도 0. 요약에는 SKIPPED로 그대로 표시합니다) */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.e2e.js')).sort();
if (!files.length) {
  console.log('E2E 테스트 파일이 없습니다 → 실패로 처리합니다.');
  process.exit(1);
}

const rows = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', env: Object.assign({}, process.env, { E2E_ALLOW_SKIP: '' }) });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  const line = (r.stdout || '').split('\n').reverse().find(l => l.startsWith('E2E_RESULT '));
  let result = null;
  try { result = line ? JSON.parse(line.slice('E2E_RESULT '.length)) : null; } catch (e) { result = null; }
  // 결과 줄이 없거나 종료 코드와 상태가 맞지 않으면 실패로 봅니다.
  const expected = { PASS: 0, FAIL: 1, SKIPPED: 2 };
  if (!result || expected[result.status] !== r.status) {
    result = { name: f, status: 'FAIL', error: `결과를 확인할 수 없음 (exit ${r.status})` };
  }
  rows.push(Object.assign({ file: f }, result));
}

console.log('\n=== E2E 요약 ===');
rows.forEach(r => {
  const counts = r.total != null ? `${r.passed}/${r.total}` : '-';
  console.log(`${r.status.padEnd(7)} ${r.file.padEnd(28)} ${counts.padEnd(7)} ${r.browser || ''} ${r.reason ? '(' + r.reason + ')' : ''}${r.error ? ' ' + r.error : ''}`);
});
const fail = rows.some(r => r.status === 'FAIL');
const skip = rows.some(r => r.status === 'SKIPPED');
if (fail) { console.log('\n결과: 실패'); process.exit(1); }
if (skip) {
  console.log('\n결과: 일부 테스트를 실행하지 못함 (SKIPPED) — 통과로 보지 마세요.');
  process.exit(process.env.E2E_ALLOW_SKIP === '1' ? 0 : 2);
}
console.log('\n결과: 모든 E2E가 브라우저에서 실제로 실행되어 통과');
process.exit(0);
