/* 공용 기기 참여자 분리 테스트 (새 참여자로 시작 · 저장소를 쓸 수 없는 환경) — 실행: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');

global.self = global.self || {};
require('../shared-store.js');
const Store = global.self.SharedStore;

/** localStorage 흉내 (length/key 포함) */
function fakeLocalStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    _map: map
  };
}

function useStorage(ls) {
  Object.defineProperty(global.self, 'localStorage', { value: ls, configurable: true, writable: true });
}

test('새 참여자로 시작: Shared Memory(sm_) 키만 지우고 다른 사이트의 저장소는 그대로 둔다', () => {
  const ls = fakeLocalStorage({ other_site_token: 'keep-me', theme: 'dark' });
  useStorage(ls);
  // 학생 A의 상태
  Store.storageSet('sm_age_group', '10s');
  Store.storageSet('sm_before_imjin', '일본이 조선을 침략한 전쟁');
  Store.storageSet('sm_before_prior_imjin', 'yes');
  Store.storageSet('sm_flow_imjin', JSON.stringify({ viewedCompare: true, submitted: true }));
  Store.storageSet('sm_empathized', JSON.stringify(['3']));
  const keyA = Store.participantKey();
  const voterA = Store.voterKey();
  assert.equal(Store.hasParticipantState(), true);

  const r = Store.resetParticipant();
  assert.equal(r.removed, 7);
  assert.deepEqual([...ls._map.keys()].sort(), ['other_site_token', 'theme']);
  assert.equal(Store.hasParticipantState(), false);
  ['sm_age_group', 'sm_before_imjin', 'sm_before_prior_imjin', 'sm_flow_imjin'].forEach(k => assert.equal(Store.storageGet(k), null, k));
  assert.equal(Store.empathizedSet().size, 0);

  // 학생 B는 새 키를 받는다
  const keyB = Store.participantKey();
  const voterB = Store.voterKey();
  assert.notEqual(keyB, keyA);
  assert.notEqual(voterB, voterA);
  assert.ok(keyB.length >= 8);
});

test('같은 학생이 계속하는 경우(초기화하지 않음): 참여자 키와 상태가 유지된다 (새로고침 = 같은 저장소)', () => {
  const ls = fakeLocalStorage();
  useStorage(ls);
  Store.storageSet('sm_age_group', '10s');
  const k1 = Store.participantKey();
  // 새로고침을 흉내: 같은 localStorage를 다시 읽음
  assert.equal(Store.participantKey(), k1);
  assert.equal(Store.storageGet('sm_age_group'), '10s');
  assert.equal(ls.getItem('sm_participant_key'), k1);
});

test('초기화 후 새로고침해도 이전 참여자의 상태가 되살아나지 않는다', () => {
  const ls = fakeLocalStorage();
  useStorage(ls);
  Store.storageSet('sm_before_imjin', 'A의 문장');
  const keyA = Store.participantKey();
  Store.resetParticipant();
  const keyB = Store.participantKey();
  // 새로고침: 같은 저장소를 새로 읽어도 B의 키, A의 문장은 없음
  assert.equal(ls.getItem('sm_participant_key'), keyB);
  assert.notEqual(keyB, keyA);
  assert.equal(ls.getItem('sm_before_imjin'), null);
});

test('localStorage 접근 자체가 막힌 환경(SecurityError)에서도 오류 없이 페이지 안에서만 유지된다', () => {
  Object.defineProperty(global.self, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
  assert.doesNotThrow(() => Store.storageSet('sm_age_group', '20s'));
  assert.equal(Store.storageGet('sm_age_group'), '20s');           // 메모리에 보관
  const k1 = Store.participantKey();
  assert.equal(Store.participantKey(), k1);                         // 같은 페이지에서는 같은 키
  assert.equal(Store.hasParticipantState(), true);
  assert.doesNotThrow(() => Store.resetParticipant());
  assert.equal(Store.storageGet('sm_age_group'), null);
  assert.notEqual(Store.participantKey(), k1);
});

test('localStorage가 없거나 쓰기만 실패(용량 초과)해도 동작한다', () => {
  useStorage(undefined);
  Store.storageSet('sm_flow_imjin', '{"submitted":true}');
  assert.equal(Store.storageGet('sm_flow_imjin'), '{"submitted":true}');
  Store.resetParticipant();
  assert.equal(Store.storageGet('sm_flow_imjin'), null);

  const ls = fakeLocalStorage();
  ls.setItem = () => { throw new Error('QuotaExceededError'); };
  useStorage(ls);
  Store.storageSet('sm_age_group', '10s');
  assert.equal(Store.storageGet('sm_age_group'), '10s');           // 메모리로 대체
  assert.deepEqual(Store.participantStorageKeys(), ['sm_age_group']);
  Store.resetParticipant();
  assert.equal(Store.storageGet('sm_age_group'), null);
});

test('초기화 후 B의 제출은 B의 새 참여자 키로 연결되고, DB 쪽 삭제 요청은 보내지 않는다', async () => {
  useStorage(fakeLocalStorage());
  const keyA = Store.participantKey();
  Store.resetParticipant();
  const calls = [];
  global.db = {
    from(table) {
      return {
        insert(rows) {
          calls.push({ table, op: 'insert', row: rows[0] });
          const p = Promise.resolve({ data: null, error: null });
          p.select = () => Promise.resolve({ data: [{ id: 11 }], error: null });
          return p;
        },
        delete() { calls.push({ table, op: 'delete' }); return Promise.resolve({ error: null }); },
        update() { calls.push({ table, op: 'update' }); return Promise.resolve({ error: null }); }
      };
    }
  };
  try {
    const r = await Store.insertExpression({ eventKey: 'imjin', content: 'B의 문장', before: '', ageGroup: '10s', milestones: {} });
    assert.equal(r.ok, true);
    assert.equal(calls[0].row.before_content, null);                  // A의 탐구 전 문장이 섞이지 않음
    const link = calls.find(c => c.table === 'expression_participants');
    assert.notEqual(link.row.participant_key, keyA);
    assert.equal(link.row.participant_key, Store.participantKey());
    assert.ok(calls.every(c => c.op === 'insert'));                   // 기존 데이터 삭제·수정 없음
  } finally {
    delete global.db;
  }
});
