'use strict';

const { ensureProfileStealthSpecs } = require('./perfil-da-fazenda');

const STEALTH_SCRIPT = `
(function() {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  } catch(e) {}
})();
`;

const DETECT_EMAIL_SCRIPT = `
(function() {
  try {
    const isEmail = (str) => {
      if (!str) return false;
      return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/.test(str.trim());
    };

    // 1. Google accounts signout button aria-label
    let signOutBtn = document.querySelector('a[href*="SignOutOptions"]');
    if (signOutBtn) {
      let label = signOutBtn.getAttribute('aria-label') || '';
      let match = label.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/);
      if (match && isEmail(match[0])) return match[0];
    }

    // 2. Elements with data-email attribute
    let dataEmailEl = document.querySelector('[data-email]');
    if (dataEmailEl) {
      let email = dataEmailEl.getAttribute('data-email');
      if (isEmail(email)) return email;
    }

    // 3. Input value that looks like an email
    let emailInput = document.querySelector('input[type="email"], input[name="identifier"], input[id*="email" i], input[name*="email" i]');
    if (emailInput && emailInput.value && isEmail(emailInput.value)) {
      return emailInput.value;
    }

    // 4. Header elements
    let profileHeader = document.querySelector('div[aria-label*="@"], div[title*="@"]');
    if (profileHeader) {
      let val = profileHeader.getAttribute('aria-label') || profileHeader.getAttribute('title') || '';
      let match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/);
      if (match && isEmail(match[0])) return match[0];
    }

    // 5. Common profile / account containers
    let elements = document.querySelectorAll('[class*="profile" i], [class*="user" i], [class*="account" i], [id*="profile" i], [id*="user" i], [id*="account" i], header, nav');
    for (let el of elements) {
      let text = el.innerText || '';
      let match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/);
      if (match && isEmail(match[0])) {
        const email = match[0].toLowerCase();
        if (!email.includes('support') && !email.includes('info') && !email.includes('help') && !email.includes('service') && !email.includes('noreply')) {
          return match[0];
        }
      }
    }

    // 6. Generic body search
    let bodyText = document.body ? document.body.innerText : '';
    let match = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/);
    if (match && isEmail(match[0])) {
      const email = match[0].toLowerCase();
      if (!email.includes('support') && !email.includes('info') && !email.includes('help') && !email.includes('service') && !email.includes('noreply')) {
        return match[0];
      }
    }
  } catch(e) {}
  return null;
})();
`;

const BYPASS_POPUPS_SCRIPT = `
(function() {
  try {
    const notNowPatterns = [/not now/i, /not_now/i, /dismiss/i, /close/i, /cancel/i, /no thanks/i, /later/i, /not now, thanks/i];
    
    const matchesPattern = (text) => {
      if (!text) return false;
      const clean = text.trim().toLowerCase();
      if (clean.length > 40) return false;
      return notNowPatterns.some(pat => pat.test(clean));
    };

    const checkAndClick = (el) => {
      if (!el) return false;
      const text = el.textContent || el.innerText || '';
      if (matchesPattern(text)) {
        const clickTarget = el.closest('button') || el.closest('a') || el;
        clickTarget.click();
        const rect = clickTarget.getBoundingClientRect();
        const opts = { bubbles: true, view: window, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 };
        clickTarget.dispatchEvent(new MouseEvent('mousedown', opts));
        clickTarget.dispatchEvent(new MouseEvent('mouseup', opts));
        clickTarget.dispatchEvent(new MouseEvent('click', opts));
        return true;
      }
      return false;
    };

    const elements = document.querySelectorAll('button, a, div, span, p, [role="button"]');
    for (let el of elements) {
      if (checkAndClick(el)) return true;
    }

    const scanShadowDOM = (root) => {
      if (!root) return false;
      const shadowEls = root.querySelectorAll('*');
      for (let el of shadowEls) {
        if (el.shadowRoot) {
          if (scanShadowDOM(el.shadowRoot)) return true;
        }
        if (checkAndClick(el)) return true;
      }
      return false;
    };
    if (scanShadowDOM(document)) return true;

    let closeBtn = document.querySelector('[aria-label*="close" i], [class*="close" i] button, [class*="modal" i] svg, .tiktok-modal-close, [class*="ButtonClose"]');
    if (closeBtn) {
      closeBtn.click();
      return true;
    }
  } catch(e) {}
  return false;
})();
`;

