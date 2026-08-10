/* ── b00 — ── b00 — Data Mates — 데이터 플랫폼 ── (index.html 블록에서 기계적 추출, 동작 불변) */

/* ============================================================
   Data Mates — 데이터 플랫폼
   dbt 를 실행 엔진으로 쓰는 데이터 플랫폼. 역할별로 메뉴와 기능이 달라진다.
   데이터는 파일 끝 v4.0 — API 연결 블록이 서버에서 받아 채운다.
   ============================================================ */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const el = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ic = (n, cls) => `<svg class="ic ${cls||''}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${n}"/></svg>`;
const ic14 = (n, cls) => `<svg class="ic ${cls||''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${n}"/></svg>`;

/* 화면 상단의 기준 시각. 예제에서는 날짜가 박혀 있었다. */
function nowLabel() {
  const d = new Date(), w = '일월화수목금토'[d.getDay()];
  const p = (n) => String(n).padStart(2, '0');
  const h = d.getHours();
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} (${w}) `
       + `${h < 12 ? '오전' : '오후'} ${p(h % 12 || 12)}:${p(d.getMinutes())}`;
}
function toast(msg, kind) {
  const t = el(`<div class="toast ${kind||''}">${ic(kind === 'err' ? 'xc' : kind === 'warn' ? 'alert' : 'checkc')}<span>${esc(msg)}</span></div>`);
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; setTimeout(() => t.remove(), 250); }, 2800);
}

/* ============================================================
   샘플 데이터 — 헬스케어 데이터 플랫폼
   ============================================================ */
const LAYER = {
  '원천':   { key:'src',  color:'#94A3B8', tag:'mute', tech:'source' },
  '정제':   { key:'stg',  color:'#6366F1', tag:'info', tech:'staging model' },
  '분석용': { key:'mart', color:'#0E9F6E', tag:'ok',   tech:'mart model' },
};

const D = [
  { id:'src_patient', name:'환자 원천 데이터', phys:'raw_hospital.patient', layer:'원천', kind:'source',
    desc:'병원 운영시스템에서 매일 들어오는 환자 등록 원본입니다. 가공 전 상태라 분석에는 정제 데이터를 쓰세요.',
    owner:'이지훈', team:'데이터플랫폼팀', updated:'오늘 04:12', freq:'매일 04:00', rows:'128,402',
    quality:'ok', certified:false, usable:true, fav:false, mat:'—', tags:['원천','환자'],
    cols:[['patient_id','환자번호','STRING','필수'],['patient_nm','환자명','STRING','필수'],['birth_dt','생년월일','DATE','선택'],
          ['gender_cd','성별코드','STRING','선택'],['reg_dtm','등록일시','TIMESTAMP','필수'],['hospital_cd','병원코드','STRING','필수']],
    prev:[['P00012841','김*수','1978-03-11','M','2026-08-04 04:02','H01'],['P00012842','박*연','1991-11-02','F','2026-08-04 04:02','H01'],
          ['P00012843','정*호','1965-07-24','M','2026-08-04 04:03','H02']] },

  { id:'src_exam_result', name:'검사 결과 원천 데이터', phys:'raw_hospital.examination_result', layer:'원천', kind:'source',
    desc:'검체 검사 장비에서 올라오는 검사 결과 원본입니다. 단위와 코드 표기가 병원별로 달라 정제가 필요합니다.',
    owner:'이지훈', team:'데이터플랫폼팀', updated:'오늘 04:20', freq:'매일 04:00', rows:'2,904,118',
    quality:'ok', certified:false, usable:true, fav:false, mat:'—', tags:['원천','검사'],
    cols:[['result_id','결과번호','STRING','필수'],['patient_id','환자번호','STRING','필수'],['exam_cd','검사코드','STRING','필수'],
          ['result_val','결과값','DECIMAL','선택'],['unit_cd','단위코드','STRING','선택'],['exam_dtm','검사일시','TIMESTAMP','필수']],
    prev:[['R2026080400121','P00012841','L3021','5.8','mmol/L','2026-08-04 08:12'],['R2026080400122','P00012841','L1102','142','mg/dL','2026-08-04 08:12'],
          ['R2026080400123','P00012842','L3021','4.9','MMOL/L','2026-08-04 08:40']] },

  { id:'src_exam_order', name:'검사 처방 원천 데이터', phys:'raw_hospital.examination_order', layer:'원천', kind:'source',
    desc:'의사가 낸 검사 처방 원본입니다. 검사 결과와 연결해 처방 대비 실시율을 볼 때 사용합니다.',
    owner:'이지훈', team:'데이터플랫폼팀', updated:'오늘 04:18', freq:'매일 04:00', rows:'3,140,882',
    quality:'ok', certified:false, usable:true, fav:false, mat:'—', tags:['원천','처방'],
    cols:[['order_id','처방번호','STRING','필수'],['patient_id','환자번호','STRING','필수'],['exam_cd','검사코드','STRING','필수'],
          ['order_dt','처방일자','DATE','필수'],['dept_cd','진료과코드','STRING','선택']],
    prev:[['O2026080400091','P00012841','L3021','2026-08-04','IM'],['O2026080400092','P00012842','L3021','2026-08-04','FM']] },

  { id:'src_checkup', name:'건강검진 원천 데이터', phys:'raw_hospital.health_checkup', layer:'원천', kind:'source',
    desc:'건강검진 접수와 판정 결과 원본입니다. 검진 종류와 판정 등급이 들어 있습니다.',
    owner:'박서연', team:'검진사업팀', updated:'오늘 04:26', freq:'매일 04:00', rows:'412,930',
    quality:'ok', certified:false, usable:true, fav:false, mat:'—', tags:['원천','검진'],
    cols:[['checkup_id','검진번호','STRING','필수'],['patient_id','환자번호','STRING','필수'],['checkup_type','검진종류','STRING','필수'],
          ['checkup_dt','검진일자','DATE','필수'],['grade_cd','판정등급','STRING','선택']],
    prev:[['C202608040012','P00012841','일반검진','2026-08-04','B'],['C202608040013','P00012843','종합검진','2026-08-04','A']] },

  { id:'src_visit', name:'병원 방문 원천 데이터', phys:'raw_hospital.hospital_visit', layer:'원천', kind:'source',
    desc:'외래·입원 방문 기록 원본입니다. 아직 정제 데이터가 없어 분석용으로는 준비 중입니다.',
    owner:'이지훈', team:'데이터플랫폼팀', updated:'어제 22:40', freq:'1시간마다', rows:'1,882,004',
    quality:'warn', certified:false, usable:true, fav:false, mat:'—', tags:['원천','방문'], stale:true,
    cols:[['visit_id','방문번호','STRING','필수'],['patient_id','환자번호','STRING','필수'],['visit_dt','방문일자','DATE','필수'],
          ['visit_type','방문구분','STRING','선택'],['dept_cd','진료과코드','STRING','선택']],
    prev:[['V20260803A0091','P00012841','2026-08-03','외래','IM']] },

  { id:'stg_patient', name:'환자 정보 정제', phys:'staging.stg_patient', layer:'정제', kind:'model',
    desc:'환자 원천 데이터를 표기 기준에 맞춰 정리했습니다. 이름은 마스킹하고 중복 등록을 정리했습니다.',
    owner:'김수현', team:'데이터플랫폼팀', updated:'오늘 05:04', freq:'매일 05:00', rows:'127,884',
    quality:'ok', certified:false, usable:true, fav:false, mat:'View', tags:['정제','환자'],
    up:['src_patient'],
    cols:[['patient_id','환자번호','STRING','필수'],['patient_nm_masked','환자명(마스킹)','STRING','필수'],['birth_dt','생년월일','DATE','선택'],
          ['gender','성별','STRING','선택'],['age','나이','INT','선택'],['hospital_cd','병원코드','STRING','필수']],
    prev:[['P00012841','김*수','1978-03-11','남','48','H01'],['P00012842','박*연','1991-11-02','여','34','H01']],
    sql:`select
    patient_id,
    mask_name(patient_nm)                      as patient_nm_masked,
    birth_dt,
    case when gender_cd = 'M' then '남'
         when gender_cd = 'F' then '여' end    as gender,
    date_diff('year', birth_dt, current_date)  as age,
    hospital_cd
