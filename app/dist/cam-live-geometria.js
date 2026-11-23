window.CamLiveGeometria = (function () {
  'use strict';
  /* alças de transformação (cantos e meios) + botão de girar */
  const HANDLES = [{ id: 'nw', sx: -1, sy: -1 }, { id: 'ne', sx: 1, sy: -1 }, { id: 'se', sx: 1, sy: 1 }, { id: 'sw', sx: -1, sy: 1 }, { id: 'n', sx: 0, sy: -1 }, { id: 'e', sx: 1, sy: 0 }, { id: 's', sx: 0, sy: 1 }, { id: 'w', sx: -1, sy: 0 }];
  const ROT_OFF = 30;                                    // distância (px da tela) do botão de girar até a borda de cima
  const ROT_ARC = new Path2D('M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8'), ROT_HEAD = new Path2D('M21 3v5h-5');
  const rad = (it) => ((it.rot || 0) * Math.PI) / 180;
  const centerOf = (f) => ({ x: f.x + f.w / 2, y: f.y + f.h / 2 });
  function toLocal(fr, rot, p) { const c = centerOf(fr), a = -(rot * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a), dx = p.x - c.x, dy = p.y - c.y; return { x: dx * co - dy * si, y: dx * si + dy * co }; }
  function toWorld(fr, rot, l) { const c = centerOf(fr), a = (rot * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a); return { x: c.x + l.x * co - l.y * si, y: c.y + l.x * si + l.y * co }; }
  function hitHandle(it, p, k) {
    const f = it.frame, l = toLocal(f, it.rot || 0, p), r = 11 * k;
    if (Math.hypot(l.x, l.y + f.h / 2 + ROT_OFF * k) <= r) return { type: 'rot' };
    for (const h of HANDLES) if (Math.hypot(l.x - (h.sx * f.w) / 2, l.y - (h.sy * f.h) / 2) <= r) return { type: 'resize', h };
    return null;
  }
  const insideItem = (it, p) => { const f = it.frame, l = toLocal(f, it.rot || 0, p); return Math.abs(l.x) <= f.w / 2 && Math.abs(l.y) <= f.h / 2; };
  function cursorFor(hit, it) {
    if (!hit) return '';
    if (hit.type === 'rot') return 'grab';
    const deg = (((Math.atan2(hit.h.sy, hit.h.sx) * 180) / Math.PI + (it.rot || 0)) % 180 + 180) % 180, q = Math.round(deg / 45) % 4;
    return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][q];
  }
  return { HANDLES, ROT_ARC, ROT_HEAD, ROT_OFF, centerOf, cursorFor, hitHandle, insideItem, rad, toLocal, toWorld };
})();
