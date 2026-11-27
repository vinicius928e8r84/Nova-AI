(function () {
  'use strict';

  const CSS_DO_NOVA_GRAB = `
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

  const FORMATOS = [
    { label: '1080p HD · MP4',  fmt: '1080p', badge:'1080p', color:'#1565C0' },
    { label: '720p HD · MP4',   fmt: '720p',  badge:'720p',  color:'#1976D2' },
    { label: '360p · MP4',      fmt: '360p',  badge:'360p',  color:'#0288D1' },
    { label: 'Audio Only · MP3',fmt: 'audio', badge:'MP3',   color:'#7B1FA2' },
  ];

  const ESTATISTICAS = [
    ['Status',       'ng-s-status', 'Connecting…'],
    ['Transfer rate','ng-s-speed',  '—'],
    ['File size',    'ng-s-size',   '—'],
    ['Time left',    'ng-s-eta',    '—'],
    ['Downloaded',   'ng-s-dled',   '—'],
    ['Resume',       'ng-s-resume', 'Yes'],
  ];

  const ESTILO_DOS_BOTOES_DA_INFO = 'display:flex;justify-content:flex-end;gap:8px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px;margin-top:2px';
  const ESTILO_DOS_BOTOES_DO_PROGRESSO = 'display:flex;justify-content:flex-end;gap:8px;border-top:1px solid rgba(255,255,255,0.06);padding-top:9px';
  const SELETORES_DO_TITULO = ['h1.ytd-watch-metadata yt-formatted-string', '#above-the-fold #title h1', '#title h1'];

  window.__novaGrabDados = { CSS_DO_NOVA_GRAB, FORMATOS, ESTATISTICAS, ESTILO_DOS_BOTOES_DA_INFO, ESTILO_DOS_BOTOES_DO_PROGRESSO, SELETORES_DO_TITULO };
})();