from {{ source('raw_hospital', 'patient') }}
where reg_dtm is not null` },

  { id:'stg_examination_result', name:'검사 결과 정제', phys:'staging.stg_examination_result', layer:'정제', kind:'model',
    desc:'검사 결과 원본의 단위와 코드 표기를 통일했습니다. 취소된 검사는 제외했습니다.',
    owner:'김수현', team:'데이터플랫폼팀', updated:'오늘 05:08', freq:'매일 05:00', rows:'2,898,440',
    quality:'warn', certified:false, usable:true, fav:true, mat:'View', tags:['정제','검사'],
    up:['src_exam_result','src_exam_order'],
    cols:[['result_id','결과번호','STRING','필수'],['patient_id','환자번호','STRING','필수'],['examination_code','검사코드','STRING','필수'],
          ['examination_date','검사일자','DATE','필수'],['result_value','결과값','DECIMAL','선택'],['unit','단위','STRING','선택'],['dept_cd','진료과코드','STRING','선택']],
    prev:[['R2026080400121','P00012841','L3021','2026-08-04','5.8','mmol/L','IM'],['R2026080400122','P00012841','L1102','2026-08-04','142','mg/dL','IM'],
          ['R2026080400123','P00012842','L3021','2026-08-04','4.9','mmol/L','FM']],
    sql:`select
    r.result_id,
    r.patient_id,
    upper(trim(r.exam_cd))          as examination_code,
    cast(r.exam_dtm as date)        as examination_date,
    r.result_val                    as result_value,
    lower(r.unit_cd)                as unit,
    o.dept_cd
