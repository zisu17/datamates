/* ── b55 — 주소(해시) 라우팅 ────────────────────────────────────────────
   이 앱은 화면을 바꿀 때 S 의 값만 고치고 #app 을 다시 그렸다. 브라우저 입장에서는
   아무 일도 일어나지 않아서 주소가 그대로였고, 그래서 —
     · 뒤로가기가 앱 안이 아니라 앱 밖으로 나갔고
     · 새로고침하면 늘 홈이었고 (화면 위치는 메모리에만 있다)
     · «이 파이프라인 실패 좀 봐줘» 하고 링크를 보낼 수가 없었다.

   경로 방식(/pipeline/xxx)이 아니라 해시(#/pipeline/xxx)를 쓴다. 서버에 catch-all 이
   없어서 경로 방식은 새로고침·직접 열기에서 404 가 난다(확인함). 해시는 서버가
   관여하지 않는다.

   주소는 «상태에서 뽑아낸다». go() 를 부르는 자리가 서른 곳이 넘고 화면을 바꾸는 길이
   go() 만도 아니라(파이프라인 탭 열기·독 탭·모델 선택), 호출부마다 주소를 쓰게 하면
   반드시 빠지는 곳이 생긴다. 대신 render() 뒤에서 지금 상태의 주소를 계산해 맞춘다 —
   화면이 바뀌면 반드시 다시 그리므로 이 한 곳이면 전부 걸린다.

   히스토리에 쌓는 기준은 «페이지가 바뀌었나» 다. 모델을 고르거나 독 탭을 옮기는 것까지
   쌓으면 뒤로가기 한 번에 한 칸씩 밀려 정작 이전 페이지로 못 돌아간다. 그런 잔움직임은
   replace 로 주소만 갈아 끼운다(공유·새로고침에는 그대로 반영된다). */