const SCRIPT_DE_CURTIR = `
      (async () => {
        try {
          // Human scroll simulation
          window.scrollBy({ top: 350, behavior: 'smooth' });
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
          window.scrollTo({ top: 0, behavior: 'smooth' });
          await new Promise(r => setTimeout(r, 1500));

          // YouTube selectors
          let btn = document.querySelector(
            'ytd-toggle-button-renderer:first-child button[aria-pressed], ' +
            '#top-level-buttons-computed ytd-toggle-button-renderer:first-child button, ' +
            'button[aria-label*="like" i]:not([aria-label*="dislike" i])'
          );
          // TikTok
          if (!btn) btn = document.querySelector('[data-e2e="like-icon"], [class*="likeWrapper"]');
          // Instagram
          if (!btn) btn = document.querySelector('svg[aria-label*="Like" i]')?.closest('button');
          // Twitter
          if (!btn) btn = document.querySelector('[data-testid="like"]');

          if (!btn) return { success: false, error: 'Like button not found — try scrolling or logging in' };

          // Random offset jitter
          const rect = btn.getBoundingClientRect();
          btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: rect.x + (Math.random()-0.5)*6, clientY: rect.y + (Math.random()-0.5)*6 }));
          await new Promise(r => setTimeout(r, Math.random() * 500 + 400));
          btn.click();
          return { success: true };
        } catch(e) { return { success: false, error: e.message }; }
      })()
    `;

const SCRIPT_DE_INSCREVER = `
      (async () => {
        try {
          // Simulate reading comments / human scrolling before subscribing
          window.scrollBy({ top: 450, behavior: 'smooth' });
          await new Promise(r => setTimeout(r, 2500 + Math.random() * 1000));
          window.scrollBy({ top: -300, behavior: 'smooth' });
          await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
          window.scrollTo({ top: 0, behavior: 'smooth' });
          await new Promise(r => setTimeout(r, 1500));

          let btn = document.querySelector(
            'ytd-subscribe-button-renderer button, tp-yt-paper-button#subscribe-button, ' +
            'button[aria-label*="Subscribe" i], [class*="subscribe" i] button, ' +
            '[data-e2e="follow-button"], button[class*="follow" i]'
          );
          if (!btn) return { success: false, error: 'Subscribe/Follow button not found' };

          // Hover and wait
          btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
          btn.click();
          return { success: true };
        } catch(e) { return { success: false, error: e.message }; }
      })()
    `;

const scriptDeComentar = text => `
      (async () => {
        try {
          window.scrollBy({ top: 700, behavior: 'smooth' });
          await new Promise(r => setTimeout(r, 2200));

          let box = document.querySelector(
            '#simplebox-placeholder, [aria-label*="Add a comment" i], ' +
            '[placeholder*="comment" i], .DPvwYc, [contenteditable="true"]'
          );
          if (!box) return { success: false, error: 'Comment box not found' };

          box.click();
          await new Promise(r => setTimeout(r, 800));

          // Type human-like
          const text = ${JSON.stringify(text)};
          const active = document.activeElement;
          for (const ch of text) {
            const ev = new KeyboardEvent('keypress', { key: ch, charCode: ch.charCodeAt(0), bubbles: true });
            active.dispatchEvent(new InputEvent('input', { data: ch, inputType: 'insertText', bubbles: true }));
            if (active.isContentEditable) {
              document.execCommand('insertText', false, ch);
            } else {
              active.value = (active.value || '') + ch;
              active.dispatchEvent(new Event('input', { bubbles: true }));
            }
            await new Promise(r => setTimeout(r, Math.random() * 90 + 50));
          }

          await new Promise(r => setTimeout(r, 1200));

          const submitBtn = document.querySelector(
            '[aria-label="Comment" i], #submit-button button, button[type="submit"], ' +
            '.commentBox-submitBtn, [data-e2e="comment-post"]'
          );
          if (submitBtn) { submitBtn.click(); return { success: true }; }
          return { success: false, error: 'Submit button not found' };
        } catch(e) { return { success: false, error: e.message }; }
      })()
    `;

