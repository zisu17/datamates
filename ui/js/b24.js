


const ZPAD = 620;   /* 어떤 배율에서도 끌어서 옮길 여유를 남긴다 */

function wireZoomPan(opt) {
  const { wrap, sizer, canvas, w, h, get, set, onZoom, onDragBox, onBlank, dbl } = opt;
  const size = () => { const z = get();
    sizer.style.width = Math.round(w * z + ZPAD * 2) + 'px';
    sizer.style.height = Math.round(h * z + ZPAD * 2) + 'px';
    canvas.style.left = ZPAD + 'px'; canvas.style.top = ZPAD + 'px';
    canvas.style.transform = 'scale(' + z + ')'; };
  canvas.style.position = 'absolute';
  canvas.style.transformOrigin = '0 0';
  size();

  const zoomAt = (nz, cx, cy) => {
    const old = get();
    nz = Math.max(0.3, Math.min(2, nz));
    if (Math.abs(nz - old) < 0.002) return;
    const r0 = wrap.getBoundingClientRect();
    const vx = cx - r0.left, vy = cy - r0.top;
    const px = (vx + wrap.scrollLeft - ZPAD) / old, py = (vy + wrap.scrollTop - ZPAD) / old;
    set(nz); size();
    wrap.scrollLeft = px * nz + ZPAD - vx;
    wrap.scrollTop = py * nz + ZPAD - vy;
    if (onZoom) onZoom(nz);
  };
  wrap.__zoomAt = zoomAt;
  wrap.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const step = Math.min(Math.abs(ev.deltaY) * 0.0006, 0.03);
    zoomAt(get() * (ev.deltaY < 0 ? 1 + step : 1 - step), ev.clientX, ev.clientY);
  }, { passive: false });

  /* 배경은 어디를 잡아도 끌린다 — 여백 영역(sizer)까지 포함 */
  let drag = null, pan = null, moved = false;
  wrap.style.cursor = 'grab';
  const down = (ev) => {
    if (ev.button !== 0) return;
    const box = onDragBox && ev.target.closest('[data-ent],[data-pn]');
    if (box && onDragBox) {
      const z = get(), r = box.getBoundingClientRect();
      drag = { box, id: box.dataset.ent || box.dataset.pn, dx: (ev.clientX - r.left) / z, dy: (ev.clientY - r.top) / z };
      box.classList.add('drag');
      onDragBox.start && onDragBox.start(drag.id, box);
      ev.preventDefault();
      return;
    }
    if (onBlank) onBlank();
    moved = false;
    pan = { x: ev.clientX, y: ev.clientY, l: wrap.scrollLeft, t: wrap.scrollTop };
    wrap.style.cursor = 'grabbing';
    ev.preventDefault();
  };
  wrap.addEventListener('mousedown', down);

  const mv = (ev) => {
    if (drag) {
      const z = get(), cr = canvas.getBoundingClientRect();
      const x = Math.max(0, (ev.clientX - cr.left) / z - drag.dx);
      const y = Math.max(0, (ev.clientY - cr.top) / z - drag.dy);
      drag.box.style.left = x + 'px'; drag.box.style.top = y + 'px';
      onDragBox.move(drag.id, x, y);
    } else if (pan) {
      if (Math.abs(ev.clientX - pan.x) + Math.abs(ev.clientY - pan.y) > 3) moved = true;
      wrap.scrollLeft = pan.l - (ev.clientX - pan.x);
      wrap.scrollTop = pan.t - (ev.clientY - pan.y);
    }
  };
  const up = (ev) => {
    if (drag) { drag.box.classList.remove('drag'); onDragBox.end && onDragBox.end(drag.id); drag = null; }
    if (pan) { pan = null; wrap.style.cursor = 'grab';
      if (moved) { const blk = (e) => e.stopPropagation();
        window.addEventListener('click', blk, { capture: true, once: true }); } }
  };
  const key = opt.key || 'zp';
  if (window['__' + key + 'mv']) {
    window.removeEventListener('mousemove', window['__' + key + 'mv']);
    window.removeEventListener('mouseup', window['__' + key + 'mu']);
  }
  window['__' + key + 'mv'] = mv; window['__' + key + 'mu'] = up;
  window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  if (dbl) canvas.addEventListener('dblclick', dbl);
  return { zoomAt, size };
}

/* ── ERD ── */
/* 배율 100% 로 되돌려도 보고 있던 영역을 유지한다 */
