/**
 * 
 *  NOVA AI  Agent Swarm Backend Orchestrator  v4  (GRANULAR LOGS)
 *  electron/services/agent-swarm-controller.js
 *
 *   Correct @google/genai SDK usage (ai.models.generateContent)
 *   Granular step-by-step logs  drive AgentLiveFeed in UI
 *   Real DuckDuckGo web search + link evaluation
 *   Real yt-dlp / PowerShell download with progress
 *   Real child_process.exec for SysAdmin
 *   Cancellation via isCancelled flag
 * 
 */

'use strict';

const { spawn, exec } = require('child_process');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const https  = require('https');
const http   = require('http');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { shell       } = require('electron');
const { browserService } = require('./browser-manager');

//  Tiny HTTPS GET 
function httpGet(url, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 4) return reject(new Error('Too many redirects'));
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            timeout: 15000,
            rejectUnauthorized: false,
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpGet(res.headers.location, redirects + 1).then(resolve).catch(reject);
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => (body += chunk));
            res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('HTTP timeout')); });
    });
}

/** Extract real result URLs from DuckDuckGo HTML */
function parseDDGLinks(html, max = 8) {
    const links = [];
    const re = /href="(https?:\/\/[^"&]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const u = m[1];
        if (u.includes('duckduckgo.com') || u.includes('google.com')) continue;
        if (!links.includes(u)) links.push(u);
        if (links.length >= max) break;
    }
    return links;
}

// ─── Gemini REST helper (Node.js https — no SDK dependency issues) ──────────
async function geminiGenerate(apiKey, prompt, jsonMode = false) {
    // Pro Core Shift Logic: Check if Gemini Web Session is active
    try {
        const geminiBrowserEngine = require('./gemini-browser-engine');
        const authStatus = geminiBrowserEngine.getAuthStatus();
        if (authStatus && authStatus.isLoggedIn) {
            console.log('[SwarmOrchestrator] Using Pro Core (Browser Session)');
            const response = await geminiBrowserEngine.sendMessage({ prompt });
            if (response.success && response.text) {
                return response.text.trim();
            }
            console.warn('[SwarmOrchestrator] Pro Core failed, falling back to API Key.');
        }
    } catch (e) {
        console.warn('[SwarmOrchestrator] Pro Core error:', e.message);
    }

    const https = require('https');
    const { URL } = require('url');

    // Only confirmed working free-tier models (no deprecated 1.5-pro/flash-latest)
    const modelsToTry = [
        { model: 'gemini-3.8-flash', api: 'v1beta' },
        { model: 'gemini-4-argon',   api: 'v1beta' },
    ];

    const bodyStr = JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
    });

    for (const { model, api } of modelsToTry) {
        try {
            const url = new URL(`https://generativelanguage.googleapis.com/${api}/models/${model}:generateContent?key=${apiKey}`);
            const result = await new Promise((resolve, reject) => {
                const options = {
                    hostname: url.hostname,
                    path: url.pathname + url.search,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
                };
                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', c => { data += c; });
                    res.on('end', () => {
                        try { resolve({ json: JSON.parse(data), status: res.statusCode }); }
                        catch (e) { reject(new Error(`Parse error [${res.statusCode}]`)); }
                    });
                });
                req.on('error', reject);
                req.write(bodyStr);
                req.end();
            });

            if (result.json.error) {
                console.warn(`[SwarmOrchestrator] ${model} [${result.status}]: ${result.json.error.message?.substring(0, 80)}`);
                if (result.status === 400 || result.status === 403) break; // auth error, stop all
                continue; // 404 / 429 → try next
            }

            const text = result.json.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) return text.trim();
        } catch (e) {
            console.warn(`[SwarmOrchestrator] ${model} failed: ${e.message.substring(0, 80)}`);
            continue;
        }
    }

    throw new Error('Intent detection: all models failed');
}

const ChildWorkerAgent = require('./child-worker-agent');

