/**
 * ═══════════════════════════════════════════════════════════
 *  NOVA AI — Child Worker Agent (ReAct)  v4 — NOVA ALIGNED
 *  electron/services/child-worker-agent.js
 *
 *  BREAKTHROUGH FIX: Using Electron's built-in `net` module
 *  which uses Chromium's networking stack (same as renderer)
 *  instead of Node.js `https` — this is why NOVA works!
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

// Electron net = Chromium network stack (bypasses all Node.js SSL/proxy issues)
const { net } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { browserService } = require('./browser-manager');

class ChildWorkerAgent {
    constructor(mainWindow, app) {
        this.mainWindow = mainWindow;
        this.app = app;
        this.isWorking = false;
        this.isCancelled = false;
        this.activeProcess = null;

        // ReAct Configuration — NOVA aligned
        this.MAX_STEPS = 8;
        this.STEP_DELAY_MS = 6000; // 6s between steps → max 10 req/min (free tier safe)

        // Models: try v1 STABLE IDs first (works with ALL key types including GCP-restricted keys)
        // Then v1beta aliases as fallback. 1.5-* deprecated.
        this.GEMINI_CANDIDATES = [
            { model: 'gemini-3.8-flash', api: 'v1beta' }, // primary flash
            { model: 'gemini-4-argon',   api: 'v1beta' }, // frontier reasoned
        ];

        // Bind tools for context safety (NOVA logic)
        this._webSearch = this._webSearch.bind(this);
        this._browseSite = this._browseSite.bind(this);
        this._execShell = this._execShell.bind(this);
    }

    /**
     * NOVA-LEVEL NETWORKING: Using Electron's net module for Chromium stack POST/GET
     * This ensures the agent uses the same networking bridge as the main browser.
     */
    _electronPost(url, bodyStr = '') {
        return new Promise((resolve, reject) => {
            try {
                const request = net.request({
                    method: bodyStr ? 'POST' : 'GET',
                    url: url,
                    useSessionCookies: true
                });

                request.on('response', (response) => {
                    let data = '';
                    response.on('data', (chunk) => { data += chunk.toString(); });
                    response.on('end', () => {
                        try {
                            // Attempt to parse as JSON first
                            const parsed = JSON.parse(data);
                            resolve(parsed);
                        } catch (e) {
                            // Return as raw text if JSON parsing fails
                            resolve(data);
                        }
                    });
                    response.on('error', (e) => reject(new Error(`Net response error: ${e.message}`)));
                });

                request.on('error', (e) => reject(new Error(`Net request error: ${e.message}`)));

                if (bodyStr) {
                    request.setHeader('Content-Type', 'application/json');
                    request.write(bodyStr);
                }
                request.end();
            } catch (e) {
                reject(new Error(`_electronPost fatal: ${e.message}`));
            }
        });
    }

    // ─── Node.js HTTPS POST (reliable from main process) ────────────────────
    _httpsPost(url, bodyStr) {
        const https = require('https');
        const { URL } = require('url');
        const parsed = new URL(url);

        return new Promise((resolve, reject) => {
            const options = {
                hostname: parsed.hostname,
                path: parsed.pathname + parsed.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk.toString(); });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        // Attach HTTP status for debug logging
                        parsed._httpStatus = res.statusCode;
                        resolve(parsed);
                    } catch (e) {
                        reject(new Error(`JSON parse failed [${res.statusCode}]: ${data.substring(0, 150)}`));
                    }
                });
                res.on('error', reject);
            });

            req.on('error', reject);
            req.write(bodyStr);
            req.end();
        });
    }

    // ─── Gemini API — Multi-model with smart retry ───────────────────────────
    async callGemini(apiKey, prompt) {
        const bodyStr = JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
        });

        let authFailed = false;

        this._last429 = false; // reset per-call rate-limit tracker

        for (const { model, api } of this.GEMINI_CANDIDATES) {
            if (authFailed) break;

            let retries = 2; // 2 attempts per model
            while (retries-- > 0) {
                try {
                    const url = `https://generativelanguage.googleapis.com/${api}/models/${model}:generateContent?key=${apiKey}`;
                    const resp = await this._httpsPost(url, bodyStr);
                    const httpStatus = resp._httpStatus || '?';

                    // 400 / 403 → Key invalid or permission denied → STOP ALL
                    if (resp.error?.code === 400 || resp.error?.code === 403) {
                        authFailed = true;
                        this.log('ceo', `❌ AUTH ERROR [HTTP ${httpStatus}]: ${String(resp.error.message).substring(0, 120)}`);
                        this.log('ceo', `Fix: Settings → API Keys → enter a valid Sub-Agent Key from aistudio.google.com/apikey`);
                        break;
                    }

                    // 429 → Rate limited → wait and retry SAME model
                    if (resp.error?.code === 429) {
                        this._last429 = true; // remember we hit quota
                        const details = resp.error?.details || [];
                        const retryInfo = details.find(d => d['@type']?.includes('RetryInfo'));
                        const delaySec = retryInfo?.retryDelay
                            ? Math.min(parseFloat(retryInfo.retryDelay) + 2, 25)
                            : 15;
                        this.log('ceo', `⏳ ${model} [429] Rate limit. Waiting ${delaySec}s...`);
                        await new Promise(r => setTimeout(r, delaySec * 1000));
                        continue;
                    }

                    // 404 → Model not available → try next model
                    if (resp.error?.code === 404 || resp.error?.status === 'NOT_FOUND') {
                        this.log('ceo', `⚠ ${model} [404] Not available. Trying next...`);
                        retries = -1;
                        break;
                    }

                    // Other error → log with HTTP status and skip
                    if (resp.error) {
                        this.log('ceo', `⚠ ${model} [HTTP ${httpStatus} / code ${resp.error.code}]: ${String(resp.error.message).substring(0, 80)}`);
                        break;
                    }

                    // Success
                    const text = resp.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                        this.log('ceo', `✓ Neural Engine: ${model}`);
                        return text.trim();
                    }

                    // Empty / blocked response
                    const blockReason = resp.promptFeedback?.blockReason;
                    this.log('ceo', `⚠ ${model} [HTTP ${httpStatus}] Empty response${blockReason ? ` (blocked: ${blockReason})` : ''}. Trying next...`);
                    break;

                } catch (e) {
                    this.log('ceo', `⚠ ${model} network error: ${String(e.message).substring(0, 80)}`);
                    break;
                }
            }
        }

        if (authFailed) throw new Error('AUTH_FAILED: Invalid API key. Check Sub-Agent Key in Settings.');
        // Track whether we had any rate-limits (429) — to decide wait vs instant Groq
        if (this._last429) throw new Error('QUOTA_EXHAUSTED: All Gemini models rate-limited. Try again later.');
        throw new Error('ALL_MODELS_404: All Gemini models returned 404. Key may not have access — using Groq.');
    }

    // ─── Groq fallback (completely separate quota from Gemini) ────────────────
    async callGroq(groqKey, prompt) {
        if (!groqKey || groqKey.length < 20) throw new Error('No Groq key available');

        const https = require('https');
        // Current active Groq models (April 2026) — llama-3.1/mixtral decommissioned
        const modelsToTry = [
            'llama-3.3-70b-versatile',   // replacement for llama-3.1-70b
            'llama-3.1-8b-instant',      // fast, available
            'gemma2-9b-it',              // Google Gemma via Groq
            'llama3-8b-8192',            // older 8b — may still work
        ];

        for (const model of modelsToTry) {
            try {
                const body = JSON.stringify({
                    model,
                    messages: [{ role: 'user', content: prompt }],
                    max_tokens: 2048,
                    temperature: 0.2,
                });

                const result = await new Promise((resolve, reject) => {
                    const options = {
                        hostname: 'api.groq.com',
                        path: '/openai/v1/chat/completions',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${groqKey}`,
                            'Content-Length': Buffer.byteLength(body),
                        },
                    };
                    const req = https.request(options, (res) => {
                        let data = '';
                        res.on('data', c => { data += c; });
                        res.on('end', () => {
                            try { resolve({ json: JSON.parse(data), status: res.statusCode }); }
                            catch (e) { reject(new Error(`Groq parse error [${res.statusCode}]`)); }
                        });
                    });
                    req.on('error', reject);
                    req.write(body);
                    req.end();
                });

                if (result.json.error) {
                    this.log('ceo', `⚠ Groq ${model} [${result.status}]: ${result.json.error.message?.substring(0, 60)}`);
                    continue;
                }

                const text = result.json.choices?.[0]?.message?.content;
                if (text) {
                    this.log('ceo', `✓ Groq ${model} (fallback) responding`);
                    return text.trim();
                }
            } catch (e) {
                this.log('ceo', `⚠ Groq ${model} error: ${e.message.substring(0, 60)}`);
                continue;
            }
        }
        throw new Error('Groq fallback also failed. Check Groq API key in Settings → Groq Influx Key.');
    }

    // ─── Smart router: Gemini → Groq fallback ────────────────────────────────
    async callAI(apiKey, groqKey, prompt, maxAttempts = 2) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await this.callGemini(apiKey, prompt);
            } catch (e) {
                const msg = String(e.message);

                // AUTH error → skip to Groq immediately
                if (msg.startsWith('AUTH_FAILED')) {
                    this.log('ceo', `⚡ Gemini auth failed → switching to Groq fallback...`);
                    break;
                }

                // ALL 404 (key doesn't have model access) → no point retrying → immediate Groq
                if (msg.startsWith('ALL_MODELS_404')) {
                    this.log('ceo', `⚡ All Gemini models unavailable (404) → trying Groq immediately...`);
                    break;
                }

                // QUOTA_EXHAUSTED → wait briefly then retry, then Groq
                if (attempt < maxAttempts) {
                    this.log('ceo', `⏳ Gemini quota limited. Waiting 30s then retry... (${attempt}/${maxAttempts})`);
                    await new Promise(r => setTimeout(r, 30000));
                } else {
                    this.log('ceo', `⚡ Gemini still limited → trying Groq fallback...`);
                    break;
                }
            }
        }
        // Groq fallback
        return await this.callGroq(groqKey, prompt);
    }

    // ─── Logging ─────────────────────────────────────────────────────────────
    log(agent, text) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            const ts = new Date().toLocaleTimeString([], { hour12: false });
            const displayAgent = agent === 'ceo' ? 'GEMINI 3' : agent.toUpperCase();
            const line = `[${ts}] ${displayAgent} ${text}`;
            this.mainWindow.webContents.send('swarm:log', { agent, text: line });
        }
        console.log(`[ChildWorker:${agent}]`, text);
    }

    setStatus(agentId, status, progress = 0) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('swarm:status', { agentId, status, progress });
        }
    }

    // ─── Core ReAct Loop ─────────────────────────────────────────────────────
    async executeTask(task, apiKey, childModel = 'gemini-3.8-flash', groqKey = '') {
        if (this.isWorking) return { error: 'Agent already busy. Wait or cancel first.' };

        this.isWorking = true;
        this.isCancelled = false;

        const keyTag = apiKey ? `[${apiKey.substring(0, 5)}... (len: ${apiKey.length})]` : '[EMPTY]';
        this.log('ceo', `System Check: ${keyTag}`);
        this.log('ceo', `Child Model: ${childModel}`);
        this.log('ceo', `Starting task: "${task}"`);

        // Build model list: v1 STABLE first (all key types), then v1beta aliases
        // childModel from Settings goes first (user preference)
        const allModels = [
            { model: childModel,      api: 'v1beta' }, // user's pick
            { model: 'gemini-3.8-flash', api: 'v1beta' },
            { model: 'gemini-4-argon',   api: 'v1beta' },
        ];
        // Deduplicate (keep first occurrence)
        const seen = new Set();
        this.GEMINI_CANDIDATES = allModels.filter(c => {
            if (seen.has(c.model)) return false;
            seen.add(c.model);
            return true;
        });

        const history = [];
        let currentStep = 0;
        let finalAnswer = null;

        try {
            this.setStatus('researcher', 'busy');
            this.log('ceo', `Neural Engine: Node.js HTTPS (v1 + v1beta) | Models: ${this.GEMINI_CANDIDATES.length} Gemini + Groq`);

            // ── STONIC-aligned system prompt ──────────────────────────────────
            const systemPrompt = `You are NOVA's Sub-Agent — a focused, independent research and execution unit.

IDENTITY: You are fast, precise, and practical. Complete tasks in minimum steps.

RULES:
- ALWAYS give FINAL_ANSWER with the complete result text inline — NEVER write to files.
- Use web_search or browse_site to gather real, current data.
- Minimum 2, maximum ${this.MAX_STEPS} steps before FINAL_ANSWER.
- Your FINAL_ANSWER must contain all the information the user requested.

AVAILABLE TOOLS:
1. web_search(query) — Search the web for real, current information (silent)
2. browse_site(url) — Fetch and read content from a specific URL (silent)
3. execute_shell(command) — Run commands for ${process.platform === 'darwin' ? 'macOS with POSIX shell; use open, osascript and native macOS paths' : 'Windows with PowerShell/CMD'}
4. browser_navigate(url) — Open the visible browser and go to a URL (e.g. for downloading software, going to specific sites like filehippo)
5. browser_snapshot(includeScreenshot) — Get the current page structure as text. Returns element references like [12] button. ALWAYS DO THIS FIRST after navigating.
6. browser_click(selector_or_ref) — Click an element precisely using its ref number (e.g. "[12]") or a CSS selector.
7. browser_vision_click(text) — Click an element visually by searching for its exact text on screen. Use if regular click fails.
8. browser_type(selector_or_ref|text) — Type text into a field naturally. Arguments must be separated by a pipe '|'. Example: [15]|VLC Media Player
9. browser_scroll(direction) — Scroll 'up' or 'down'.
10. browser_extract(selector) — Extract text from a selector on the visible browser page.
11. idm_download(url|format) — Start an IDM-style download for a URL. Format can be 'video', 'audio', or 'best'. Example: https://...|best

STRICT OUTPUT FORMAT:
Thought: [your reasoning]
Action: tool_name(arguments)

When you have enough information to answer:
Thought: I have gathered enough information to provide a complete answer.
Action: FINAL_ANSWER(Your complete detailed answer here. Include all facts, sources and relevant information.)`;

            // Reduce delay since we use Groq (no rate limit) when Gemini is unavailable
            const stepDelay = this._last429 ? this.STEP_DELAY_MS : 2000; // 2s if Groq, 6s if Gemini quota

            while (currentStep < this.MAX_STEPS && !this.isCancelled) {
                // Inter-step throttle
                if (currentStep > 0) {
                    await new Promise(r => setTimeout(r, stepDelay));
                }

                this.log('ceo', `Reasoning Step ${currentStep + 1}/${this.MAX_STEPS}...`);

                const fullPrompt = `${systemPrompt}\n\n===TASK===\n${task}\n\n===HISTORY===\n${
                    history.map(h => `${h.type}: ${h.content}`).join('\n')
                }\n\nThought:`;

                const responseText = await this.callAI(apiKey, groqKey, fullPrompt);

                // Hardened ReAct parsing
                const thoughtMatch = responseText.match(/Thought\s*:?\s*(.*)/i);
                const actionMatch  = responseText.match(/Action\s*:?\s*(\w+)\s*\(([\s\S]*?)\)/i);

                const thought = thoughtMatch ? thoughtMatch[1].trim() : 'Analyzing...';
                const action  = actionMatch  ? actionMatch[1].trim() : null;
                const args    = actionMatch  ? actionMatch[2].trim() : null;

                history.push({ type: 'Thought', content: thought });
                this.log('researcher', thought);

                if (action?.toUpperCase() === 'FINAL_ANSWER') {
                    finalAnswer = args;
                    break;
                }

                if (!action) {
                    history.push({ type: 'Observation', content: 'No action detected. Please specify an Action.' });
                    currentStep++;
                    continue;
                }

                this.log('ceo', `Executing: ${action}(${String(args).substring(0, 60)})`);
                this.updateUISubAgent(action);

                const observation = await this.dispatchTool(action, args);
                history.push({ type: 'Observation', content: observation });
                this.log('researcher', `Result: ${String(observation).substring(0, 120)}...`);

                currentStep++;
            }

            this.log('ceo', 'Task complete. Sending result to Nova.');
            this.setStatus('researcher', 'done');

            // Build finalAnswer from history if explicit FINAL_ANSWER was not given
            if (!finalAnswer) {
                const observations = history.filter(h => h.type === 'Observation').map(h => h.content).join('\n\n');
                finalAnswer = observations || 'Task completed. See terminal for full details.';
            }

            return { success: true, finalAnswer };

        } catch (err) {
            this.log('ceo', `CRITICAL ERROR: ${err.message}`);
            this.setStatus('researcher', 'idle');
            return { success: false, error: err.message };
        } finally {
            this.isWorking = false;
        }
    }

    // ─── Tool Dispatcher ─────────────────────────────────────────────────────
    async dispatchTool(name, args) {
        try {
            switch (name.toLowerCase()) {
                case 'web_search':
                    return await this._webSearch(args);

                case 'browse_site':
                    return await this._browseSite(args);

                case 'execute_shell':
                    return await this._execShell(args);

                case 'write_file': {
                    const pipeIdx = args.indexOf('|');
                    if (pipeIdx === -1) return 'Error: Format must be filename|content';
                    const fPath = args.substring(0, pipeIdx).trim();
                    const fContent = args.substring(pipeIdx + 1).trim();
                    const fullPath = path.resolve(os.homedir(), 'Documents', 'Nova Data', fPath);
                    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                    fs.writeFileSync(fullPath, fContent);
                    return `OK: Saved ${fContent.length} chars to ${fullPath}`;
                }

                case 'read_file': {
                    const rPath = path.resolve(os.homedir(), 'Documents', 'Nova Data', args.trim());
                    if (!fs.existsSync(rPath)) return `Error: File not found at ${rPath}`;
                    return fs.readFileSync(rPath, 'utf8').substring(0, 3000);
                }

                // ─── VISIBLE BROWSER AUTOMATION TOOLS ───
                case 'browser_navigate':
                    await browserService.launch();
                    return await browserService.navigate(args.trim());

                case 'browser_snapshot': {
                    const includeScreenshot = args && args.toLowerCase().includes('true');
                    const snap = await browserService.snapshot(includeScreenshot);
                    return snap.result || 'Snapshot taken successfully.';
                }

                case 'browser_click': {
                    const clickRes = await browserService.click(args.trim());
                    return typeof clickRes === 'object' ? clickRes.result : clickRes;
                }

                case 'browser_vision_click': {
                    const vClickRes = await browserService.visionClick(args.trim());
                    return typeof vClickRes === 'object' ? vClickRes.result : vClickRes;
                }

                case 'browser_type': {
                    const parts = args.split('|');
                    if (parts.length < 2) return 'Error: Format must be selector|text';
                    const selector = parts[0].trim();
                    const text = parts.slice(1).join('|').trim();
                    const typeRes = await browserService.type(selector, text, true);
                    return typeof typeRes === 'object' ? typeRes.result : typeRes;
                }

                case 'browser_scroll':
                    return await browserService.scroll(args.trim().toLowerCase() || 'down');

                case 'browser_extract':
                    return await browserService.extract(args.trim() || undefined);

                case 'idm_download': {
                    const parts = args.split('|');
                    const url = parts[0].trim();
                    const format = (parts[1] || 'best').trim();
                    if (this.app && this.app.ytdlpManager) {
                        await this.app.ytdlpManager.manualDownload(url, format, 'video');
                        return `OK: Download started via IDM-style downloader for ${url}`;
                    }
                    return 'Error: Downloader not ready.';
                }

                default:
                    return `Error: Unknown tool "${name}".`;
            }
        } catch (e) {
            return `Tool error (${name}): ${e.message}`;
        }
    }

    // ─── Real Web Search via Google (Scraping) ──────────────────────────────
    async _webSearch(query) {
        try {
            const encoded = encodeURIComponent(query);
            // Using Google Search (NOVA aligned)
            const url = `https://www.google.com/search?q=${encoded}`;
            
            const html = await this._electronPost(url, '');
            
            if (typeof html !== 'string' || !html) {
                return `web_search error: Empty or invalid response from Google.`;
            }

            // Extract results using a robust pattern for Google's simple HTML results
            const results = [];
            const re = /<a href="\/url\?q=(https?:\/\/[^"&]+)[^>]*><h3[^>]*>(?:<div[^>]*>)?([^<]+)(?:<\/div>)?<\/h3>/g;
            
            let m;
            while ((m = re.exec(html)) !== null) {
                const link = m[1];
                const title = m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"');
                if (!link.includes('google.com')) {
                    results.push({ title, link });
                }
                if (results.length >= 3) break;
            }

            if (results.length > 0) {
                let output = `Google Results for "${query}":\n\n`;
                output += results.map((r, i) => `${i+1}. ${r.title}\n   ${r.link}`).join('\n\n');
                return output;
            }

            // Fallback: Just return a snippet of cleaned text if scraping fails
            const cleanText = html
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 1500);

            return `Google search results for "${query}":\n${cleanText}\n\n(Regex failed, try browse_site with a URL)`;

        } catch (e) {
            return `web_search error: ${e.message}`;
        }
    }

    // ─── Real Browse Site via Electron net ───────────────────────────────────
    async _browseSite(url) {
        let targetUrl = url.trim();
        // Remove quotes if present
        targetUrl = targetUrl.replace(/^["']|["']$/g, '');
        
        if (!targetUrl.startsWith('http')) {
            targetUrl = 'https://' + targetUrl;
        }

        return new Promise((resolve) => {
            try {
                // Set a reasonable timeout for browsing
                const request = net.request({ 
                    method: 'GET', 
                    url: targetUrl,
                    redirect: 'follow'
                });
                
                let data = '';
                request.on('response', (response) => {
                    // Check for successful status codes
                    if (response.statusCode >= 400) {
                        resolve(`Browse error: Server returned status ${response.statusCode} for ${targetUrl}`);
                        return;
                    }

                    response.on('data', chunk => { data += chunk.toString(); });
                    response.on('end', () => {
                        // Strip HTML tags
                        const text = data
                            .replace(/<script[\s\S]*?<\/script>/gi, '')
                            .replace(/<style[\s\S]*?<\/style>/gi, '')
                            .replace(/<[^>]+>/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim()
                            .substring(0, 4000); // Increased limit slightly
                        resolve(`Content from ${targetUrl}:\n${text}`);
                    });
                    response.on('error', (e) => resolve(`Browse error: ${e.message}`));
                });
                request.on('error', (e) => resolve(`Browse error: ${e.message}`));
                request.end();
            } catch (e) {
                resolve(`Browse error: ${e.message}`);
            }
        });
    }

    // ─── Shell Execution ─────────────────────────────────────────────────────
    _execShell(cmd) {
        return new Promise((resolve) => {
            exec(cmd, { timeout: 15000 }, (error, stdout, stderr) => {
                if (error) resolve(`Error: ${stderr || error.message}`);
                else resolve(stdout?.trim() || 'Command executed successfully.');
            });
        });
    }

    // ─── UI Status Updater ───────────────────────────────────────────────────
    updateUISubAgent(action) {
        const lower = action.toLowerCase();
        if (lower.includes('search') || lower.includes('browse')) {
            this.setStatus('researcher', 'busy');
        }
    }

    cancel() {
        this.isCancelled = true;
        this.isWorking = false;
        this.log('ceo', 'Task cancelled by user.');
        this.setStatus('researcher', 'idle');
    }
}

module.exports = ChildWorkerAgent;