from {{ source('raw_hospital', 'examination_result') }} as r
left join {{ source('raw_hospital', 'examination_order') }} as o
    on o.patient_id = r.patient_id and o.exam_cd = r.exam_cd
where r.result_val is not null` },

  { id:'stg_health_checkup', name:'건강검진 정제', phys:'staging.stg_health_checkup', layer:'정제', kind:'model',
    desc:'건강검진 원본에서 검진 종류와 판정 등급 표기를 통일했습니다.',
    owner:'박서연', team:'검진사업팀', updated:'오늘 05:06', freq:'매일 05:00', rows:'412,120',
    quality:'ok', certified:false, usable:true, fav:false, mat:'View', tags:['정제','검진'],
    up:['src_checkup'],
    cols:[['checkup_id','검진번호','STRING','필수'],['patient_id','환자번호','STRING','필수'],['checkup_type','검진종류','STRING','필수'],
          ['checkup_date','검진일자','DATE','필수'],['grade','판정등급','STRING','선택']],
    prev:[['C202608040012','P00012841','일반검진','2026-08-04','B']],
    sql:`select
    checkup_id,
    patient_id,
    checkup_type,
    checkup_dt   as checkup_date,
    upper(grade_cd) as grade
from {{ source('raw_hospital', 'health_checkup') }}` },

  { id:'dim_patient', name:'환자 기준정보', phys:'marts.dim_patient', layer:'분석용', kind:'model',
    desc:'분석에 바로 쓸 수 있는 환자 기준 정보입니다. 환자 1명이 한 줄이며 연령대가 함께 계산되어 있습니다.',
    owner:'김수현', team:'데이터플랫폼팀', updated:'오늘 05:12', freq:'매일 05:00', rows:'127,884',
    quality:'ok', certified:true, usable:true, fav:true, mat:'Table', tags:['기준정보','환자','인증'],
    up:['stg_patient'],
    cols:[['patient_id','환자번호','STRING','필수'],['patient_nm_masked','환자명(마스킹)','STRING','필수'],['gender','성별','STRING','선택'],
          ['age','나이','INT','선택'],['age_group','연령대','STRING','선택'],['hospital_cd','병원코드','STRING','필수']],
    prev:[['P00012841','김*수','남','48','40대','H01'],['P00012842','박*연','여','34','30대','H01'],['P00012843','정*호','남','60','60대','H02']],
    sql:`select
    patient_id,
    patient_nm_masked,
    gender,
    age,
    case when age < 20 then '10대 이하'
         when age < 30 then '20대'
         when age < 40 then '30대'
         when age < 50 then '40대'
         when age < 60 then '50대'
         else '60대 이상' end as age_group,
    hospital_cd