const SCRIPT_DE_COMPARTILHAR = `
      (async () => {
        try {
          const btn = document.querySelector(
            'button[aria-label*="share" i], [data-e2e="share-icon"], ' +
            '[aria-label*="Share" i], .share-button'
          );
          if (!btn) return { success: false, error: 'Share button not found' };
          btn.click();
          return { success: true };
        } catch(e) { return { success: false, error: e.message }; }
      })()
    `;

const secaoDaPlataforma = v => `
      (function() {
        try {
          // 1. Spoof Navigator Platform
          Object.defineProperty(navigator, 'platform', { get: () => ${JSON.stringify(v.platformStr)} });
          
`;

const secaoDoCanvas = v => `          // 2. Spoof Canvas Fingerprinting with dynamic, seed-based noise
          if (${v.canvasNoise}) {
            const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
            CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
              const res = originalGetImageData.apply(this, arguments);
              if (res.data) {
                const seed = ${v.profile.canvasNoiseSeed || 42};
                for (let i = 0; i < res.data.length; i += 4) {
                  // Coordinate-dependent pseudo-random noise consistent for this profile seed
                  res.data[i] = (res.data[i] + ((i + seed) % 3)) % 256;
                }
              }
              return res;
            };

            const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function() {
              const ctx = this.getContext('2d');
              if (ctx) {
                try {
                  const oldFillStyle = ctx.fillStyle;
                  ctx.fillStyle = 'rgba(255,255,255,0.01)';
                  ctx.fillRect(0, 0, 1, 1);
                  ctx.fillStyle = oldFillStyle;
                } catch(e) {}
              }
              return originalToDataURL.apply(this, arguments);
            };
          }

`;

const secaoDoWebgl = v => `          // 3. Spoof WebGL Vendor/Renderer
          if (${v.webglNoise}) {
            const getParameterProxy = function(originalGetParameter) {
              return function(parameter) {
                if (parameter === 37445) return ${JSON.stringify(v.webglVendor)};
                if (parameter === 37446) return ${JSON.stringify(v.webglRenderer)};
                return originalGetParameter.apply(this, arguments);
              };
            };
            if (window.WebGLRenderingContext) {
              WebGLRenderingContext.prototype.getParameter = getParameterProxy(WebGLRenderingContext.prototype.getParameter);
            }
            if (window.WebGL2RenderingContext) {
              WebGL2RenderingContext.prototype.getParameter = getParameterProxy(WebGL2RenderingContext.prototype.getParameter);
            }
          }

`;

const secaoDaImagemDoWebgl = v => `          // 3b. WebGL Image noise (readPixels)
          if (${v.webglImageNoise}) {
            const seed = ${v.profile.webglNoiseSeed || 88};
            if (window.WebGLRenderingContext) {
              const originalReadPixels = WebGLRenderingContext.prototype.readPixels;
              WebGLRenderingContext.prototype.readPixels = function(x, y, width, height, format, type, pixels) {
                originalReadPixels.apply(this, arguments);
                if (pixels && pixels.length > 0) {
                  for (let i = 0; i < Math.min(pixels.length, 100); i++) {
                    pixels[i] = (pixels[i] + ((i + seed) % 3)) % 256;
                  }
                }
              };
            }
            if (window.WebGL2RenderingContext) {
              const originalReadPixels2 = WebGL2RenderingContext.prototype.readPixels;
              WebGL2RenderingContext.prototype.readPixels = function(x, y, width, height, format, type, pixels) {
                originalReadPixels2.apply(this, arguments);
                if (pixels && pixels.length > 0) {
                  for (let i = 0; i < Math.min(pixels.length, 100); i++) {
                    pixels[i] = (pixels[i] + ((i + seed) % 3)) % 256;
                  }
                }
              };
            }
          }

`;

const secaoDoAudio = v => `          // 4. Spoof AudioContext sound card signature with consistent seed-based offset
          if (${v.audioNoise}) {
            if (window.AudioBuffer) {
              const originalGetChannelData = AudioBuffer.prototype.getChannelData;
              const seed = ${v.profile.audioNoiseSeed || 0.0000001};
              AudioBuffer.prototype.getChannelData = function(channel) {
                const data = originalGetChannelData.apply(this, arguments);
                if (data && data.length > 0) {
                  for (let i = 0; i < Math.min(data.length, 50); i++) {
                    data[i] += seed * ((i % 3) - 1);
                  }
                }
                return data;
              };
            }
          }

`;