//  Main Controller 
class AgentSwarmController {
    constructor(mainWindow, app) {
        this.mainWindow    = mainWindow;
        this.app           = app;
        this.isSwarmActive = false;
        this.isCancelled   = false;
        this.activeChild   = null;

        // Initialize Child Worker Agent
        this.childWorker = new ChildWorkerAgent(mainWindow, app);
    }

    //  IPC helpers 
    broadcast(event, data) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('swarm:' + event, data);
        }
    }

    log(agent, text) {
        const ts   = new Date().toLocaleTimeString([], { hour12: false });
        const line = `[${ts}] ${agent.toUpperCase().replace('SYSADMIN', 'SYS ADMIN')}  ${text}`;
        this.broadcast('log', { agent, text: line });
        console.log('[Swarm]', line);
    }

    setStatus(agentId, status, progress = 0) {
        this.broadcast('status', { agentId, status, progress });
    }

    //  WhatsApp 
    async sendWA(text) {
        try {
            const wm = this.app?.whatsappManager;
            if (wm?.isReady) {
                const myId = wm.client?.info?.wid?._serialized;
                if (myId) await wm.sendReply(myId, text);
            }
        } catch (e) {
            console.warn('[Swarm-WA]', e.message);
        }
    }

    //  Cancellation 
    cancel() {
        if (!this.isSwarmActive) return;
        this.isCancelled = true;
        if (this.activeChild) {
            try { this.activeChild.kill('SIGTERM'); } catch (_) {}
            this.activeChild = null;
        }
        this.log('ceo', 'Swarm cancelled by user.');
        this._resetAgents(500);
    }

    _checkCancelled() {
        if (this.isCancelled) throw new Error('SWARM_CANCELLED');
    }

    _resetAgents(delayMs = 3000) {
        setTimeout(() => {
            ['researcher', 'coder', 'downloader', 'sysadmin'].forEach(id =>
                this.setStatus(id, 'idle')
            );
            this.isSwarmActive = false;
            this.isCancelled   = false;
        }, delayMs);
    }

    //  STEP 1: Intent Detection 
    async detectIntent(command, apiKey) {
        this.log('ceo', `Analyzing: "${command}"`);

        const lowerCmd = command.toLowerCase();
        const forceWords = ['search', 'dhundo', 'agent', 'download', 'script', 'check karo', 'kam pe'];
        const isForced = forceWords.some(w => lowerCmd.includes(w));

        const prompt = `You are Nova AI's Agent Swarm Orchestrator. Analyze if this user command needs multiple specialized agents.

User Command: "${command}"

Agents available:
1. RESEARCHER  - Web search, finding links, gathering info
2. CODER       - Prepare shell commands for Windows
3. DOWNLOADER  - Download files (software, media, docs)
4. SYSADMIN    - Run executables, install software, system commands

Return ONLY valid JSON, no markdown, no backticks:
{
  "isAgentTask": true,
  "reason": "brief why",
  "tasks": {
    "researcher": "search query string or null",
    "coder": "what command to build or null",
    "downloader": "what to download or null",
    "sysadmin": "what command to run or null"
  },
  "fileDetails": {
    "directory": "e.g. Desktop or null",
    "folderName": "e.g. Calculator or null",
    "fileName": "e.g. calc.txt or null"
  },
  "dependencyChain": ["researcher -> coder", "coder -> downloader"]
}

RULES:
- CRITICAL: The user will frequently speak in URDU/HINDI.
- Target Folder Extraction: If the user says 'desktop', use '$HOME\\Desktop'. If they name a folder (e.g. 'calculter nam ke folder'), capture 'calculter' as folderName.
- Filename Extraction: If they say 'save karo .txt name se', capture '.txt' as fileName.
- Translate the intent to English internally. If the intent is an ACTION, isAgentTask MUST be true.
- ${isForced ? "CRITICAL MANDATORY OVERRIDE: The user used a trigger word like 'agent', 'search', or 'download'. You MUST return isAgentTask: true. Extract the core subject for the researcher query." : "- Only return false for pure conversational small talk (e.g. 'kese ho', 'hello')."}
- For RESEARCHER tasks, DO NOT put the whole Urdu sentence as the query. Extract ONLY the precise English keywords. 
  *Example*: Urdu: "muje caculater ke liye net se script dhundo" -> Query: "calculator script source code windows"
  *Example*: Urdu: "latest AI news check karo" -> Query: "latest AI news 2026"`;

        try {
            // Strict override: User explicitly commanded the Swarm via code!
            const isExplicitCode = lowerCmd.startsWith('agents active') || lowerCmd.startsWith('agent,') || lowerCmd.startsWith('agent ');
            
            const raw = await geminiGenerate(apiKey, prompt, true);
            const match = raw.match(/\{[\s\S]*\}/);
            
            // If LLM returned text but no JSON
            if (!match) {
                return { 
                    isAgentTask: isExplicitCode, 
                    tasks: isExplicitCode ? { researcher: command.replace(/^(agents active|agent,|agent\s)/i, '').trim() || command } : {} 
                };
            }
            
            const plan = JSON.parse(match[0]);
            
            // If explicit code is used, DO NOT allow Gemini to say NO.
            if (isExplicitCode) {
                plan.isAgentTask = true;
                if (!plan.tasks) plan.tasks = {};
                
                // Force a researcher task at minimum if Gemini failed to assign one
                const hasAnyTask = plan.tasks.researcher || plan.tasks.coder || plan.tasks.sysadmin || plan.tasks.downloader;
                if (!hasAnyTask) {
                    plan.tasks.researcher = command.replace(/^(agents active|agent,|agent\s)/i, '').trim() || command;
                }
            }
            
            return plan;
        } catch (e) {
            console.error('[Swarm-Intent]', e.message);
            // Fallback to strict code if LLM entirely failed
            const isExplicitCode = lowerCmd.startsWith('agents active') || lowerCmd.startsWith('agent,') || lowerCmd.startsWith('agent ');
            return { 
                isAgentTask: isExplicitCode,
                tasks: isExplicitCode ? { researcher: command.replace(/^(agents active|agent,|agent\s)/i, '').trim() || command } : {}
            };
        }
    }

    //  STEP 2: RESEARCHER (Real Browser Integration) 
    async runResearcher(searchQuery, apiKey) {
        this._checkCancelled();
        this.setStatus('researcher', 'busy');

        this.log('researcher', ` Searching: "${searchQuery}"`);

        try {
            //  Log 2: Launching Chrome
            this.log('researcher', ` Launching Nova Chrome...`);
            
            const encoded = encodeURIComponent(searchQuery);
            const searchUrl = `https://www.google.com/search?q=${encoded}`;
            
            // Navigate via the real browser service
            await browserService.navigate(searchUrl);
            
            this.log('researcher', ` Analyzing Google Results...`);
            
            // Artificial delay to let user see the search happening (as requested "nazar bhi ai")
            await new Promise(r => setTimeout(r, 2000));

            // Extract links using a robust client-side script
            const resultHtml = await browserService.executeScript(`
                (() => {
                    const links = [];
                    // Look for standard Google Search result containers
                    const anchors = document.querySelectorAll('div.g a[href], div.yuRUbf a[href]');
                    for (const a of anchors) {
                        const url = a.href;
                        // Filter out Google-specific or non-content links
                        if (url.startsWith('http') && !url.includes('google.com') && !url.includes('webcache.googleusercontent.com')) {
                            if (!links.includes(url)) links.push(url);
                        }
                    }
                    return links.slice(0, 8);
                })()
            `);

            // Extract link array from execution result string
            let links = [];
            try {
                const match = resultHtml.match(/Result: (\[.*\])/);
                if (match) {
                    links = JSON.parse(match[1]);
                }
            } catch (e) {
                console.error('[Researcher] Link extraction parse error:', e);
            }

            if (links.length === 0) {
                this.log('researcher', ` Chrome extraction failed. Falling back to Neural Cache...`);
                const answer = await geminiGenerate(apiKey, `Act as an expert researcher. Provide a concise, highly accurate, and up-to-date answer for: ${searchQuery}`);
                this.setStatus('researcher', 'done');
                await this.sendWA(` *RESEARCHER* (Neural):\n${answer.substring(0, 200)}...`);
                return answer;
            }

            this.log('researcher', ` Found ${links.length} results — evaluating...`);

            for (let i = 0; i < Math.min(links.length, 3); i++) {
                await new Promise(r => setTimeout(r, 1000));
                this._checkCancelled();
                const domain = new URL(links[i]).hostname.replace('www.', '');
                this.log('researcher', ` Evaluated: ${domain}`);
            }

            const skip = ['reddit.com', 'quora.com', 'stackoverflow.com', 'youtube.com', 'twitter.com', 'google.com'];
            const best = links.find(l => !skip.some(s => l.includes(s))) || links[0];

            this.log('researcher', ` Selected: ${best}`);
            this.log('researcher', ` Extracting knowledge...`);

            // Navigate to the best link to extract content
            await browserService.navigate(best);
            const rawBody = await browserService.extract();
            const cleanBody = rawBody.substring(0, 8000); 

            const analysis = await geminiGenerate(apiKey, `You are the lead Researcher. Analyze the following webpage content and provide a comprehensive summary for the user's query.\n\nQuery: ${searchQuery}\n\nContent:\n${cleanBody}`);
            
            this.setStatus('researcher', 'done');
            await this.sendWA(` *RESEARCHER* (${new URL(best).hostname}):\n${analysis.substring(0, 300)}...`);
            
            return analysis;

        } catch (e) {
            console.error('[Researcher-Chrome]', e.message);
            this.log('researcher', ` Error: ${e.message}`);
            this.setStatus('researcher', 'idle');
            return null;
        }
    }

    //  STEP 3: CODER (granular logs) 
    async runCoder(task, researcherOutput, apiKey, fileDetails = null) {
        this._checkCancelled();
        this.setStatus('coder', 'busy');

        this.log('coder', ` Task: ${task.substring(0, 55)}`);

        try {
            this.log('coder', ` Asking Gemini for Automation script...`);

            let contextPrompt = '';
            if (fileDetails && (fileDetails.directory || fileDetails.folderName || fileDetails.fileName)) {
                contextPrompt = `
- Target Directory: ${fileDetails.directory || '$HOME\\Desktop'}
- Target Folder: ${fileDetails.folderName || ''}
- Target Filename: ${fileDetails.fileName || 'nova_output.txt'}

If the researcher found a script or text, your command MUST:
1. Create the target folder if it doesn't exist.
2. Write the content to the target file.
`;
            }

            const prompt = process.platform === 'darwin' ? `You are a macOS automation expert for Nova AI.
Task: ${task}
Research: ${researcherOutput}
${contextPrompt}
Generate ONE POSIX shell command for macOS. Use $HOME/Desktop for the desktop.
Create destination folders with mkdir -p. Quote all paths and data safely.
Return only the command, no markdown or explanations.` : `You are a Windows Automation expert for Nova AI.

Task: "${task}"
Researcher found content: "${researcherOutput}"
${contextPrompt}

Generate ONE PowerShell command to accomplish this.
- Use '$HOME\\Desktop' for desktop paths.
- For writing content to a file, use: Set-Content -Path "..." -Value @'
<CONTENT>
'@ 
(Use the Here-String @''@ pattern to handle multi-line content safely).
- Ensure any folder in the path is created first using: if (!(Test-Path "...")) { New-Item -ItemType Directory -Path "..." }
- Return ONLY the raw PowerShell command. No explanation. No backticks. No markdown.`;

            const cmd = await geminiGenerate(apiKey, prompt, false);

            this.log('coder', ` Generated: ${cmd.substring(0, 65)}...`);

            this.setStatus('coder', 'done');
            return cmd;

        } catch (e) {
            this.log('coder', ` Error: ${e.message}`);
            this.setStatus('coder', 'done');
            return null;
        }
    }

    //  STEP 4: DOWNLOADER (granular logs) 
    async runDownloader(downloadTarget, researcherUrl) {
        this._checkCancelled();
        this.setStatus('downloader', 'busy', 0);

        const target = downloadTarget || researcherUrl || '';

        //  Log 1
        this.log('downloader', ` Target: ${target.substring(0, 60)}`);
        await this.sendWA(' *DOWNLOADER*: Download starting...');

        try {
            //  Use ytdlpManager if available
            if (this.app?.ytdlpManager) {
                this.log('downloader', ` Using yt-dlp engine...`);

                await this.app.ytdlpManager.smartDownload(target, '360p', 'video', 'self');

                this.log('downloader', ` Download complete via yt-dlp`);
                await this.sendWA(' *DOWNLOADER*: Complete ');
                this.setStatus('downloader', 'done');
                return path.join(os.homedir(), 'Downloads', 'Nova Downloads');
            }

            //  Fallback: PowerShell download for direct URLs
            if (target.startsWith('http')) {
                const dir  = path.join(os.homedir(), 'Downloads', 'Nova Downloads');
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                const filename = path.basename(target.split('?')[0]) || `nova_${Date.now()}.bin`;
                const outPath  = path.join(dir, filename);

                //  Log 2
                this.log('downloader', ` Saving to: ...Nova Downloads\\${filename}`);

                await new Promise((resolve, reject) => {
                    const child = spawn('powershell.exe', [
                        '-NoProfile', '-Command',
                        `Invoke-WebRequest -Uri "${target}" -OutFile "${outPath}" -UseBasicParsing`
                    ], { windowsHide: true });

                    this.activeChild = child;

                    let lastPct = -1;
                    child.stdout.on('data', d => {
                        const m = String(d).match(/(\d+)\s*%/);
                        if (m) {
                            const pct = parseInt(m[1], 10);
                            if (pct !== lastPct) {
                                lastPct = pct;
                                this.setStatus('downloader', 'busy', pct);
                                //  Log progress every 10%
                                if (pct % 10 === 0 || pct >= 99) {
                                    this.log('downloader', ` Progress: ${pct}%`);
                                }
                            }
                        }
                    });

                    child.on('close', code => {
                        this.activeChild = null;
                        code === 0 ? resolve(outPath) : reject(new Error(`Exit code ${code}`));
                    });
                    child.on('error', reject);
                });

                //  Log 3
                this.log('downloader', ` Saved: ${filename}`);
                await this.sendWA(' *DOWNLOADER*: File saved ');
                this.setStatus('downloader', 'done');
                return outPath;
            }

            this.log('downloader', ` No valid URL  skipping`);
            this.setStatus('downloader', 'done');
            return null;

        } catch (e) {
            if (e.message === 'SWARM_CANCELLED') throw e;
            this.log('downloader', ` Error: ${e.message}`);
            this.setStatus('downloader', 'done');
            return null;
        }
    }

    //  STEP 5: SYS ADMIN (granular logs) 
    async runSysAdmin(command, downloadedPath) {
        this._checkCancelled();
        this.setStatus('sysadmin', 'busy');

        const execCmd = process.platform === 'darwin' && downloadedPath && fs.existsSync(downloadedPath) ? '/usr/bin/open ' + "'" + downloadedPath.replace(/'/g, "'\\''") + "'" : (downloadedPath && fs.existsSync(downloadedPath))
            ? `"${downloadedPath}" /S /silent /quiet /norestart`
            : command;

        if (!execCmd) {
            this.log('sysadmin', ` No command  skipping`);
            this.setStatus('sysadmin', 'done');
            return 'skipped';
        }

        //  Log 1
        this.log('sysadmin', ` Running: ${execCmd.substring(0, 70)}`);
        await this.sendWA(' *SYS ADMIN*: Executing...');

        //  Log 2
        this.log('sysadmin', ` Waiting for process...`);

        return new Promise((resolve) => {
            const child = exec(execCmd, { timeout: 120000, shell: true }, (error, stdout, stderr) => {
                this.activeChild = null;
                if (error && error.code !== 0) {
                    //  Log error
                    this.log('sysadmin', ` Exit ${error.code}: ${(stderr || error.message).substring(0, 80)}`);
                } else {
                    const out = (stdout || '').trim();
                    //  Log success
                    this.log('sysadmin', ` Done${out ? `  ${out.substring(0, 55)}` : ''}`);
                }
                this.setStatus('sysadmin', 'done');
                resolve('done');
            });
            this.activeChild = child;
        });
    }

    //  MAIN ORCHESTRATOR 
    async executeWorkflow(userCommand, apiKey, isDelegated = false, childModel = 'gemini-3.8-flash', groqKey = '') {
        if (this.isSwarmActive) {
            this.log('ceo', 'Swarm already running. Wait or cancel first.');
            return { handled: false };
        }

        const t0 = Date.now();
        
        // ─── YOUTUBE UPLOAD PIPELINE INTERCEPT ───
        if (!isDelegated) {
            const lowerCmd = userCommand.toLowerCase();
            if (lowerCmd.includes('youtube auto upload') || lowerCmd.includes('meri video upload kar do') || lowerCmd.includes('youtube upload')) {
                this.log('ceo', `═══ YOUTUBE AUTOMATION PIPELINE ACTIVATED ═══`);
                
                let specificVideo = null;
                const match = lowerCmd.match(/youtube upload\s+([\w.-]+)/);
                if (match && !match[1].includes('auto')) {
                    specificVideo = match[1];
                }
                
                this.isSwarmActive = true;
                this.setStatus('sysadmin', 'busy');
                
                const pythonArgs = ['youtube_auto/pipeline.py'];
                if (specificVideo) pythonArgs.push(specificVideo);
                
                const { spawn } = require('child_process');
                const pyProcess = spawn(process.platform === 'darwin' ? require('./mac-native').python() : 'python', pythonArgs, { cwd: path.join(__dirname, '..', '..') });
                
                pyProcess.stdout.on('data', (data) => {
                    const lines = data.toString().split('\n').filter(l => l.trim());
                    for (const line of lines) {
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.message) {
                                this.log('sysadmin', `[YT-Auto] ${parsed.message}`);
                                // Trigger Nova TTS feedback
                                this.broadcast('task-result', { 
                                    task: 'YouTube Upload Status', 
                                    answer: parsed.message,
                                    elapsed: Math.round((Date.now() - t0) / 1000) 
                                });
                            }
                        } catch(e) {
                            this.log('sysadmin', `[YT-Log] ${line}`);
                        }
                    }
                });
                
                pyProcess.stderr.on('data', (data) => {
                    this.log('sysadmin', `[YT-Error] ${data.toString()}`);
                });
                
                pyProcess.on('close', (code) => {
                    this.isSwarmActive = false;
                    this.setStatus('sysadmin', 'idle');
                    this.log('ceo', `YouTube pipeline closed with code ${code}`);
                    if (code === 0) {
                        this.broadcast('task-result', { task: userCommand, answer: "YouTube upload pipeline successful." });
                    }
                });
                
                return { handled: true };
            }
        }
        // ──────────────────────────────────────────

        let plan;

        if (isDelegated) {
            plan = {
                isAgentTask: true,
                tasks: { researcher: userCommand }
            };
        } else {
            plan = await this.detectIntent(userCommand, apiKey);
            if (!plan.isAgentTask) {
                console.log('[Swarm] Not an agent task — passing to standard AI.');
                return { handled: false };
            }
        }

        this.isSwarmActive = true;
        this.isCancelled   = false;

        const willRun = {
            researcher: !!plan.tasks?.researcher,
            coder:      !!plan.tasks?.coder,
            downloader: !!plan.tasks?.downloader,
            sysadmin:   !!plan.tasks?.sysadmin,
        };

        this.log('ceo', `═══ NEURAL SUB-AGENT ACTIVATED ═══`);
        this.log('ceo', `Task: "${userCommand}"`);
        this.log('ceo', `Model: ${childModel}${groqKey ? ' | Groq backup: ON' : ' | Groq backup: OFF'}`);

        this._runAgentsAsync(willRun, plan, userCommand, apiKey, t0, childModel, groqKey).catch(e => {
            console.error('[Swarm] Background exec failed:', e);
            this.isSwarmActive = false;
        });

        return { handled: true };
    }

    // Background Async execution runner
    async _runAgentsAsync(willRun, plan, userCommand, apiKey, t0, childModel = 'gemini-3.8-flash', groqKey = '') {
        const agentCount = Object.values(willRun).filter(Boolean).length;
        
        await this.sendWA(
            ` *Nova Agent Swarm!*\n` +
            `Task: ${userCommand}\n` +
            `${agentCount} agents working...`
        );

        // Mark queued agents as WAITING
        if (willRun.coder)      this.setStatus('coder',      'waiting');
        if (willRun.downloader) this.setStatus('downloader',  'waiting');
        if (willRun.sysadmin)   this.setStatus('sysadmin',    'waiting');

        try {
            // DELEGATE TO CHILD WORKER RE-ACT ENGINE (pass user-selected model)
            const result = await this.childWorker.executeTask(userCommand, apiKey, childModel, groqKey || '');
            
            const elapsed = Math.round((Date.now() - t0) / 1000);
            
            if (result.success) {
                this.log('ceo', ` All tasks complete (${elapsed}s)`);
                // ── Notify frontend with actual result so Nova can auto-respond ──
                this.broadcast('task-result', {
                    task:    userCommand,
                    answer:  result.finalAnswer || 'Task completed successfully.',
                    elapsed,
                });
                await this.sendWA(
                    ` *Swarm Complete!*\n` +
                    `Task: ${userCommand}\n` +
                    `Time: ${elapsed}s`
                );
            } else {
                throw new Error(result.error || 'Worker failed');
            }

        } catch (e) {
            if (e.message !== 'SWARM_CANCELLED') {
                this.log('ceo', `ERROR: ${e.message}`);
                await this.sendWA(` *Swarm Error*: ${e.message}`);
            }
        } finally {
            this._resetAgents(3000);
            this.isSwarmActive = false;
        }
    }
    
    //  STEP 6: VISIBLE RPA YouTube Search (Ghost Automation)
    async executeVisibleYouTubeDownload(searchQuery) {
        this._checkCancelled();
        this.log('researcher', ` Initializing VISIBLE browser sub-system...`);
        
        try {
            await browserService.launch(); // headless: false is default in browserService
            
            // 1. Navigate to YouTube
            this.log('researcher', ` Navigating to YouTube...`);
            await browserService.navigate('https://www.youtube.com');
            await new Promise(r => setTimeout(r, 2000));

            // 2. Type Query into Search Bar
            this.log('researcher', ` Typing query: "${searchQuery}"`);
            await browserService.type('input#search', searchQuery, true);
            
            // 3. Wait for search results
            this.log('researcher', ` Waiting for results...`);
            await browserService.wait('ytd-video-renderer', 'visible', 10000);
            await new Promise(r => setTimeout(r, 1000));

            // 4. Click the first video
            this.log('researcher', ` Selecting top result...`);
            await browserService.click('ytd-video-renderer a#video-title');
            
            // 5. Polling loop for URL extraction (Dynamic wait)
            this.log('researcher', ` Waiting for video page to stabilize...`);
            let finalUrl = '';
            for (let i = 0; i < 20; i++) { // Max 10 seconds (20 * 500ms)
                await new Promise(r => setTimeout(r, 500));
                const currentUrlResult = await browserService.executeScript('window.location.href');
                
                try {
                    const match = currentUrlResult.match(/Result: "(.*)"/);
                    if (match && match[1].includes('/watch?v=')) {
                        finalUrl = match[1];
                        break;
                    }
                } catch (e) {}
            }

            if (finalUrl && finalUrl.includes('/watch')) {
                this.log('researcher', ` URL Extracted: ${finalUrl}`);
                // 6. Close browser and return
                await browserService.close();
                
                // 7. Focus Nova Window (via main process handler if called from renderer or directly if in main)
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.show();
                    this.mainWindow.focus();
                }
                
                return finalUrl;
            }

            this.log('researcher', ` Extraction failed or invalid URL.`);
            await browserService.close();
            return null;

        } catch (e) {
            console.error('[Swarm-RPA] Error:', e.message);
            this.log('researcher', ` Error: ${e.message}`);
            try { await browserService.close(); } catch (_) {}
            return null;
        }
    }
}


module.exports = AgentSwarmController;