from {{ ref('stg_patient') }}` },

  { id:'fct_patient_examination', name:'환자별 검사 결과', phys:'marts.fct_patient_examination', layer:'분석용', kind:'model',
    desc:'환자 정보와 검사 결과를 연결한 분석용 데이터입니다. 검사 1건이 한 줄입니다.',
    owner:'김수현', team:'데이터플랫폼팀', updated:'오늘 05:16', freq:'매일 05:00', rows:'2,898,440',
    quality:'err', certified:true, usable:true, fav:true, mat:'Incremental', tags:['분석용','검사','인증'],
    up:['stg_examination_result','dim_patient'],
    cols:[['result_id','결과번호','STRING','필수'],['patient_id','환자번호','STRING','필수'],['age_group','연령대','STRING','선택'],
          ['gender','성별','STRING','선택'],['examination_code','검사코드','STRING','필수'],['examination_date','검사일자','DATE','필수'],
          ['result_value','결과값','DECIMAL','선택'],['unit','단위','STRING','선택']],
    prev:[['R2026080400121','P00012841','40대','남','L3021','2026-08-04','5.8','mmol/L'],
          ['R2026080400122','P00012841','40대','남','L1102','2026-08-04','142','mg/dL'],
          ['R2026080400123','P00012842','30대','여','L3021','2026-08-04','4.9','mmol/L']],
    sql:`select
    e.result_id,
    e.patient_id,
    p.age_group,
    p.gender,
    e.examination_code,
    e.examination_date,
    e.result_value,
    e.unit
from {{ ref('stg_examination_result') }} as e
left join {{ ref('dim_patient') }} as p
    on p.patient_id = e.patient_id` },

  { id:'agg_daily_examination', name:'일별 검사 현황', phys:'marts.agg_daily_examination', layer:'분석용', kind:'model',
    desc:'날짜와 검사 종류별 검사 건수를 집계한 데이터입니다. 일일 운영 보고에 사용합니다.',
    owner:'김수현', team:'데이터플랫폼팀', updated:'오늘 05:19', freq:'매일 05:00', rows:'18,204',
    quality:'err', certified:true, usable:true, fav:false, mat:'Incremental', tags:['분석용','검사','인증'],
    up:['fct_patient_examination'],
    cols:[['examination_date','검사일자','DATE','필수'],['examination_code','검사코드','STRING','필수'],
          ['examination_count','검사건수','INT','필수'],['patient_count','환자수','INT','선택']],
    prev:[['2026-08-04','L3021','1,204','1,102'],['2026-08-04','L1102','942','901'],['2026-08-03','L3021','1,188','1,090']],
    sql:`select
    examination_date,
    examination_code,
    count(*)                     as examination_count,
    count(distinct patient_id)   as patient_count
from {{ ref('fct_patient_examination') }}
group by
    examination_date,
    examination_code` },

  { id:'agg_checkup_summary', name:'건강검진 통계', phys:'marts.agg_checkup_summary', layer:'분석용', kind:'model',
    desc:'검진 종류와 연령대별 검진 건수와 판정 분포입니다. 검진사업 보고에 사용합니다.',
    owner:'박서연', team:'검진사업팀', updated:'어제 06:10', freq:'매주 월 06:00', rows:'2,410',
    quality:'warn', certified:false, usable:false, fav:false, mat:'Table', tags:['분석용','검진'],
    up:['stg_health_checkup','dim_patient'],
    cols:[['checkup_date','검진일자','DATE','필수'],['checkup_type','검진종류','STRING','필수'],['age_group','연령대','STRING','선택'],
          ['checkup_count','검진건수','INT','필수'],['grade_a_rate','A등급비율','DECIMAL','선택']],
    prev:[['2026-08-03','일반검진','40대','412','0.38'],['2026-08-03','종합검진','50대','188','0.31']],
    sql:`select
    c.checkup_date,
    c.checkup_type,
    p.age_group,
    count(*) as checkup_count,
    avg(case when c.grade = 'A' then 1 else 0 end) as grade_a_rate
