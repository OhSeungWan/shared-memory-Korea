/* 프로젝트 Claude Code 설정 점검 — 운영 DB를 바꿀 수 있는 도구가 자동 허용되지 않는지 확인합니다. 실행: npm test
   · 이 테스트는 저장소의 .claude/settings.json만 검사합니다. 사용자·전역 설정이나 세션 권한 모드는 검사할 수 없습니다. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', '.claude', 'settings.json');
const settings = JSON.parse(fs.readFileSync(FILE, 'utf8'));   // JSON 문법 오류면 여기서 실패
const allow = (settings.permissions && settings.permissions.allow) || [];
const ask = (settings.permissions && settings.permissions.ask) || [];

// 데이터·스키마·배포·프로젝트 상태를 바꿀 수 있는 Supabase MCP 도구
const SUPABASE_WRITE = [
  'mcp__Supabase__execute_sql',
  'mcp__Supabase__apply_migration',
  'mcp__Supabase__deploy_edge_function',
  'mcp__Supabase__create_edge_function_secret',
  'mcp__Supabase__create_branch',
  'mcp__Supabase__delete_branch',
  'mcp__Supabase__merge_branch',
  'mcp__Supabase__reset_branch',
  'mcp__Supabase__rebase_branch',
  'mcp__Supabase__create_project',
  'mcp__Supabase__pause_project',
  'mcp__Supabase__restore_project'
];
const SUPABASE_READ = [
  'mcp__Supabase__list_projects',
  'mcp__Supabase__get_project',
  'mcp__Supabase__list_tables',
  'mcp__Supabase__list_migrations',
  'mcp__Supabase__list_extensions',
  'mcp__Supabase__get_advisors'
];

test('.claude/settings.json은 올바른 JSON이고 permissions 목록은 배열이다', () => {
  assert.ok(Array.isArray(allow));
  assert.ok(Array.isArray(ask));
});

test('운영 DB를 바꿀 수 있는 Supabase 도구는 자동 허용(allow)에 없다', () => {
  SUPABASE_WRITE.forEach(tool => assert.ok(!allow.includes(tool), `${tool}가 자동 허용됨`));
  // 와일드카드로 한꺼번에 허용하는 것도 막습니다 (예: "mcp__Supabase", "mcp__Supabase__*")
  allow.forEach(rule => assert.doesNotMatch(rule, /^mcp__Supabase(__\*)?$|^mcp__\*?$|^\*$/, `광범위한 허용 규칙: ${rule}`));
});

test('Supabase 쓰기 도구는 ask에 있어 실행 전에 확인을 요구한다', () => {
  SUPABASE_WRITE.forEach(tool => assert.ok(ask.includes(tool), `${tool}가 ask에 없음`));
});

test('기존 읽기 전용 조회 도구는 그대로 허용된다', () => {
  SUPABASE_READ.forEach(tool => assert.ok(allow.includes(tool), `${tool}가 허용 목록에서 빠짐`));
  assert.deepEqual(allow.filter(t => t.startsWith('mcp__Supabase__')).sort(), SUPABASE_READ.slice().sort());
});

test('명령 실행·파일 쓰기 같은 광범위한 자동 허용이 없다', () => {
  allow.forEach(rule => assert.doesNotMatch(rule, /^(Bash|Write|Edit|NotebookEdit)(\(\*\))?$/, `광범위한 허용 규칙: ${rule}`));
  assert.notEqual(settings.permissions && settings.permissions.defaultMode, 'bypassPermissions');
});
