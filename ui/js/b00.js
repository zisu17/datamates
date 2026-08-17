/* ── b00 — ── b00 — Data Mates — 데이터 플랫폼 ── (index.html 블록에서 기계적 추출, 동작 불변) */


const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ic = (n, cls) => `<svg class="ic ${cls||''}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${n}"/></svg>`;
const ic14 = (n, cls) => `<svg class="ic ${cls||''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${n}"/></svg>`;

/* ── 시각 표시 (공통) ──────────────────────────────────────────
   화면에 시각을 그리는 곳은 전부 이 함수를 쓴다. 형식은 하나다:

       2026-08-12 14:45:08

   **KST 로 고정한다.** 보는 사람의 컴퓨터 시간대를 따르면(getHours 처럼) 같은
   실행 기록이 사람마다 다른 시각으로 보인다. 적재·실행 시각은 플랫폼의 사실이므로
   플랫폼 기준으로 읽혀야 한다.

   들어오는 값에는 시간대가 실려 있어야 한다(…Z · +09:00). 서버가 그렇게 준다 —
   시간대 없는 문자열을 넘기면 브라우저가 자기 지역 시각으로 읽어 어긋난다.
   상대 표현(«3분 전», «오늘»)을 쓰지 않는 이유는, 화면마다 기준이 갈리고
   기록을 서로 비교할 수 없기 때문이다. */
const DM_TZ = 'Asia/Seoul';

function fmtDT(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: DM_TZ, year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hour12: false }).formatToParts(d)
    .forEach(x => { p[x.type] = x.value; });
  // hourCycle 에 따라 자정이 24 로 나오는 구현이 있다.
  const hh = p.hour === '24' ? '00' : p.hour;
  return `${p.year}-${p.month}-${p.day} ${hh}:${p.minute}:${p.second}`;
}

/* 화면 상단의 기준 시각. */
function nowLabel() { return fmtDT(new Date()); }
function toast(msg, kind) {
  const t = el(`<div class="toast ${kind||''}">${ic(kind === 'err' ? 'xc' : kind === 'warn' ? 'alert' : 'checkc')}<span>${esc(msg)}</span></div>`);
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; setTimeout(() => t.remove(), 250); }, 2800);
}

/* ============================================================
   샘플 데이터 — 헬스케어 데이터 플랫폼
   ============================================================ */
const LAYER = {
  '원천':   { key:'src',  color:'var(--grays-gray)', tag:'mute', tech:'source' },
  '정제':   { key:'stg',  color:'var(--accents-indigo)', tag:'info', tech:'staging model' },
  '분석용': { key:'mart', color:'var(--accents-green)', tag:'ok',   tech:'mart model' },
};

/* 데이터 카탈로그. 부팅 때 /bootstrap 의 items 로 채워진다(api.js 의 D.splice). */
const D = [];
const byId = (id) => D.find(d => d.id === id);
const downOf = (id) => D.filter(d => (d.up || []).includes(id));

/* 데이터 검증 규칙 */
/* 데이터 검증 결과. 부팅 때 QRULES 에서 파생된다. */
const TESTS = [];

/* 파이프라인 */
/* 파이프라인. 부팅 때 /bootstrap 의 pipelines 로 채워진다. */
const PIPES = [];

/* 알림 · 내 작업 */
/* 알림. 부팅 뒤 파이프라인 상태에서 만들어진다(api.js 의 NOTIS.splice). */
const NOTIS = [];
/* 내 작업. 알림과 같은 자리에서 만들어진다. */
const MYTASKS = [];

/* ============================================================
   역할 · 상태
   ============================================================ */
/* 역할·권한은 두지 않는다.
   인증이 없는 설치형 단일 사용자 제품이라 데이터 엔지니어/분석가/현업/관리자는
   전부 지어낸 값이었고, 화면에서 버튼을 감추는 것 말고는 아무 것도 강제하지 못했다.
   R() 은 모두 사용 가능을 돌려주고, 호출부는 그대로 둔다 —
   나중에 인증을 붙이면 여기만 실제 권한으로 바꾸면 된다. */
const CAPS = { menus: ['home', 'ingest', 'modeling', 'pipeline', 'quality', 'analytics'],
               canModel: true, canPipeEdit: true, admin: false, tech: true };

/* 전역 네비게이션 순서 그대로다. 홈은 브랜드(Data Mates)가 맡으므로
   메뉴 줄에는 나머지만 나온다. (수집·분석 모듈의 중복 삽입은 각자 guard 가 있거나 제거했다) */
const MENUS = [
  { id:'home', label:'홈', icon:'home' },
  { id:'ingest', label:'데이터 수집', icon:'down' },
  { id:'modeling', label:'데이터 모델', icon:'model' },
  { id:'pipeline', label:'데이터 파이프라인', icon:'pipe' },
  { id:'quality', label:'데이터 품질', icon:'shield' },
  { id:'analytics', label:'데이터 분석', icon:'chart' },
];

