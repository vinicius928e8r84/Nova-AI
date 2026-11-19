const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

function hasUpdateConfig(resourcesPath = process.resourcesPath) {
  try {
    return !!resourcesPath && fs.existsSync(path.join(resourcesPath, 'app-update.yml'));
  } catch (_) {
    return false;
  }
}

function edgeTtsBinary(platform, macPython) {
  if (platform === 'darwin') return `"${macPython()}" -m edge_tts`;
  if (platform === 'win32') return 'python -m edge_tts';
  return 'edge-tts';
}

function downloadFile(url, outPath, { onProgress, onRequest, maxRedirects = 8 } = {}) {
  return new Promise((resolve, reject) => {
    const fetch = (target, left) => {
      let client;
      try {
        const protocol = new URL(target).protocol;
        if (protocol !== 'https:' && protocol !== 'http:') throw new Error(`Protocolo nao suportado: ${protocol}`);
        client = protocol === 'https:' ? https : http;
      } catch (e) {
        return reject(e);
      }
      let req;
      try {
        req = client.get(target, { headers: { 'User-Agent': 'Mozilla/5.0 NovaAI' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (left <= 0) return reject(new Error('Muitos redirecionamentos'));
          let next;
          try {
            next = new URL(res.headers.location, target);
          } catch (e) {
            return reject(e);
          }
          return fetch(next.toString(), left - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const out = fs.createWriteStream(outPath);
        res.on('data', chunk => {
          received += chunk.length;
          if (total && onProgress) onProgress(Math.floor((received / total) * 100));
        });
        res.on('error', err => { out.destroy(); reject(err); });
        out.on('error', reject);
        out.on('finish', () => resolve(outPath));
        res.pipe(out);
        });
      } catch (e) {
        return reject(e);
      }
      req.on('error', reject);
      if (onRequest) onRequest(req);
    };
    fetch(url, maxRedirects);
  });
}

const MAC_BROWSER_KILL_PATTERN = '^/.*/Contents/MacOS/(Google Chrome|Chromium)[^/]* (.* )?--user-data-dir=[^=]*/\\.wwebjs_auth/session-nova-desktop-client( |$)';

async function macAntigravityStats(mac) {
  const pid = Number((await mac.run('/usr/bin/pgrep', ['-x', 'Antigravity'])).split('\n')[0]);
  if (!pid) return null;
  const [cpu, rss] = (await mac.run('/bin/ps', ['-p', String(pid), '-o', '%cpu=,rss='])).trim().split(/\s+/).map(Number);
  let title = '';
  let responding = true;
  try {
    title = await mac.run('/usr/bin/osascript', ['-e', 'tell application "System Events" to tell process "Antigravity" to return name of front window'], { timeout: 3000 });
  } catch {
    responding = false;
  }
  return { pid, cpu: Math.round(cpu), memory: Math.round(rss / 1024), responding, title };
}

module.exports = { hasUpdateConfig, edgeTtsBinary, downloadFile, macAntigravityStats, MAC_BROWSER_KILL_PATTERN };