const secaoDosDispositivos = v => `          // 5. Media Devices Virtualization (Isolate names & IDs per profile environment)
          if (${v.mediaDeviceNoise}) {
            if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
              navigator.mediaDevices.enumerateDevices = async function() {
                return [
                  {
                    deviceId: ${v.dispositivos.camId},
                    kind: 'videoinput',
                    label: ${v.dispositivos.camLabel},
                    groupId: ${v.dispositivos.camGroup}
                  },
                  {
                    deviceId: ${v.dispositivos.micId},
                    kind: 'audioinput',
                    label: ${v.dispositivos.micLabel},
                    groupId: ${v.dispositivos.micGroup}
                  },
                  {
                    deviceId: ${v.dispositivos.speakerId},
                    kind: 'audiooutput',
                    label: ${v.dispositivos.speakerLabel},
                    groupId: ${v.dispositivos.speakerGroup}
                  }
                ];
              };
            }
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
              const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
              navigator.mediaDevices.getUserMedia = async function(constraints) {
                const cloned = Object.assign({}, constraints);
                if (cloned.video && typeof cloned.video === 'object') {
                  if (cloned.video.deviceId) {
                    delete cloned.video.deviceId;
                  }
                }
                return originalGetUserMedia.call(navigator.mediaDevices, cloned);
              };
            }
          }

`;

const secaoDosRetangulos = v => `          // 6. ClientRects Noise (getBoundingClientRect and getClientRects)
          if (${v.clientRectsNoise}) {
            const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
            Element.prototype.getBoundingClientRect = function() {
              const r = origGetBoundingClientRect.apply(this, arguments);
              return new DOMRect(r.x + 0.0001, r.y + 0.0001, r.width + 0.0002, r.height + 0.0002);
            };
          }

`;

const secaoDasVozes = v => `          // 7. SpeechVoices Noise
          if (${v.speechVoicesNoise}) {
            if (window.speechSynthesis) {
              const origGetVoices = SpeechSynthesis.prototype.getVoices;
              SpeechSynthesis.prototype.getVoices = function() {
                const voices = origGetVoices.apply(this, arguments);
                return voices.slice(0, Math.max(1, voices.length - 1));
              };
            }
          }

`;

const secaoDoWebgpu = v => `          // 8. WebGPU override
          if (${v.webgpuMode === 'disabled'}) {
            if (navigator.gpu) {
              Object.defineProperty(navigator, 'gpu', { get: () => undefined });
            }
          }

`;

const secaoDaCpu = v => `          // 9. CPU Cores override
          if (${v.cpuCores !== null}) {
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${v.cpuCores} });
          }

`;

const secaoDaMemoria = v => `          // 10. RAM override
          if (${v.ramSize !== null}) {
            Object.defineProperty(navigator, 'deviceMemory', { get: () => ${v.ramSize} });
          }

`;

const secaoDoNaoRastrear = v => `          // 11. Do Not Track override
          if (${v.doNotTrack === 'enable'}) {
            Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' });
          } else if (${v.doNotTrack === 'disable'}) {
            Object.defineProperty(navigator, 'doNotTrack', { get: () => '0' });
          }

`;

const secaoDasPortas = v => `          // 12. Port Scan Protection (Fetch and WebSockets localhost interception)
          if (${v.portScanProtection === 'enable'}) {
            const origFetch = window.fetch;
            window.fetch = function(input, init) {
              const url = typeof input === 'string' ? input : (input && input.url) ? input.url : '';
              if (url.includes('127.0.0.1') || url.includes('localhost')) {
                return Promise.reject(new TypeError('Failed to fetch (port scan protection)'));
              }
              return origFetch.apply(this, arguments);
            };
            const origWS = window.WebSocket;
            window.WebSocket = function(url, protocols) {
              if (url.includes('127.0.0.1') || url.includes('localhost')) {
                throw new DOMException('Connection refused (port scan protection)', 'ConnectionError');
              }
              return new origWS(url, protocols);
            };
          }
        } catch(e) {}
      })();
    `;

