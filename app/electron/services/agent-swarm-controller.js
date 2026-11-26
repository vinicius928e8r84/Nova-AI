'use strict';

const path   = require('path');
const { browserService } = require('./browser-manager');

async function geminiGenerate(apiKey, prompt, jsonMode = false) {
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
                if (result.status === 400 || result.status === 403) break;
                continue;
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

class AgentSwarmController {
    constructor(mainWindow, app) {
        this.mainWindow    = mainWindow;
        this.app           = app;
        this.isSwarmActive = false;
        this.isCancelled   = false;
        this.activeChild   = null;

        this.childWorker = new ChildWorkerAgent(mainWindow, app);
    }

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
            const isExplicitCode = lowerCmd.startsWith('agents active') || lowerCmd.startsWith('agent,') || lowerCmd.startsWith('agent ');
            
            const raw = await geminiGenerate(apiKey, prompt, true);
            const match = raw.match(/\{[\s\S]*\}/);
            
            if (!match) {
                return { 
                    isAgentTask: isExplicitCode, 
                    tasks: isExplicitCode ? { researcher: command.replace(/^(agents active|agent,|agent\s)/i, '').trim() || command } : {} 
                };
            }
            
            const plan = JSON.parse(match[0]);
            
            if (isExplicitCode) {
                plan.isAgentTask = true;
                if (!plan.tasks) plan.tasks = {};
                
                const hasAnyTask = plan.tasks.researcher || plan.tasks.coder || plan.tasks.sysadmin || plan.tasks.downloader;
                if (!hasAnyTask) {
                    plan.tasks.researcher = command.replace(/^(agents active|agent,|agent\s)/i, '').trim() || command;
                }
            }
            
            return plan;
        } catch (e) {
            console.error('[Swarm-Intent]', e.message);
            const isExplicitCode = lowerCmd.startsWith('agents active') || lowerCmd.startsWith('agent,') || lowerCmd.startsWith('agent ');
            return { 
                isAgentTask: isExplicitCode,
                tasks: isExplicitCode ? { researcher: command.replace(/^(agents active|agent,|agent\s)/i, '').trim() || command } : {}
            };
        }
    }

    async executeWorkflow(userCommand, apiKey, isDelegated = false, childModel = 'gemini-3.8-flash', groqKey = '') {
        if (this.isSwarmActive) {
            this.log('ceo', 'Swarm already running. Wait or cancel first.');
            return { handled: false };
        }

        const t0 = Date.now();
        
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
                const pyProcess = spawn(require('./python-runtime').python(), pythonArgs, { cwd: path.join(__dirname, '..', '..'), windowsHide: true });
                
                pyProcess.stdout.on('data', (data) => {
                    const lines = data.toString().split('\n').filter(l => l.trim());
                    for (const line of lines) {
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.message) {
                                this.log('sysadmin', `[YT-Auto] ${parsed.message}`);
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

    async _runAgentsAsync(willRun, plan, userCommand, apiKey, t0, childModel = 'gemini-3.8-flash', groqKey = '') {
        const agentCount = Object.values(willRun).filter(Boolean).length;
        
        await this.sendWA(
            ` *Nova Agent Swarm!*\n` +
            `Task: ${userCommand}\n` +
            `${agentCount} agents working...`
        );

        if (willRun.coder)      this.setStatus('coder',      'waiting');
        if (willRun.downloader) this.setStatus('downloader',  'waiting');
        if (willRun.sysadmin)   this.setStatus('sysadmin',    'waiting');

        try {
            const result = await this.childWorker.executeTask(userCommand, apiKey, childModel, groqKey || '');
            
            const elapsed = Math.round((Date.now() - t0) / 1000);
            
            if (result.success) {
                this.log('ceo', ` All tasks complete (${elapsed}s)`);
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
    
    async executeVisibleYouTubeDownload(searchQuery) {
        this._checkCancelled();
        this.log('researcher', ` Initializing VISIBLE browser sub-system...`);
        
        try {
            await browserService.launch();
            
            this.log('researcher', ` Navigating to YouTube...`);
            await browserService.navigate('https://www.youtube.com');
            await new Promise(r => setTimeout(r, 2000));

            this.log('researcher', ` Typing query: "${searchQuery}"`);
            await browserService.type('input#search', searchQuery, true);
            
            this.log('researcher', ` Waiting for results...`);
            await browserService.wait('ytd-video-renderer', 'visible', 10000);
            await new Promise(r => setTimeout(r, 1000));

            this.log('researcher', ` Selecting top result...`);
            await browserService.click('ytd-video-renderer a#video-title');
            
            this.log('researcher', ` Waiting for video page to stabilize...`);
            let finalUrl = '';
            for (let i = 0; i < 20; i++) {
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
                await browserService.close();
                
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
