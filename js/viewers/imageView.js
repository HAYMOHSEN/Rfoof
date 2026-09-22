// Image viewer: zoom (wheel / pinch / buttons), pan, rotate, fit
import { h, clamp } from '../utils.js';

export function imageView(stage, blob, ctrl) {
  const url = URL.createObjectURL(blob);
  const box = h('div', { class: 'img-stage' });
  const img = h('img', { src: url, alt: '', draggable: false });
  box.appendChild(img);
  stage.appendChild(box);
  const st = { scale: 1, fit: 1, x: 0, y: 0, rot: 0, nw: 0, nh: 0 };
  const apply = () => { img.style.transform = `translate(${st.x}px, ${st.y}px) scale(${st.scale}) rotate(${st.rot}deg)`; ctrl.setZoom(st.scale / st.fit); };
  const computeFit = () => {
    const rotated = st.rot % 180 !== 0;
    const w = rotated ? st.nh : st.nw, hh = rotated ? st.nw : st.nh;
    const bw = box.clientWidth - 24, bh = box.clientHeight - 24;
    st.fit = Math.min(1, bw / (w || 1), bh / (hh || 1));
  };
  const fit = () => { computeFit(); st.scale = st.fit; st.x = 0; st.y = 0; apply(); };
  img.onload = () => { st.nw = img.naturalWidth; st.nh = img.naturalHeight; fit(); ctrl.setMeta(`${st.nw} × ${st.nh}`); };
  img.onerror = () => ctrl.fail();
  const zoomAt = (factor, cx, cy) => {
    const r = box.getBoundingClientRect();
    const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
    const ns = clamp(st.scale * factor, st.fit * 0.2, Math.max(st.fit * 12, 8));
    const k = ns / st.scale;
    st.x = px - (px - st.x) * k; st.y = py - (py - st.y) * k; st.scale = ns;
    apply();
  };
  box.addEventListener('wheel', (e) => { e.preventDefault(); const f = e.deltaY < 0 ? 1.15 : 1 / 1.15; zoomAt(f, e.clientX, e.clientY); }, { passive: false });
  // pointer pan + pinch
  const pointers = new Map(); let lastDist = 0; let dragStart = null;
  box.addEventListener('pointerdown', (e) => { box.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.size === 1) { dragStart = { x: e.clientX - st.x, y: e.clientY - st.y }; box.classList.add('grabbing', 'no-anim'); } });
  box.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values()); const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastDist) zoomAt(d / lastDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      lastDist = d;
    } else if (dragStart) { st.x = e.clientX - dragStart.x; st.y = e.clientY - dragStart.y; apply(); }
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) lastDist = 0; if (!pointers.size) { dragStart = null; box.classList.remove('grabbing', 'no-anim'); } };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  box.addEventListener('dblclick', (e) => { if (Math.abs(st.scale - st.fit) < 0.01) zoomAt(2 / st.fit * st.fit, e.clientX, e.clientY); else fit(); });
  const ro = new ResizeObserver(() => { if (Math.abs(st.scale - st.fit) < 0.001) fit(); else computeFit(); });
  ro.observe(box);
  ctrl.on({
    zoomIn: () => { const r = box.getBoundingClientRect(); zoomAt(1.25, r.left + r.width / 2, r.top + r.height / 2); },
    zoomOut: () => { const r = box.getBoundingClientRect(); zoomAt(1 / 1.25, r.left + r.width / 2, r.top + r.height / 2); },
    fit, actual: () => { st.scale = 1; st.x = 0; st.y = 0; apply(); },
    rotate: () => { st.rot = (st.rot + 90) % 360; fit(); },
  });
  ctrl.setZoomable(true); ctrl.setRotatable(true);
  return () => { ro.disconnect(); URL.revokeObjectURL(url); };
}