const SECOES_DO_SCRIPT_FURTIVO = [
  secaoDaPlataforma, secaoDoCanvas, secaoDoWebgl, secaoDaImagemDoWebgl, secaoDoAudio, secaoDosDispositivos, secaoDosRetangulos,
  secaoDasVozes, secaoDoWebgpu, secaoDaCpu, secaoDaMemoria, secaoDoNaoRastrear, secaoDasPortas,
];

const PLATAFORMAS_DO_SCRIPT = new Map([
  ['mac', { platformStr: 'MacIntel', webglVendor: 'Apple Inc.', webglRenderer: 'Apple M1' }],
  ['linux', { platformStr: 'Linux x86_64', webglVendor: 'Intel Open Source Technology Center', webglRenderer: 'Mesa DRI Intel(R) HD Graphics 520 (Skylake GT2)' }],
  ['android', { platformStr: 'Linux aarch64', webglVendor: 'Google Inc. (Qualcomm)', webglRenderer: 'Adreno (TM) 640' }],
  ['ios', { platformStr: 'iPhone', webglVendor: 'Apple Inc.', webglRenderer: 'Apple GPU' }],
]);
const PLATAFORMA_PADRAO_DO_SCRIPT = { platformStr: 'Win32', webglVendor: 'Google Inc. (NVIDIA)', webglRenderer: 'NVIDIA GeForce RTX 3060' };

const RUIDOS = ['canvasNoise', 'webglNoise', 'audioNoise', 'webglImageNoise', 'mediaDeviceNoise', 'clientRectsNoise', 'speechVoicesNoise'];

const DISPOSITIVOS_DO_SCRIPT = [
  ['camId', 'virtualCamId', 'mock_cam_id'], ['camLabel', 'virtualCamLabel', 'HD Camera'], ['camGroup', 'virtualCamId', 'mock_cam_group'],
  ['micId', 'virtualMicId', 'mock_mic_id'], ['micLabel', 'virtualMicLabel', 'Microphone'], ['micGroup', 'virtualMicId', 'mock_mic_group'],
  ['speakerId', 'virtualSpeakerId', 'mock_speaker_id'], ['speakerLabel', 'virtualSpeakerLabel', 'Speakers'], ['speakerGroup', 'virtualSpeakerId', 'mock_speaker_group'],
];

const numeroOuNulo = valor => (valor && valor !== 'Auto' ? parseInt(valor) : null);

function identidadeDoScript(profile) {
  const base = PLATAFORMAS_DO_SCRIPT.get(profile.platform || 'android') || PLATAFORMA_PADRAO_DO_SCRIPT;
  return {
    platformStr: profile.platformStr || base.platformStr,
    webglVendor: profile.webglVendor || base.webglVendor,
    webglRenderer: profile.webglRenderer || base.webglRenderer,
  };
}

function opcoesDoScript(profile) {
  return {
    ...Object.fromEntries(RUIDOS.map(ruido => [ruido, profile[ruido] !== false])),
    webgpuMode: profile.webgpuMode || 'real',
    cpuCores: numeroOuNulo(profile.cpuCores),
    ramSize: numeroOuNulo(profile.ramSize),
    doNotTrack: profile.doNotTrack || 'default',
    portScanProtection: profile.portScanProtection || 'enable',
  };
}

const dispositivosDoScript = profile => Object.fromEntries(DISPOSITIVOS_DO_SCRIPT.map(([nome, campo, padrao]) => [nome, JSON.stringify(profile[campo] || padrao)]));

function scriptFurtivoDoPerfil(profile) {
  const v = { profile, ...identidadeDoScript(profile), ...opcoesDoScript(profile) };
  ensureProfileStealthSpecs(profile);
  v.dispositivos = dispositivosDoScript(profile);
  return SECOES_DO_SCRIPT_FURTIVO.map(secao => secao(v)).join('');
}

module.exports = {
  STEALTH_SCRIPT, DETECT_EMAIL_SCRIPT, BYPASS_POPUPS_SCRIPT,
  SCRIPT_DE_CURTIR, SCRIPT_DE_INSCREVER, SCRIPT_DE_COMPARTILHAR, scriptDeComentar,
  scriptFurtivoDoPerfil,
};
