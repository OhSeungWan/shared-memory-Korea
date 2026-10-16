// Supabase 공개(publishable) 키 — 브라우저용 공개 키입니다. 데이터 보호는 RLS 정책이 담당합니다.
// service_role 키나 비밀 키는 절대 이 파일(브라우저 코드)에 넣지 마세요.
const SUPABASE_URL =
  "https://qidaaofhfqliwtnqipkp.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_eHYYDHSkRHyE7dGkMyVX7Q_FADlbe5C";

// supabase-js는 vendor/supabase-js/supabase.js(저장소 내 보관, 버전 고정)에서 불러옵니다.
// 그래도 불러오지 못한 경우에는 페이지의 나머지 기능이 동작하도록 null로 둡니다.
const db = (window.supabase && typeof window.supabase.createClient === 'function')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
