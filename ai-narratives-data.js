/* ============================================================
   Shared Memory Project — ai-narratives-data.js
   '네 번째 서술자' — AI에게 같은 질문을 세 언어로 물은 답변 기록
   ============================================================
   · 이 파일은 답변 수집 스크립트가 채웁니다. 답변 원문을 손으로 고치거나 지어 넣지 마세요.
     사료를 다루는 원칙과 같습니다: 기록은 그대로 두고, 해석은 fourth-narrator-data.js의 observations에 따로 씁니다.
   · 화면은 실시간으로 AI를 부르지 않고 이 기록만 보여줍니다. 그래서 언제 접속해도 같은 결과가 나오고,
     AI 서비스가 멈춰도 화면이 동작합니다.
   · 아직 수집 전이면 records가 비어 있고, 화면에는 '기록 전'과 질문 원문만 보입니다.

   records 항목
     eventId       사건 id (events-data.js)
     lang          'ko' | 'ja' | 'zh' — 질문한 언어
     run           같은 질문의 몇 번째 물음인지 (1부터). 매번 새 대화로 묻습니다.
     prompt        실제로 보낸 질문 원문 (fourth-narrator-data.js의 questions와 같아야 함)
     answer        답변 원문 (수정하지 않음)
     translationKo 일본어·중국어 답변의 한국어 참고 번역 (같은 모델로 생성, 화면에 'AI 참고 번역'으로 표시). 한국어 답변은 null
     model         실제로 답한 모델 ID
     requestedModel   처음 요청한 모델 ID
     servedByFallback 처음 요청한 모델이 거절해 대체 모델이 답했으면 true
     translationModel 참고 번역을 만든 모델 ID (번역이 없으면 null)
     collectedAt   수집 시각 (ISO 8601, UTC)
     params        요청 설정 (시스템 프롬프트 없음, 모델 기본 설정)

   수집 방법: node tools/collect-ai-narratives.mjs --dry-run 으로 계획을 확인한 뒤 --dry-run 없이 실행 (API 키 필요)
   ============================================================ */

const aiNarrativesData = {
  questionsVersion: null,
  records: []
};

// Node 테스트 환경에서 불러올 수 있도록 내보냅니다 (브라우저에서는 무시됨)
if (typeof module === 'object' && module.exports) module.exports = aiNarrativesData;
