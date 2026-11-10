/**
 * NOVA GRAB — IDM-Style 3-Step Downloader v3
 *
 * Step 1: Small "Baixar este vídeo" bar appears at video top-right corner
 * Step 2: Click → format list slides down (IDM-style dropdown)
 * Step 3: Click format → "Info do Arquivo" draggable dialog
 * Step 4: Click "Iniciar Download" → IDM-style draggable progress dialog
 *
 * All 3 dialogs are movable/draggable.
 * Uses console.log('NOVA_DL:...') bridge → Playwright → yt-dlp
 */
(function () {
  'use strict';

  let currentUrl = location.href;

  // ─── Global CSS injected once ──────────────────────────────────────────────
  function injectGlobalCSS() {
    if (document.getElementById('nova-grab-css')) return;
    const s = document.createElement('style');
    s.id = 'nova-grab-css';
    s.textContent = `
      /* Animations */
      @keyframes nova-slide-in { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
      @keyframes nova-drop    { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
      @keyframes nova-dialog  { from { opacity:0; transform:scale(0.95);      } to { opacity:1; transform:scale(1);      } }
      @keyframes nova-bar-in  { from { opacity:0; transform:translateY(-100%); } to { opacity:1; transform:translateY(0); } }

      /* Shared panel base */
      .ng-panel {
        font-family: -apple-system,"Segoe UI",Roboto,Arial,sans-serif;
        background: linear-gradient(160deg,#050d1f,#030a18);
        border: 1px solid rgba(0,180,255,0.3);
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,200,255,0.06);
        color: #ddd;
        user-select: none;
      }

      /* Titlebar for draggable dialogs */
      .ng-titlebar {
        display:flex; align-items:center; justify-content:space-between;
        background: linear-gradient(90deg,rgba(0,100,200,0.25),rgba(0,50,120,0.2));
        border-bottom: 1px solid rgba(0,200,255,0.18);
        padding: 6px 10px;
        border-radius: 7px 7px 0 0;
        cursor: move;
      }
      .ng-titlebar-title {
        font-size: 11px; font-weight: 700; color: #00c8ff; letter-spacing: 1.5px; display:flex;align-items:center;gap:6px;
      }
      .ng-btn-icon {
        background:rgba(255,255,255,0.07); border:none; color:#888; border-radius:4px;
        width:20px; height:20px; cursor:pointer; font-size:10px; display:flex;align-items:center;justify-content:center;
        transition:background 0.15s,color 0.15s;
      }
      .ng-btn-icon:hover { background:#e53935; color:#fff; }

      /* Format list items */
      .ng-fmt-item {
        display:flex; align-items:center; gap:8px; padding:7px 12px; cursor:pointer;
        font-size:11.5px; border-bottom:1px solid rgba(255,255,255,0.04);
        transition:background 0.12s;
      }
      .ng-fmt-item:hover { background:rgba(0,200,255,0.08); }
      .ng-fmt-item:last-child { border-bottom:none; }
      .ng-fmt-badge {
        font-size:9px; font-weight:700; padding:2px 5px; border-radius:3px;
        color:#fff; min-width:38px; text-align:center;
      }

      /* Action buttons */
      .ng-action-btn {
        padding:5px 14px; border:none; border-radius:4px; cursor:pointer;
        font-size:11px; font-weight:600; color:#fff; transition:filter 0.15s,transform 0.1s;
      }
      .ng-action-btn:hover { filter:brightness(1.25); transform:scale(1.02); }
      .ng-action-btn.primary { background:linear-gradient(135deg,#1565C0,#1976D2); }
      .ng-action-btn.secondary { background:rgba(255,255,255,0.1); color:#bbb; }
      .ng-action-btn.danger { background:rgba(229,57,53,0.8); }

      /* Progress bar */
      .ng-progress-track {
        background:rgba(0,200,255,0.12); border-radius:3px; overflow:hidden; height:16px; position:relative;
      }
      .ng-progress-fill {
        height:100%; background:linear-gradient(90deg,#00c8ff,#00e676);
        border-radius:3px; transition:width 0.4s ease; position:relative;
        box-shadow: 0 0 8px rgba(0,200,255,0.5);
      }
      .ng-progress-text {
        position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
        font-size:10px; font-weight:700; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,0.8);
      }

      /* Segment bar */
      .ng-seg-track { display:flex; gap:2px; margin-top:4px; }
      .ng-seg { flex:1; height:5px; border-radius:2px; background:rgba(0,200,255,0.12); transition:background 0.3s; }
      .ng-seg.active { background:rgba(0,200,255,0.6); }
      .ng-seg.done   { background:rgba(0,230,118,0.7); }
    `;
    document.head.appendChild(s);
  }

  // ─── Draggable helper ─────────────────────────────────────────────────────
  function makeDraggable(el, handle) {
    let ox = 0, oy = 0, mx = 0, my = 0;
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      ox = el.offsetLeft; oy = el.offsetTop;
      mx = e.clientX;     my = e.clientY;
      const onMove = e2 => {
        el.style.left = (ox + e2.clientX - mx) + 'px';
        el.style.top  = (oy + e2.clientY - my) + 'px';
        el.style.right = 'auto';
      };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  // ─── STEP 1: Small "Baixar este vídeo" trigger bar ──────────────────────
  function buildTriggerBar(videoTitle, videoUrl) {
    if (document.getElementById('ng-trigger')) return;

    const bar = document.createElement('div');
    bar.id = 'ng-trigger';
    bar.className = 'ng-panel';
    bar.style.cssText = [
      'position:fixed', 'top:68px', 'right:14px', 'z-index:2147483647',
      'animation:nova-slide-in 0.35s ease-out',
      'border-radius:6px', 'overflow:visible',
    ].join(';');

    // Position near video player
    const positionNearPlayer = () => {
      const player = document.querySelector('#movie_player, ytd-player, .html5-video-player');
      if (player) {
        const r = player.getBoundingClientRect();
        if (r.width > 0) {
          bar.style.top   = Math.max(10, r.top + 8) + 'px';
          bar.style.right = 'auto';
          bar.style.left  = Math.max(0, r.right - 290) + 'px';
        }
      }
    };
    setTimeout(positionNearPlayer, 400);

    // Header strip (clickable to toggle format list)
    const strip = document.createElement('div');
    strip.style.cssText = [
      'display:flex', 'align-items:center', 'gap:8px',
      'padding:7px 12px 7px 10px',
      'cursor:pointer', 'border-radius:6px',
      'transition:background 0.15s',
    ].join(';');

    strip.innerHTML = `
      <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='%2300c8ff'%3E%3Cpath d='M5 20h14v-2H5v2zm7-18v12l-4-4-1.41 1.41L12 17.83l5.41-5.42L16 11l-4 4V2z'/%3E%3C/svg%3E" style="flex-shrink:0">
      <span style="color:#00c8ff;font-size:11.5px;font-weight:700;white-space:nowrap">Download this video</span>
      <span id="ng-stream-count" style="background:#00c8ff;color:#000;font-size:9px;font-weight:800;padding:1px 5px;border-radius:10px;min-width:14px;text-align:center">4</span>
      <span id="ng-arrow" style="color:#888;font-size:10px;margin-left:2px;transition:transform 0.2s">▼</span>
    `;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ng-btn-icon';
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = 'position:absolute;top:5px;right:6px;background:none;border:none;color:#555;cursor:pointer;font-size:11px;padding:2px;';
    closeBtn.onclick = (e) => { e.stopPropagation(); bar.remove(); };

    bar.appendChild(strip);
    bar.appendChild(closeBtn);
    makeDraggable(bar, strip); // Make trigger bar draggable

    // Format dropdown (Step 2)
    const dropdown = document.createElement('div');
    dropdown.id = 'ng-dropdown';
    dropdown.style.cssText = [
      'display:none', 'overflow:hidden',
      'border-top:1px solid rgba(0,200,255,0.15)',
      'animation:nova-drop 0.2s ease-out',
    ].join(';');

    const formats = [
      { label: '1080p HD · MP4',  fmt: '1080p', badge:'1080p', color:'#1565C0' },
      { label: '720p HD · MP4',   fmt: '720p',  badge:'720p',  color:'#1976D2' },
      { label: '360p · MP4',      fmt: '360p',  badge:'360p',  color:'#0288D1' },
      { label: 'Audio Only · MP3',fmt: 'audio', badge:'MP3',   color:'#7B1FA2' },
    ];

    formats.forEach(({ label, fmt, badge, color }) => {
      const item = document.createElement('div');
      item.className = 'ng-fmt-item';
      item.innerHTML = `
        <span class="ng-fmt-badge" style="background:${color}">${badge}</span>
        <span style="flex:1;color:#ccc">${label}</span>
        <span style="color:#555;font-size:10px">▶</span>
      `;
      item.onclick = () => {
        bar.remove();
        // Reset state for new download
        window.__novaActiveDownloadState = null;
        // IDM-style performance: trigger background download immediately on format click
        console.log('NOVA_DL:' + JSON.stringify({ url: videoUrl, format: fmt, title: videoTitle }));
        showFileInfoDialog(videoTitle, videoUrl, fmt, color);
      };
      dropdown.appendChild(item);
    });

    bar.appendChild(dropdown);

    // Toggle dropdown on click
    let open = false;
    strip.onclick = () => {
      open = !open;
      dropdown.style.display = open ? 'block' : 'none';
      document.getElementById('ng-arrow').style.transform = open ? 'rotate(180deg)' : '';
    };

    document.body.appendChild(bar);
    setTimeout(() => { if (bar.parentNode) bar.remove(); }, 35000);
  }

  // ─── STEP 3: "Info do Arquivo" dialog ────────────────────────────────
  function showFileInfoDialog(videoTitle, videoUrl, fmt, badgeColor) {
    // Real save path (yt-dlp uses %(title)s template on Node side; show user-friendly path)
    const safeTitle = (videoTitle||'video').replace(/[<>:"/\\|?*]/g,'_').substring(0,55);
    const ext = fmt === 'audio' ? 'mp3' : 'mp4';
    const defaultSave = `C:\\Users\\[user]\\Downloads\\Nova Downloads\\${safeTitle}.${ext}`;

    const dlg = document.createElement('div');
    dlg.id = 'ng-fileinfo';
    dlg.className = 'ng-panel';
    dlg.style.cssText = [
      'position:fixed', 'top:120px', 'right:14px', 'z-index:2147483647',
      'width:380px', 'animation:nova-dialog 0.25s ease-out',
    ].join(';');

    const titleBar = document.createElement('div');
    titleBar.className = 'ng-titlebar';
    titleBar.innerHTML = `
      <div class="ng-titlebar-title">
        <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='%2300c8ff'%3E%3Cpath d='M5 20h14v-2H5v2zm7-18v12l-4-4-1.41 1.41L12 17.83l5.41-5.42L16 11l-4 4V2z'/%3E%3C/svg%3E">
        Download File Info
      </div>
      <div style="display:flex;gap:4px">
        <button class="ng-btn-icon" style="background:rgba(255,255,255,0.06);color:#888" id="ng-fileinfo-close">✕</button>
      </div>
    `;

    const body = document.createElement('div');
    body.style.padding = '12px 14px';

    const field = (label, val, editable=false) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin-bottom:8px';
      const lbl = document.createElement('div');
      lbl.textContent = label;
      lbl.style.cssText = 'width:80px;font-size:10.5px;color:#777;flex-shrink:0;padding-top:3px';
      const val_el = editable ? document.createElement('input') : document.createElement('div');
      val_el.style.cssText = `flex:1;font-size:11px;color:${editable?'#fff':'#ccc'};${editable?'background:rgba(0,0,0,0.4);border:1px solid rgba(0,200,255,0.2);border-radius:4px;padding:3px 7px;outline:none;':'word-break:break-all;'}`;
      if (editable) { val_el.value = val; val_el.id = 'ng-savepath'; }
      else val_el.textContent = val;
      row.appendChild(lbl);
      row.appendChild(val_el);
      return row;
    };

    body.appendChild(field('URL', videoUrl.substring(0,55) + (videoUrl.length>55?'…':'')));
    body.appendChild(field('Format', fmt.toUpperCase() + ' · ' + (fmt==='audio'?'MP3':'MP4')));
    body.appendChild(field('Save folder', 'Nova Downloads  (C:\\Users\\[user]\\Downloads)'));

    // Save note
    const saveNote = document.createElement('div');
    saveNote.style.cssText = 'font-size:10px;color:#555;margin:0 0 10px 0;padding:5px 8px;background:rgba(0,200,255,0.06);border-radius:4px;border-left:2px solid rgba(0,200,255,0.3)';
    saveNote.textContent = '📁 Files saved to: Nova Downloads folder in your Downloads.';
    body.appendChild(saveNote);

    // Cancel download utility
    const cancelDownload = () => {
      console.log('NOVA_CANCEL_DL:' + JSON.stringify({ url: videoUrl }));
    };

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px;margin-top:2px';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ng-action-btn secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
      cancelDownload();
      dlg.remove();
    };

    const laterBtn = document.createElement('button');
    laterBtn.className = 'ng-action-btn secondary';
    laterBtn.textContent = 'Download Later';
    laterBtn.onclick = () => {
      cancelDownload();
      dlg.remove();
    };

    const startBtn = document.createElement('button');
    startBtn.className = 'ng-action-btn primary';
    startBtn.textContent = '▶ Start Download';
    startBtn.onclick = () => {
      dlg.remove();
      showProgressDialog(videoTitle, videoUrl, fmt, badgeColor);
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(laterBtn);
    btnRow.appendChild(startBtn);
    body.appendChild(btnRow);

    dlg.appendChild(titleBar);
    dlg.appendChild(body);
    document.body.appendChild(dlg);
    makeDraggable(dlg, titleBar);

    titleBar.querySelector('#ng-fileinfo-close').onclick = () => {
      cancelDownload();
      dlg.remove();
    };
  }

  // ─── STEP 4: IDM-style progress dialog ───────────────────────────────────
  function showProgressDialog(videoTitle, videoUrl, fmt, badgeColor) {
    const dlg = document.createElement('div');
    dlg.id = 'ng-progress-dlg';
    dlg.className = 'ng-panel';
    dlg.style.cssText = [
      'position:fixed', 'top:130px', 'right:14px', 'z-index:2147483647',
      'width:420px', 'animation:nova-dialog 0.25s ease-out',
    ].join(';');

    // Titlebar
    const titleBar = document.createElement('div');
    titleBar.className = 'ng-titlebar';
    const shortTitle = (videoTitle||'').substring(0,45) + ((videoTitle?.length>45)?'…':'');
    titleBar.innerHTML = `
      <div class="ng-titlebar-title">
        <span style="background:${badgeColor||'#1565C0'};color:#fff;font-size:9px;padding:1px 5px;border-radius:3px">${fmt.toUpperCase()}</span>
        ${shortTitle}
      </div>
      <div style="display:flex;gap:4px">
        <button class="ng-btn-icon" title="Minimizar" id="ng-minimize-btn" style="background:rgba(255,255,255,0.06);color:#888">—</button>
        <button class="ng-btn-icon" id="ng-close-prog-btn" style="background:rgba(255,255,255,0.06);color:#888">✕</button>
      </div>
    `;

    // Tab bar (like IDM)
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;gap:0;border-bottom:1px solid rgba(0,200,255,0.15);padding:0 12px';
    ['Download status','Speed Limiter','Options on completion'].forEach((t, i) => {
      const tab = document.createElement('div');
      tab.textContent = t;
      tab.style.cssText = `padding:6px 10px;font-size:10px;cursor:pointer;color:${i===0?'#00c8ff':'#666'};border-bottom:${i===0?'2px solid #00c8ff':'2px solid transparent'};margin-bottom:-1px;`;
      tabs.appendChild(tab);
    });

    // Body
    const body = document.createElement('div');
    body.style.padding = '12px 14px 10px';

    // URL row
    const urlRow = document.createElement('div');
    urlRow.style.cssText = 'font-size:10px;color:#555;margin-bottom:10px;word-break:break-all;line-height:1.4';
    urlRow.textContent = videoUrl.substring(0,80) + (videoUrl.length>80?'…':'');
    body.appendChild(urlRow);

    // Stats table
    const stats = document.createElement('div');
    stats.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-bottom:12px';
    const statRow = (label, id, val='—') => {
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;justify-content:space-between;font-size:10.5px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04)';
      div.innerHTML = `<span style="color:#666">${label}</span><span id="${id}" style="color:#00c8ff;font-weight:600">${val}</span>`;
      return div;
    };
    stats.appendChild(statRow('Status',       'ng-s-status', 'Connecting…'));
    stats.appendChild(statRow('Transfer rate','ng-s-speed',  '—'));
    stats.appendChild(statRow('File size',    'ng-s-size',   '—'));
    stats.appendChild(statRow('Time left',    'ng-s-eta',    '—'));
    stats.appendChild(statRow('Downloaded',   'ng-s-dled',   '—'));
    stats.appendChild(statRow('Resume',       'ng-s-resume', 'Yes'));
    body.appendChild(stats);

    // Progress bar
    const track = document.createElement('div');
    track.className = 'ng-progress-track';
    track.style.margin = '8px 0 5px';
    const fill = document.createElement('div');
    fill.className = 'ng-progress-fill';
    fill.id = 'ng-prog-fill';
    fill.style.width = '0%';
    const pctText = document.createElement('div');
    pctText.className = 'ng-progress-text';
    pctText.id = 'ng-prog-pct';
    pctText.textContent = '0%';
    fill.appendChild(pctText);
    track.appendChild(fill);
    body.appendChild(track);

    // Segment bar
    const segTrack = document.createElement('div');
    segTrack.className = 'ng-seg-track';
    for (let i = 0; i < 10; i++) {
      const seg = document.createElement('div');
      seg.className = 'ng-seg';
      seg.id = 'ng-seg-' + i;
      segTrack.appendChild(seg);
    }
    body.appendChild(segTrack);

    // Segment label
    const segLabel = document.createElement('div');
    segLabel.style.cssText = 'font-size:9px;color:#444;margin:4px 0 10px;text-align:center';
    segLabel.textContent = 'Download progress by segments';
    body.appendChild(segLabel);

    // Action buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;border-top:1px solid rgba(255,255,255,0.06);padding-top:9px';
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'ng-action-btn secondary';
    pauseBtn.id = 'ng-pause-btn';
    pauseBtn.textContent = '⏸ Pause';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ng-action-btn danger';
    cancelBtn.textContent = '✕ Cancel';
    cancelBtn.onclick = () => {
      console.log('NOVA_CANCEL_DL:' + JSON.stringify({ url: videoUrl }));
      dlg.remove();
    };
    btnRow.appendChild(pauseBtn);
    btnRow.appendChild(cancelBtn);
    body.appendChild(btnRow);

    dlg.appendChild(titleBar);
    dlg.appendChild(tabs);
    dlg.appendChild(body);
    document.body.appendChild(dlg);
    makeDraggable(dlg, titleBar);

    // Initialize from cached state if it exists
    if (window.__novaActiveDownloadState) {
      window.__novaUpdateProgress(window.__novaActiveDownloadState);
    }

    // Minimize toggle
    let minimized = false;
    document.getElementById('ng-minimize-btn').onclick = () => {
      minimized = !minimized;
      body.style.display = minimized ? 'none' : 'block';
      tabs.style.display = minimized ? 'none' : 'flex';
    };
    document.getElementById('ng-close-prog-btn').onclick = () => {
      console.log('NOVA_CANCEL_DL:' + JSON.stringify({ url: videoUrl }));
      dlg.remove();
    };

    // Segment animation
    let tick = 0;
    const segTimer = setInterval(() => {
      if (!document.getElementById('ng-progress-dlg')) { clearInterval(segTimer); return; }
      const pct = parseFloat(document.getElementById('ng-prog-fill')?.style.width || '0');
      const active = Math.floor(pct / 10);
      for (let i = 0; i < 10; i++) {
        const seg = document.getElementById('ng-seg-' + i);
        if (!seg) continue;
        if (i < active) seg.style.background = 'rgba(0,230,118,0.7)';
        else if (i === active) seg.style.background = `rgba(0,200,255,${0.4 + 0.3 * Math.sin(tick*0.4)})`;
        else seg.style.background = 'rgba(0,200,255,0.1)';
      }
      tick++;
    }, 150);
  }

  // ─── __novaUpdateProgress: called by Node.js via page.evaluate ────────────
  window.__novaActiveDownloadState = null;
  window.__novaUpdateProgress = function (data) {
    if (!window.__novaActiveDownloadState) {
      window.__novaActiveDownloadState = {};
    }
    // Merge new data fields into the global state
    Object.assign(window.__novaActiveDownloadState, data);

    const activeState = window.__novaActiveDownloadState;
    const totalSize = data.downloaded || activeState.downloaded;
    const progressPct = data.progress != null ? data.progress : activeState.progress;

    const setText = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.textContent = val; };
    if (data.progress != null) {
      const fill = document.getElementById('ng-prog-fill');
      if (fill) fill.style.width = data.progress + '%';
      setText('ng-prog-pct', data.progress.toFixed(1) + '%');
    }
    if (data.speed)      setText('ng-s-speed',  data.speed);
    
    if (totalSize) {
      setText('ng-s-size', totalSize);
      if (progressPct != null) {
        const m = totalSize.match(/([0-9.]+)\s*([a-zA-Z]+)/);
        if (m) {
          const num = parseFloat(m[1]);
          const unit = m[2];
          const dled = ((progressPct * num) / 100).toFixed(2);
          setText('ng-s-dled', `${dled} ${unit} (${progressPct.toFixed(1)}%)`);
        } else {
          setText('ng-s-dled', totalSize);
        }
      }
    }

    if (data.eta)        setText('ng-s-eta',     data.eta);
    if (data.status) {
      setText('ng-s-status', data.status);
      if (data.status === 'COMPLETE') {
        const fill = document.getElementById('ng-prog-fill');
        if (fill) { fill.style.width = '100%'; fill.style.background = 'linear-gradient(90deg,#00e676,#69f0ae)'; }
        setText('ng-prog-pct', '100% — Done!');
        
        // Show IDM-style post-download actions: Open File / Open Folder / Close
        const btnRow = document.querySelector('#ng-progress-dlg .ng-action-btn')?.parentNode;
        if (btnRow) {
          btnRow.innerHTML = '';
          btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;border-top:1px solid rgba(255,255,255,0.06);padding-top:9px';
          
          const defaultPath = 'C:/Users/loq/Downloads/Nova Downloads';
          
          const openFolderBtn = document.createElement('button');
          openFolderBtn.className = 'ng-action-btn primary';
          openFolderBtn.style.cssText = 'padding:5px 14px;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;color:#fff;background:linear-gradient(135deg,#1565C0,#1976D2);';
          openFolderBtn.innerHTML = '📁 Open Folder';
          openFolderBtn.onclick = () => {
            console.log('NOVA_OPEN_FOLDER:' + (data.filePath || defaultPath));
          };
          
          const closeBtn = document.createElement('button');
          closeBtn.className = 'ng-action-btn secondary';
          closeBtn.style.cssText = 'padding:5px 14px;border:none;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;color:#bbb;background:rgba(255,255,255,0.1);';
          closeBtn.innerHTML = '✕ Close';
          closeBtn.onclick = () => {
            const d = document.getElementById('ng-progress-dlg');
            if (d) d.remove();
          };
          
          btnRow.appendChild(openFolderBtn);
          btnRow.appendChild(closeBtn);
        }
      }
      if (data.status === 'ERROR') {
        const fill = document.getElementById('ng-prog-fill');
        if (fill) fill.style.background = 'linear-gradient(90deg,#e53935,#ef5350)';
      }
    }
  };

  // ─── Main: get title and url, build trigger bar ────────────────────────────
  function getTitle() {
    return (
      document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() ||
      document.querySelector('#above-the-fold #title h1')?.textContent?.trim() ||
      document.querySelector('#title h1')?.textContent?.trim() ||
      document.title.replace(/ - YouTube$/, '').trim() ||
      'YouTube Video'
    );
  }

  function tryBuild() {
    if (!location.href.includes('/watch')) return;
    if (document.getElementById('ng-trigger')) return;
    injectGlobalCSS();
    const videoTitle = getTitle();
    const videoUrl   = location.href.split('&list=')[0].split('&index=')[0];
    buildTriggerBar(videoTitle, videoUrl);
  }

  // ─── 4 Injection Strategies ───────────────────────────────────────────────
  new MutationObserver(() => {
    if (location.href.includes('/watch') && !document.getElementById('ng-trigger')) tryBuild();
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('yt-navigate-finish', () => {
    ['ng-trigger','ng-dropdown','ng-fileinfo','ng-progress-dlg'].forEach(id => {
      const el = document.getElementById(id); if (el) el.remove();
    });
    if (location.href.includes('/watch')) setTimeout(tryBuild, 1500);
  });

  setTimeout(tryBuild, 2000);

  setInterval(() => {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      ['ng-trigger','ng-fileinfo','ng-progress-dlg'].forEach(id => {
        const el = document.getElementById(id); if (el) el.remove();
      });
      if (location.href.includes('/watch')) setTimeout(tryBuild, 1500);
    }
  }, 1000);

})();