const S = {
  role:'engineer', page:'home', env:'dev', org:'서울메디컬센터', project:'healthcare_dw',
  catalogQ:'', catalogLayer:'전체', catalogOnly:{ cert:false },
  detail:null, detailTab:'개요', showTech:true,
  pipe:null, quality:null,
  // 모델링 캔버스
  nodes:[], edges:[], sel:null, view:'canvas', dockTab:'preview', dockMin:false,
  runLog:[], runResult:null, testResult:null, dirty:false,
  sideOpen:true,
  leftOpen:true, rightOpen:true, leftW:264, rightW:322, dockH:224, zoom:1,
  catalogSel:null, pipeSel:null, qOpen:{}, savedHint:false,
};
/* 화면 폭 단계 — nar(<1180) 은 헤더 축약, xnar(<1040) 은 사이드바 아이콘 + 상세 오버레이 */
function widthTier() { const w = window.innerWidth; return { nar: w < 1180, xnar: w < 1040 }; }
const R = () => CAPS;
const ENVS = { dev:{ label:'개발', c:'var(--accents-indigo)' }, stg:{ label:'검증', c:'var(--accents-orange)' }, prod:{ label:'운영', c:'var(--accents-green)' } };

function qBadge(q){
  if (q === 'ok') return `<span class="bdg ok">${ic14('checkc')}정상</span>`;
  if (q === 'warn') return `<span class="bdg warn">${ic14('alert')}주의</span>`;
  return `<span class="bdg err">${ic14('xc')}오류</span>`;
}

/* ── 문서 탭 (공통 컴포넌트) ────────────────────────────────────
   **열고 닫는 문서 탭(.ptabs)** 을 만드는 곳은 여기를 부른다 —
   데이터 파이프라인 · 데이터 적재 · 데이터 분석.

   페이지마다 손으로 쓰던 탓에 규칙이 갈라져 있었다 — 높이가 45 / 45 / 43px 로
   달랐고, 제목 span 의 max-width 를 각자 지정해 탭 폭이 제목 길이에 따라 늘고
   줄었다. 폭·높이·말줄임·툴팁은 이제 이 함수와 app.css 의 .ptabs 규칙 한 쌍이
   정한다.

   섹션 전환 탭(홈·품질·모델 만들기·실행 이력)과 하단 독 탭(모델 상세·
   파이프라인 실행 상세)은 이 컴포넌트를 쓰지 않는다. 화면마다 사정이 달라
   따로 관리한다.

   o = { label, icon, on, closable, badge, attrs, faint, onClick, onClose } */
function tabBtn(o) {
  const b = el(`<button class="tab ${o.on ? 'on' : ''}" ${o.attrs || ''}>`
    + (o.icon ? ic14(o.icon, o.on ? '' : (o.faint ? 'fnt' : '')) : '')
    + `<span class="tab-l">${esc(o.label)}</span>`
    + (o.badge ? `<span class="t11" style="color:var(--err)">${esc(o.badge)}</span>` : '')
    + (o.closable ? `<span class="ptab-x" title="탭 닫기">${ic14('x')}</span>` : '')
    + '</button>');

  if (o.onClick || o.onClose) {
    b.onclick = (ev) => {
      if (o.onClose && ev.target.closest('.ptab-x')) { o.onClose(ev); return; }
      if (o.onClick) o.onClick(ev);
    };
  }
  return b;
}

/* 잘린 제목에만 툴팁으로 전체 글자를 보여준다.

   판단 시점이 마우스를 올리는 순간인 이유는, 탭을 만들 때는 아직 배치되지
   않아 폭이 0 이고 잘림 여부를 알 수 없기 때문이다. 잘리지 않은 제목까지
   툴팁을 달면 마우스를 올릴 때마다 같은 글자가 겹쳐 떠서 방해가 된다.

   문서 단위 위임인 이유는, 탭을 outerHTML 로 문자열에 심는 화면이 있어서다 —
   그렇게 만든 탭에는 개별 리스너가 남지 않는다. 위임하면 만드는 방식과
   무관하게 모든 탭에 적용된다. */
document.addEventListener('mouseover', (ev) => {
  const tab = ev.target.closest && ev.target.closest('.tab');
  if (!tab) return;
  const lab = $('.tab-l', tab);
  if (!lab) return;
  if (lab.scrollWidth > lab.clientWidth + 1) tab.title = lab.textContent;
  else tab.removeAttribute('title');
});

/* 탭 스트립. kind: 'doc'(열고 닫는 문서 탭) | 'sec'(섹션 전환) | 'q' | 'dock' */
function tabStrip(kind, style) {
  const cls = { doc: 'ptabs', sec: 'tabs', q: 'qtabs', dock: 'dock-h' }[kind] || 'tabs';
  return el(`<div class="${cls}"${style ? ` style="${style}"` : ''}></div>`);
}
