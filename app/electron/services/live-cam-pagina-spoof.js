'use strict';

const SPOOF_DO_CELULAR = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <title>Nova AI - Stonic Mobile Spoof Cam</title>
    <style>
        * { margin:0; padding:0; box-sizing:border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-tap-highlight-color: transparent; }
        body { background:#000; color:#fff; height:100vh; width:100vw; overflow:hidden; display:flex; flex-direction:column; position:relative; }
        
        .video-wrapper { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:#000; overflow:hidden; }
        video { width:100%; height:100%; object-fit:cover; transition:transform 0.2s ease; }
        video.mirrored { transform:scaleX(-1); }
        video.contain { object-fit:contain; }
        
        /* Camera Simulation HUD Overlay */
        .hud-overlay { position:absolute; inset:0; pointer-events:none; display:flex; flex-direction:column; justify-content:space-between; padding:20px 16px env(safe-area-inset-bottom, 20px) 16px; z-index:10; transition:opacity 0.3s ease; }
        .hud-overlay.hidden { opacity:0; }
        
        .hud-top { display:flex; justify-content:space-between; align-items:center; }
        .rec-badge { display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px); padding:6px 12px; border-radius:20px; font-size:11px; font-weight:800; font-family:monospace; border:1px solid rgba(255,255,255,0.15); }
        .rec-dot { width:10px; height:10px; border-radius:50%; background:#ef4444; animation:blink 1s infinite; }
        @keyframes blink { 0%, 100% { opacity:1; } 50% { opacity:0.3; } }
        .hud-specs { font-size:11px; font-weight:800; font-family:monospace; color:#00E5FF; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px); padding:6px 12px; border-radius:20px; border:1px solid rgba(0,229,255,0.3); }
        
        /* Focus Reticle */
        .focus-box { position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); width:120px; height:120px; border:1.5px solid rgba(255,255,255,0.4); border-radius:12px; pointer-events:none; }
        .focus-box::before { content:''; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:6px; height:6px; background:#00E5FF; border-radius:50%; }
        
        /* Floating Interactive Controls */
        .controls-layer { position:absolute; bottom:24px; left:16px; right:16px; display:flex; justify-content:center; gap:10px; z-index:20; }
        .ctrl-btn { padding:12px 18px; border-radius:16px; background:rgba(15,23,42,0.85); backdrop-filter:blur(12px); border:1px solid rgba(255,255,255,0.2); color:#fff; font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:1px; cursor:pointer; display:flex; align-items:center; gap:6px; box-shadow:0 8px 24px rgba(0,0,0,0.6); }
        .ctrl-btn.active { background:#00E5FF; color:#050A10; border-color:#00E5FF; }
        .ctrl-btn.sound { background:rgba(0,255,143,0.2); border-color:rgba(0,255,143,0.5); color:#00ff8f; }
        
        /* Empty State Modal */
        .empty-overlay { position:absolute; inset:0; background:rgba(5,10,16,0.96); display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; text-align:center; z-index:30; }
        .empty-icon { width:70px; height:70px; border-radius:24px; background:rgba(0,229,255,0.1); border:2px solid rgba(0,229,255,0.3); display:flex; align-items:center; justify-content:center; font-size:32px; margin-bottom:16px; animation:float 3s ease-in-out infinite; }
        @keyframes float { 0%, 100% { transform:translateY(0); } 50% { transform:translateY(-8px); } }
        .empty-title { font-size:18px; font-weight:900; color:#00E5FF; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:8px; }
        .empty-desc { font-size:13px; color:#94a3b8; max-width:280px; line-height:1.5; }
    </style>
</head>
<body>
    <div class="video-wrapper" id="videoWrapper">
        <video id="spoofVideo" src="/api/spoof-video" autoplay loop playsinline muted></video>
        
        <div class="hud-overlay" id="hudOverlay">
            <div class="hud-top">
                <div class="rec-badge"><div class="rec-dot"></div> REC <span id="timecode">00:00:00</span></div>
                <div class="hud-specs">4K 60FPS • RAW</div>
            </div>
            <div class="focus-box"></div>
            <div style="font-size:10px; font-family:monospace; color:rgba(255,255,255,0.4); text-align:center;">LIVE VIRTUAL CAM BROADCAST</div>
        </div>

        <div class="controls-layer" id="controlsLayer">
            <button class="ctrl-btn" id="btnHud" title="Toggle Camera HUD">📸 HUD</button>
            <button class="ctrl-btn" id="btnFlip" title="Mirror View">🔄 Flip</button>
            <button class="ctrl-btn" id="btnFit" title="Aspect Ratio">📐 Fit</button>
            <button class="ctrl-btn sound" id="btnSound" title="Mute/Unmute">🔊 Audio</button>
            <button class="ctrl-btn" id="btnFull" title="Fullscreen">⛶ Max</button>
        </div>
    </div>

    <div class="empty-overlay" id="emptyOverlay" style="display:none;">
        <div class="empty-icon">📹</div>
        <div class="empty-title">Waiting for Video</div>
        <div class="empty-desc">Please upload or select a spoof video on the Nova AI PC Dashboard. The video will play here live automatically!</div>
    </div>

    <script>
        const video = document.getElementById('spoofVideo');
        const hud = document.getElementById('hudOverlay');
        const empty = document.getElementById('emptyOverlay');
        const timecodeEl = document.getElementById('timecode');
        const btnHud = document.getElementById('btnHud');
        const btnFlip = document.getElementById('btnFlip');
        const btnFit = document.getElementById('btnFit');
        const btnSound = document.getElementById('btnSound');
        const btnFull = document.getElementById('btnFull');

        let isMirrored = false;
        let isFitContain = false;
        let isHudVisible = true;
        let isMuted = true;
        let startTime = Date.now();

        // Update live timecode
        setInterval(() => {
            if (!video.paused) {
                const totalSeconds = Math.floor(video.currentTime || ((Date.now() - startTime) / 1000));
                const hrs = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
                const mins = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
                const secs = String(totalSeconds % 60).padStart(2, '0');
                timecodeEl.textContent = hrs + ':' + mins + ':' + secs;
            }
        }, 500);

        // Video Error Check
        video.onerror = () => {
            empty.style.display = 'flex';
        };

        video.onloadeddata = () => {
            empty.style.display = 'none';
            video.play().catch(() => {});
        };

        // Button Listeners
        btnHud.addEventListener('click', () => {
            isHudVisible = !isHudVisible;
            hud.classList.toggle('hidden', !isHudVisible);
            btnHud.classList.toggle('active', isHudVisible);
        });

        btnFlip.addEventListener('click', () => {
            isMirrored = !isMirrored;
            video.classList.toggle('mirrored', isMirrored);
            btnFlip.classList.toggle('active', isMirrored);
        });

        btnFit.addEventListener('click', () => {
            isFitContain = !isFitContain;
            video.classList.toggle('contain', isFitContain);
            btnFit.classList.toggle('active', isFitContain);
        });

        btnSound.addEventListener('click', () => {
            isMuted = !isMuted;
            video.muted = isMuted;
            btnSound.textContent = isMuted ? '🔇 Audio' : '🔊 Audio';
            btnSound.classList.toggle('active', !isMuted);
            video.play().catch(() => {});
        });

        btnFull.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
        });

        function carregarVideoDoSpoof(msg) {
            if (msg.hasVideo) {
                empty.style.display = 'none';
                video.src = '/api/spoof-video?t=' + Date.now();
                video.load();
                video.play().catch(() => {});
            } else {
                empty.style.display = 'flex';
            }
        }

        const comandosDoSpoof = new Map([
            ['load-video', carregarVideoDoSpoof],
            ['spoof-state', carregarVideoDoSpoof],
            ['play', () => video.play().catch(() => {})],
            ['pause', () => video.pause()],
            ['restart', () => {
                video.currentTime = 0;
                video.play().catch(() => {});
            }],
            ['speed', (msg) => {
                if (msg.speed) {
                    video.playbackRate = msg.speed;
                }
            }]
        ]);

        // WebSocket Bi-Directional Synchronization with PC Dashboard
        function connectWs() {
            const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(proto + '//' + location.host + '/?role=spoof-viewer');

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    const comando = comandosDoSpoof.get(msg.type);
                    if (comando) {
                        comando(msg);
                    }
                } catch (e) {}
            };

            ws.onclose = () => {
                setTimeout(connectWs, 2000);
            };
        }

        connectWs();

        // Autoplay helper for mobile iOS/Android
        document.body.addEventListener('click', () => {
            if (video.paused) {
                video.play().catch(() => {});
            }
        }, { once: true });
    </script>
</body>
</html>`;

module.exports = { SPOOF_DO_CELULAR };