(function () {
  const PAGES = ['home', 'ingest', 'modeling', 'pipeline', 'quality', 'analytics'];

  let cur = null;        // 지금 주소에 반영해 둔 경로
  let applying = false;  // 주소 → 상태 복원 중 (그동안은 주소를 쓰지 않는다)
  let restored = false;  // 첫 진입의 주소를 한 번 되살렸는가
  /* 주소를 상태로 옮기는 동안의 render 를 삼킨다. applyRoute 는 go() 를 거치고
     go() 는 끝에서 render() 를 부르는데, 옮기는 중에 그리면 같은 화면을 두 번
     그린다. 삼켜 두고 바깥에서 한 번만 그린다. */
  let silent = false;
  let firstSync = true;  // 첫 주소 맞춤은 반드시 replace (아래 syncRoute 참고)

  /* 상태 → 경로 */
  function routeOfState() {
    const p = PAGES.includes(S.page) ? S.page : 'home';
    if (p === 'pipeline') {
      const id = S.openPipe && S.openPipe !== 'deps' ? S.openPipe : '';
      const tab = id && S.pipeTab ? '?tab=' + encodeURIComponent(S.pipeTab) : '';
      return '/pipeline' + (id ? '/' + encodeURIComponent(id) : '') + tab;
    }
    if (p === 'modeling') return '/modeling' + (S.sel ? '/' + encodeURIComponent(S.sel) : '');
    /* 품질은 화면이 일곱이라(대시보드·리포트·규칙·상세·등록·결과·오류 행) 어느
       화면인가를 주소가 함께 말해야 «이 규칙 좀 봐줘» 로 링크가 통한다.
       규칙 id 는 규칙을 보는 화면에서만 붙인다 — 대시보드 주소에 규칙 id 가
       실리면 링크를 열었을 때 주소와 화면이 어긋난다. */
    if (p === 'quality') {
      const onRule = S.qView === 'detail' || S.qView === 'errors';
      const id = onRule && S.qSel ? '/' + encodeURIComponent(S.qSel) : '';
      const v = S.qView && S.qView !== 'dash' ? '?v=' + encodeURIComponent(S.qView) : '';
      return '/quality' + id + v;
    }
    return '/' + p;
  }

  const pageOf = (route) => (route || '').split('?')[0].split('/')[1] || 'home';

  /* 경로 → 상태. 기존 이동 함수를 그대로 쓴다 — 여기서 규칙을 다시 쓰면
     «주소로 들어왔을 때만 다르게 동작하는» 화면이 생긴다. */
  function applyRoute(route) {
    const [path, query] = String(route || '').split('?');
    const seg = path.split('/').filter(Boolean);
    let page = seg[0] || 'home';
    const arg = seg[1] ? decodeURIComponent(seg[1]) : null;
    if (!PAGES.includes(page)) page = 'home';
    if (!R().menus.includes(page)) page = 'home';

    const params = new URLSearchParams(query || '');
    const tab = params.get('tab');
    const qv = params.get('v');       // 품질 화면 (dash · report · rules · detail · form · runs · errors)

    if (page === 'pipeline') {
      go('pipeline');       // silent 중이면 여기서 그리지 않는다
      /* 없는 id(지워진 파이프라인 링크 등)면 목록으로 떨어뜨린다. 그냥 두면 주소는
         그 id 인데 화면은 직전에 보던 파이프라인이라 둘이 어긋난다. */
      const known = arg && (PIPES.some(x => x.id === arg)
        || (typeof ING !== 'undefined' && ING.some(x => x.id === arg)));
      if (known && window.DM && DM.openPipeTab) DM.openPipeTab(arg);
      else S.openPipe = 'deps';
      if (tab) S.pipeTab = tab;
      render();
    } else if (page === 'quality') {
      /* go() 가 인자(규칙 id)를 받아 상세를 열어 주고, ?v= 가 그 위에서 화면을
         확정한다. 순서가 뒤바뀌면 «규칙 id 는 있는데 오류 행을 보라» 는 주소가
         상세로 열린다. ?v= 도 인자도 없으면 대시보드다 — 그렇게 두지 않으면
         뒤로가기로 /quality 에 돌아왔을 때 직전 화면이 그대로 남는다. */
      go('quality', arg || undefined);
      if (qv && QVIEWS[qv]) S.qView = qv;
      else if (!arg) S.qView = 'dash';
      render();
    } else {
      /* 모델은 go() 가 인자까지 받아 선택 상태를 만들어 준다 */
      go(page, arg || undefined);
    }
  }

  /* 상태 → 주소 */
  function syncRoute(forceReplace) {
    if (applying) return;
    const r = routeOfState();
    const first = firstSync;
    firstSync = false;
    if (r === cur) return;
    const pageChanged = cur === null || pageOf(r) !== pageOf(cur);
    cur = r;
    const url = '#' + encodeURI(r);
    if (location.hash === url) return;
    try {
      /* 페이지가 바뀐 때만 히스토리에 쌓는다. 첫 진입과 «주소 교정» 은 replace —
         알 수 없는 경로를 홈으로 떨어뜨린 것까지 히스토리에 쌓으면
         뒤로가기가 그 잘못된 주소로 되돌아간다.
         첫 맞춤(first)을 replace 로 못박는 이유: 이때 cur 은 아직 null 이라
         pageChanged 가 늘 참이라서, 그냥 두면 앱을 여는 것만으로 히스토리가
         한 칸 쌓여 뒤로가기 한 번이 헛돈다. */
      if (pageChanged && restored && !first && !forceReplace) history.pushState(null, '', url);
      else history.replaceState(null, '', url);
    } catch (e) { location.hash = r; }   // file:// 등 pushState 가 막힌 환경
  }

  /* 주소 → 상태 (뒤로/앞으로, 주소창 직접 수정) */
  function onNav() {
    const r = decodeURI(location.hash.slice(1)) || '/home';
    if (r === cur) return;             // 우리가 쓴 주소
    cur = r;
    applying = true;
    try { applyRoute(r); } finally { applying = false; }
    /* 들어온 주소가 규칙 밖이었으면(없는 페이지·지워진 id) 상태 쪽이 정답이다.
       그 결과를 주소에 되비춰 둘이 어긋난 채로 남지 않게 한다. */
    syncRoute(true);
  }
  window.addEventListener('popstate', onNav);
  window.addEventListener('hashchange', onNav);

  /* render 를 감싸 앞뒤로 주소를 다룬다. 이 파일은 마지막에 실려 가장 바깥이다.

     **첫 그리기 «전에» 주소를 상태로 옮긴다.** 예전에는 반대였다 — 먼저 그리고
     나서 주소를 읽었다. S.page 기본값이 'home' 이라(b00), #/modeling 으로 들어와도
     홈이 한 번 그려지고 홈의 요청이 나간 뒤에야 모델 화면으로 넘어갔다. 브라우저의
     출처당 동시 연결은 여섯이라(HTTP/1.1), 정작 사용자가 보려는 화면의 요청이 그
     줄 뒤에서 기다렸다. 순서를 뒤집으면 홈은 아예 그려지지 않는다.

     되살리는 시점이 여기인 것은 그대로다 — 데이터가 들어온 뒤라야 «그 파이프라인»
     을 찾을 수 있고, boot() 이 데이터를 채운 뒤 render() 를 부른다. */
  render = (function (base) {
    return function () {
      // 주소를 옮기는 중에 go() 가 부른 render — 바깥에서 한 번만 그린다
      if (silent) return;

      if (!restored) {
        restored = true;
        const first = decodeURI(location.hash.slice(1));
        if (first && first !== '/home') {
          cur = first;
          applying = true; silent = true;
          try { applyRoute(first); }
          catch (e) {
            /* 주소가 이상해서 상태를 못 만들었어도 화면은 떠야 한다.
               여기서 던지면 #app 이 splash 인 채로 남는다. */
            console.warn('[route] 주소를 되살리지 못했습니다:', e);
            cur = null;
          } finally { applying = false; silent = false; }
        }
      }
      base.apply(null, arguments);
      syncRoute();
    };
  })(render);
})();

/* ── 캔버스 첫 배율을 화면 크기에 맞춘다 ─────────────────────────
   규칙과 상태는 b23 의 syncCanvasZoom 이 갖고 있고, 여기서는 «언제 다시 재는가»
   만 정한다. 이 파일이 가장 마지막에 읽히므로 여기서 감싸야 살아남는다 —
   api.js 와 b57.js 가 render 를 통째로 다시 정의하기 때문에, 그보다 먼저 감싸면
   그 재정의가 래퍼를 덮어쓴다. */
render = (function (base) {
  return function () {
    if (typeof syncCanvasZoom === 'function') syncCanvasZoom();
    return base.apply(this, arguments);
  };
})(render);