from {{ ref('stg_health_checkup') }} as c
left join {{ ref('dim_patient') }} as p on p.patient_id = c.patient_id
group by 1, 2, 3` },
];
const byId = (id) => D.find(d => d.id === id);
const downOf = (id) => D.filter(d => (d.up || []).includes(id));

/* 데이터 검증 규칙 */
const TESTS = [
  { id:'t1', title:'필수값 누락', target:'fct_patient_examination', col:'patient_id', kind:'필수값',
    dbt:'not_null', sev:'error', status:'err', cnt:12,
    plain:'환자번호가 입력되지 않은 데이터가 12건 발견되었습니다.',
    impact:'이 문제로 일별 검사 현황 데이터가 정확하지 않을 수 있습니다.',
    rows:[['R2026080400418','(비어 있음)','L3021','2026-08-04'],['R2026080400512','(비어 있음)','L1102','2026-08-04']] },
  { id:'t2', title:'데이터 간 연결 오류', target:'fct_patient_examination', col:'patient_id', kind:'연결',
    dbt:'relationships → dim_patient', sev:'error', status:'err', cnt:5,
    plain:'환자 기준정보에 없는 환자번호가 5건 있습니다.',
    impact:'연령대·성별이 비어 있는 검사 결과가 생겨 통계가 어긋납니다.',
    rows:[['R2026080400622','P99900001','L3021','2026-08-04']] },
  { id:'t3', title:'중복 데이터', target:'stg_examination_result', col:'result_id', kind:'중복',
    dbt:'unique', sev:'warn', status:'warn', cnt:3,
    plain:'같은 결과번호가 두 번 들어온 데이터가 3건 있습니다.',
    impact:'검사 건수가 실제보다 조금 많게 집계될 수 있습니다.',
    rows:[['R2026080400121','P00012841','L3021','2026-08-04']] },
  { id:'t4', title:'기준값 오류', target:'stg_examination_result', col:'unit', kind:'기준값',
    dbt:"accepted_values ['mmol/l','mg/dl','g/dl','%']", sev:'warn', status:'ok', cnt:0,
    plain:'허용된 단위 외의 값은 발견되지 않았습니다.', impact:'', rows:[] },
  { id:'t5', title:'업데이트 지연', target:'src_visit', col:'visit_dt', kind:'업데이트',
    dbt:'source freshness (warn_after: 4h)', sev:'warn', status:'warn', cnt:1,
    plain:'병원 방문 원천 데이터가 6시간째 새로 들어오지 않았습니다.',
    impact:'방문 기준 분석이 어제 데이터까지만 반영됩니다.', rows:[] },
  { id:'t6', title:'필수값 누락', target:'dim_patient', col:'patient_id', kind:'필수값',
    dbt:'not_null', sev:'error', status:'ok', cnt:0, plain:'환자번호가 모두 채워져 있습니다.', impact:'', rows:[] },
  { id:'t7', title:'중복 데이터', target:'dim_patient', col:'patient_id', kind:'중복',
    dbt:'unique', sev:'error', status:'ok', cnt:0, plain:'환자번호 중복이 없습니다.', impact:'', rows:[] },
  { id:'t8', title:'기준값 오류', target:'agg_checkup_summary', col:'checkup_type', kind:'기준값',
    dbt:"accepted_values ['일반검진','종합검진','특수검진']", sev:'warn', status:'ok', cnt:0,
    plain:'검진 종류가 모두 허용된 값입니다.', impact:'', rows:[] },
];

/* 파이프라인 */
const PIPES = [
  { id:'pl_exam', name:'일별 검사 현황 생성', targets:['stg_examination_result','fct_patient_examination','agg_daily_examination'],
    freq:'매일 05:00', last:'오늘 05:19', dur:'4분 12초', next:'내일 05:00', owner:'김수현', status:'err',
    steps:[['원천 데이터 확인','ok','12초'],['검사 결과 정제','ok','48초'],['환자별 검사 결과 생성','ok','2분 04초'],
           ['일별 검사 현황 생성','ok','52초'],['데이터 검증','err','16초'],['완료','wait','—']],
    err:{ step:'데이터 검증', title:'일별 검사 현황 데이터 생성에 실패했습니다.',
      body:'환자번호가 비어 있는 데이터 12건과 환자 기준정보에 없는 환자번호 5건이 확인되었습니다. 실패한 단계와 오류 내용을 확인한 후 다시 실행할 수 있습니다.',
      log:['05:19:02  데이터 검증 시작 (검증 8건)','05:19:11  필수값 누락 — patient_id 12건 실패','05:19:14  연결 오류 — dim_patient 미존재 5건 실패','05:19:18  검증 실패로 이후 단계 중단','05:19:18  완료 — 성공 6 · 실패 2 · 중단 1'] } },
  { id:'pl_patient', name:'환자 기준정보 갱신', targets:['stg_patient','dim_patient'],
    freq:'매일 04:30', last:'오늘 04:52', dur:'1분 38초', next:'내일 04:30', owner:'김수현', status:'ok',
    steps:[['원천 데이터 확인','ok','8초'],['환자 정보 정제','ok','36초'],['환자 기준정보 생성','ok','42초'],['데이터 검증','ok','12초'],['완료','ok','—']] },
  { id:'pl_checkup', name:'건강검진 통계 생성', targets:['stg_health_checkup','agg_checkup_summary'],
    freq:'매주 월 06:00', last:'어제 06:10', dur:'2분 04초', next:'08.10 06:00', owner:'박서연', status:'ok',
    steps:[['원천 데이터 확인','ok','9초'],['건강검진 정제','ok','40초'],['건강검진 통계 생성','ok','1분 02초'],['데이터 검증','ok','13초'],['완료','ok','—']] },
  { id:'pl_visit', name:'병원 방문 데이터 수집', targets:['src_visit'],
    freq:'1시간마다', last:'오늘 09:00', dur:'실행 중', next:'오늘 10:00', owner:'이지훈', status:'run',
    steps:[['원천 데이터 확인','ok','7초'],['방문 데이터 수집','run','진행 중'],['데이터 검증','wait','—'],['완료','wait','—']] },
];

/* 알림 · 내 작업 */
const NOTIS = [
  { t:'일별 검사 현황 생성 실패', d:'오늘 05:19 · 데이터 검증 단계', k:'err', go:['pipeline','pl_exam'] },
  { t:'병원 방문 원천 데이터 업데이트 지연', d:'6시간째 새 데이터 없음', k:'warn', go:['quality', null] },
  { t:'환자 기준정보 인증 데이터로 승인', d:'어제 17:20 · 승인자 박민재', k:'ok', go:['catalog','dim_patient'] },
];
const MYTASKS = [
  { t:'검사 결과 정제 — 중복 3건 확인', d:'오늘까지', k:'warn', go:['quality', 't3'] },
  { t:'건강검진 통계 접근 권한 요청 검토', d:'요청자 최다은 · 어제', k:'info', go:['catalog','agg_checkup_summary'] },
  { t:'환자별 검사 결과 — 필수값 누락 조치', d:'지연', k:'err', go:['quality','t1'] },
];

/* ============================================================
   역할 · 상태
   ============================================================ */
/* 역할·권한은 두지 않는다.
   인증이 없는 설치형 단일 사용자 제품이라 데이터 엔지니어/분석가/현업/관리자는
   전부 지어낸 값이었고, 화면에서 버튼을 감추는 것 말고는 아무 것도 강제하지 못했다.
   R() 은 모두 사용 가능을 돌려주고, 호출부는 그대로 둔다 —
   나중에 인증을 붙이면 여기만 실제 권한으로 바꾸면 된다. */
const CAPS = { menus: ['home', 'modeling', 'pipeline', 'quality'],
               canModel: true, canPipeEdit: true, admin: false, tech: true };

const MENUS = [
  { id:'home', label:'홈', icon:'home' },
  { id:'modeling', label:'데이터 모델링', icon:'model' },
  { id:'pipeline', label:'데이터 파이프라인', icon:'pipe' },
  { id:'quality', label:'데이터 품질', icon:'shield' },
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
const ENVS = { dev:{ label:'개발', c:'#6366F1' }, stg:{ label:'검증', c:'#D97706' }, prod:{ label:'운영', c:'#0E9F6E' } };

function qBadge(q){
  if (q === 'ok') return `<span class="bdg ok">${ic14('checkc')}정상</span>`;
  if (q === 'warn') return `<span class="bdg warn">${ic14('alert')}주의</span>`;
  return `<span class="bdg err">${ic14('xc')}오류</span>`;
}
