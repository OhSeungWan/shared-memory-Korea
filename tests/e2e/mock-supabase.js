/* 브라우저 E2E 테스트용 가짜 Supabase 클라이언트 (실제 DB에 접속하지 않음)
   · e2e 스크립트가 supabase-js 요청을 이 파일로 바꿔 끼웁니다.
   · 데이터는 sessionStorage('__mock_db')에 보관해 새로고침 후에도 유지됩니다. (사이트의 'sm_' 키와 겹치지 않음) */
(function () {
  'use strict';
  const KEY = '__mock_db';
  function load() {
    try { return JSON.parse(sessionStorage.getItem(KEY)) || { shared_expressions: [], expression_participants: [], expression_empathy: [], nextId: 100 }; }
    catch (e) { return { shared_expressions: [], expression_participants: [], expression_empathy: [], nextId: 100 }; }
  }
  function save(db) { try { sessionStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 무시 */ } }
  window.__mockDb = { read: load, failInsert: false, calls: [] };

  function insert(table, rows) {
    const db = load();
    window.__mockDb.calls.push({ op: 'insert', table, rows });
    let result;
    if (window.__mockDb.failInsert && table === 'shared_expressions') {
      result = { data: null, error: { code: 'NETWORK', message: 'Failed to fetch' } };
    } else {
      const saved = rows.map(r => Object.assign({}, r, table === 'shared_expressions'
        ? { id: db.nextId++, created_at: new Date().toISOString() } : {}));
      db[table] = (db[table] || []).concat(saved);
      save(db);
      result = { data: saved.map(r => ({ id: r.id })), error: null };
    }
    const p = Promise.resolve({ data: null, error: result.error });
    p.select = () => Promise.resolve(result);
    return p;
  }

  function select(table) {
    const q = { filters: [] };
    const chain = {
      select() { return chain; },
      eq(col, val) { q.filters.push([col, val]); return chain; },
      order() { return chain; },
      limit() {
        const rows = (load()[table] || []).filter(r => q.filters.every(([c, v]) => r[c] === v)).reverse();
        return Promise.resolve({ data: rows, error: null });
      }
    };
    return chain;
  }

  function rpc(name, args) {
    const db = load();
    window.__mockDb.calls.push({ op: 'rpc', name, args });
    const rows = db.shared_expressions.filter(r => !args || !args.p_event_key || r.event_key === args.p_event_key);
    if (name === 'public_expressions') {
      return Promise.resolve({ data: rows.slice().reverse().map(r => Object.assign({ age_group_suppressed: false }, r)), error: null });
    }
    if (name === 'empathy_counts') {
      const counts = {};
      db.expression_empathy.forEach(e => { counts[e.expression_id] = (counts[e.expression_id] || 0) + 1; });
      return Promise.resolve({ data: Object.keys(counts).map(id => ({ expression_id: Number(id), empathy_count: counts[id] })), error: null });
    }
    if (name === 'participation_summary') {
      const keys = new Set(db.expression_participants.map(p => p.participant_key));
      return Promise.resolve({ data: [{ participants: keys.size, completed_participants: keys.size, expressions: db.shared_expressions.length }], error: null });
    }
    if (name === 'age_group_participants') {
      const by = {};
      rows.forEach(r => { const g = r.age_group || 'unknown'; by[g] = (by[g] || 0) + 1; });
      return Promise.resolve({ data: Object.keys(by).map(g => ({ age_group: g, participants: by[g] < 5 && g !== 'unknown' ? null : by[g] })), error: null });
    }
    return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
  }

  window.supabase = {
    createClient() {
      return {
        from(table) {
          return { insert: rows => insert(table, rows), select: () => select(table).select() };
        },
        rpc
      };
    }
  };
})();
