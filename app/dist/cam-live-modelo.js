window.CamLiveModelo = (function () {
  'use strict';
  const { RATIOS } = window.CamLiveDados;

  const uid = () => Math.random().toString(36).slice(2, 9);
  const mkItem = (kind, name, frame, extra) => Object.assign({ id: uid(), kind, name, path: null, color: '#3366cc', deviceId: '', frame, visible: true, locked: false, volume: 1, muted: false, monitor: false, loop: true }, extra || {});
  const even = (n) => Math.round(n / 2) * 2;
  function calcDims(v) {
    const list = RATIOS[v.fmt] || RATIOS.pc, r = (list.find((x) => x[0] === v.ratio) || list[0])[1];
    const sh = v.q === 1080 ? 1080 : 720, lg = even(sh * r);
    return v.orient === 'port' ? [sh, lg] : [lg, sh];
  }

  function defaultDoc() {
    const sid = uid();
    return {
      video: { fmt: 'phone', ratio: '16:9', q: 720, orient: 'port', fps: 30, w: 720, h: 1280 },
      stream: { target: 'iphone', url: 'rtmp://127.0.0.1:11935/live', key: 'cam', dyn: false, bitrate: 2500, keyint: 2, drop: 700, pdrop: 900, retryDelay: 2, maxRetries: 25 },
      scenes: [{ id: sid, name: 'Cena 1', items: [mkItem('test', 'Padrão de teste', { x: 0, y: 0, w: 720, h: 1280 })] }],
      active: sid,
    };
  }

  let dbP = null;
  const idb = () => dbP || (dbP = new Promise((res) => {
    try {
      const r = indexedDB.open('nova-camlive', 1);
      r.onupgradeneeded = () => { try { r.result.createObjectStore('files'); } catch (_) {} };
      r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
    } catch (_) { res(null); }
  }));
  async function idbDo(mode, fn) {
    try {
      const d = await idb(); if (!d) return null;
      return await new Promise((res) => {
        try {
          const tx = d.transaction('files', mode), st = tx.objectStore('files'); let out = null;
          const rq = fn(st); if (rq) rq.onsuccess = () => { out = rq.result; };
          tx.oncomplete = () => res(out); tx.onerror = tx.onabort = () => res(null);
        } catch (_) { res(null); }
      });
    } catch (_) { return null; }
  }
  const idbPut = (id, blob) => idbDo('readwrite', (st) => st.put(blob, id));
  const idbGet = (id) => idbDo('readonly', (st) => st.get(id));
  const idbDel = (id) => idbDo('readwrite', (st) => st.delete(id));
  const idbKeys = () => idbDo('readonly', (st) => st.getAllKeys());

  return { calcDims, defaultDoc, even, idbDel, idbGet, idbKeys, idbPut, mkItem };
})();
