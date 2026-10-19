/* GitHub Actions 워크플로·테스트 의존성 점검 — 실행: npm test
   · CI 설정이 나중에 느슨해지지 않도록(권한 확대, 비밀 사용, SKIPPED 허용 등) 텍스트로 검사합니다. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WF = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

test('워크플로는 PR과 main push에서 실행된다', () => {
  assert.match(WF, /^on:\s*\n(?:.*\n)*?\s{2}pull_request:/m);
  assert.match(WF, /push:\s*\n\s+branches:\s*\[main\]/);
});

test('최소 권한(contents: read)만 쓰고 쓰기 권한·비밀 값을 쓰지 않는다', () => {
  assert.match(WF, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
  assert.doesNotMatch(WF, /:\s*write\b/);
  assert.doesNotMatch(WF, /secrets\./);
  assert.doesNotMatch(WF, /service_role|sb_secret_|SUPABASE_(SERVICE|SECRET)/i);
  assert.doesNotMatch(WF, /pull_request_target/);
});

test('npm ci로 설치하고 npm test와 npm run test:e2e를 실행한다', () => {
  assert.match(WF, /run:\s*npm ci/);
  assert.match(WF, /npm test\b/);
  assert.match(WF, /npm run -s test:e2e|npm run test:e2e/);
  assert.match(WF, /playwright install --with-deps chromium/);
});

test('테스트 0개·SKIPPED를 성공으로 처리하지 않는다', () => {
  assert.match(WF, /tests" -eq 0/);                    // 단위 테스트 0개면 실패
  assert.doesNotMatch(WF, /E2E_ALLOW_SKIP\s*[:=]\s*['"]?1/);
  assert.match(WF, /unset E2E_ALLOW_SKIP/);
  assert.match(WF, /set -o pipefail/);                 // tee로 로그를 남겨도 실패 코드 유지
  assert.doesNotMatch(WF, /continue-on-error:\s*true/);
});

test('공식 actions만 쓰고 커밋 SHA로 고정한다', () => {
  const uses = [...WF.matchAll(/uses:\s*([^\s#]+)/g)].map(m => m[1]);
  assert.ok(uses.length >= 4);
  uses.forEach(u => {
    assert.match(u, /^actions\/(checkout|setup-node|upload-artifact)@[0-9a-f]{40}$/, u);
  });
});

test('테스트 의존성 Playwright는 정확한 버전으로 고정되고 lockfile과 일치한다', () => {
  const v = PKG.devDependencies && PKG.devDependencies.playwright;
  assert.match(v, /^\d+\.\d+\.\d+$/, `정확한 버전이 아님: ${v}`);
  assert.equal(LOCK.packages['node_modules/playwright'].version, v);
  assert.equal(LOCK.packages['node_modules/playwright-core'].version, v);
  assert.match(LOCK.packages['node_modules/playwright'].integrity, /^sha512-/);
  assert.ok(!PKG.dependencies, '사이트 실행용 dependencies는 없어야 함 (정적 사이트)');
});

test('node_modules는 저장소에 올리지 않는다', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^node_modules\/?$/m);
});
