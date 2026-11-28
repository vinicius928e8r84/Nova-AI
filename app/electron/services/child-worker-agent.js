'use strict';

const { instalacaoPorSistema } = require('./paridade-utils');
const { chamarGemini, chamarGroq, escolherIa } = require('./child-worker-ia');
const { despacharFerramenta, executarShell, lerSite, pesquisarNaWeb, postarNoElectron } = require('./child-worker-ferramentas');

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

function etiquetaDaChave(apiKey) {
    return apiKey ? `[${apiKey.substring(0, 5)}... (len: ${apiKey.length})]` : '[EMPTY]';
}

function modelosSemRepetir(childModel) {
    return [...new Set([childModel, 'gemini-3.8-flash', 'gemini-4-argon'])].map(model => ({ model, api: 'v1beta' }));
}

function shellDoSistema(plataforma) {
    return plataforma === 'darwin' ? 'macOS with POSIX shell; use open, osascript and native macOS paths' : 'Windows with PowerShell/CMD';
}

function lerPassoReAct(texto) {
    const thoughtMatch = texto.match(/Thought\s*:?\s*(.*)/i);
    const actionMatch = texto.match(/Action\s*:?\s*(\w+)\s*\(([\s\S]*?)\)/i);
    return {
        thought: thoughtMatch ? thoughtMatch[1].trim() : 'Analyzing...',
        action: actionMatch ? actionMatch[1].trim() : null,
        args: actionMatch ? actionMatch[2].trim() : null,
    };
}

function ehRespostaFinal(action) {
    return action?.toUpperCase() === 'FINAL_ANSWER';
}

function promptDoPasso(systemPrompt, task, history) {
    const historico = history.map(h => `${h.type}: ${h.content}`).join('\n');
    return `${systemPrompt}\n\n===TASK===\n${task}\n\n===HISTORY===\n${historico}\n\nThought:`;
}

function respostaPelasObservacoes(history) {
    const observations = history.filter(h => h.type === 'Observation').map(h => h.content).join('\n\n');
    return observations || 'Task completed. See terminal for full details.';
}

class ChildWorkerAgent {
    constructor(mainWindow, app) {
        this.mainWindow = mainWindow;
        this.app = app;
        this.isWorking = false;
        this.isCancelled = false;
        this.activeProcess = null;

        this.MAX_STEPS = 8;
        this.STEP_DELAY_MS = 6000;

        this.GEMINI_CANDIDATES = [
            { model: 'gemini-3.8-flash', api: 'v1beta' },
            { model: 'gemini-4-argon',   api: 'v1beta' },
        ];

        this._webSearch = this._webSearch.bind(this);
        this._browseSite = this._browseSite.bind(this);
        this._execShell = this._execShell.bind(this);
    }

    _electronPost(url, bodyStr = '') {
        return postarNoElectron(url, bodyStr);
    }

    callGemini(apiKey, prompt) {
        return chamarGemini(this, apiKey, prompt);
    }

    callGroq(groqKey, prompt) {
        return chamarGroq(this, groqKey, prompt);
    }

    callAI(apiKey, groqKey, prompt, maxAttempts = 2) {
        return escolherIa(this, { apiKey, groqKey }, prompt, maxAttempts);
    }

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

    async executeTask(task, apiKey, childModel = 'gemini-3.8-flash', groqKey = '') {
        if (this.isWorking) return { error: 'Agent already busy. Wait or cancel first.' };

        this._comecarTarefa(task, apiKey, childModel);

        try {
            this.setStatus('researcher', 'busy');
            this.log('ceo', `Neural Engine: Node.js HTTPS (v1 + v1beta) | Models: ${this.GEMINI_CANDIDATES.length} Gemini + Groq`);

            const finalAnswer = await this._rodarPassos(task, apiKey, groqKey);

            this.log('ceo', 'Task complete. Sending result to Nova.');
            this.setStatus('researcher', 'done');
            return { success: true, finalAnswer };

        } catch (err) {
            this.log('ceo', `CRITICAL ERROR: ${err.message}`);
            this.setStatus('researcher', 'idle');
            return { success: false, error: err.message };
        } finally {
            this.isWorking = false;
        }
    }

    _comecarTarefa(task, apiKey, childModel) {
        this.isWorking = true;
        this.isCancelled = false;
        this.log('ceo', `System Check: ${etiquetaDaChave(apiKey)}`);
        this.log('ceo', `Child Model: ${childModel}`);
        this.log('ceo', `Starting task: "${task}"`);
        this.GEMINI_CANDIDATES = modelosSemRepetir(childModel);
    }

    async _rodarPassos(task, apiKey, groqKey) {
        const systemPrompt = this._promptDoSistema(process.platform);
        const stepDelay = this._last429 ? this.STEP_DELAY_MS : 2000;
        const history = [];
        for (let passo = 0; passo < this.MAX_STEPS && !this.isCancelled; passo++) {
            if (passo > 0) await esperar(stepDelay);
            this.log('ceo', `Reasoning Step ${passo + 1}/${this.MAX_STEPS}...`);
            const final = await this._darPasso(apiKey, groqKey, promptDoPasso(systemPrompt, task, history), history);
            if (final) return final.resposta || respostaPelasObservacoes(history);
        }
        return respostaPelasObservacoes(history);
    }

    async _darPasso(apiKey, groqKey, prompt, history) {
        const passo = lerPassoReAct(await this.callAI(apiKey, groqKey, prompt));
        history.push({ type: 'Thought', content: passo.thought });
        this.log('researcher', passo.thought);
        if (ehRespostaFinal(passo.action)) return { resposta: passo.args };
        history.push({ type: 'Observation', content: await this._observarAcao(passo) });
        return null;
    }

    async _observarAcao({ action, args }) {
        if (!action) return 'No action detected. Please specify an Action.';
        this.log('ceo', `Executing: ${action}(${String(args).substring(0, 60)})`);
        this.updateUISubAgent(action);
        const observation = await this.dispatchTool(action, args);
        this.log('researcher', `Result: ${String(observation).substring(0, 120)}...`);
        return observation;
    }

    _promptDoSistema(plataforma) {
        return `You are NOVA's Sub-Agent — a focused, independent research and execution unit.

IDENTITY: You are fast, precise, and practical. Complete tasks in minimum steps.

RULES:
- ALWAYS give FINAL_ANSWER with the complete result text inline — NEVER write to files.
- Use web_search or browse_site to gather real, current data.
- Minimum 2, maximum ${this.MAX_STEPS} steps before FINAL_ANSWER.
- Your FINAL_ANSWER must contain all the information the user requested.

AVAILABLE TOOLS:
1. web_search(query) — Search the web for real, current information (silent)
2. browse_site(url) — Fetch and read content from a specific URL (silent)
3. execute_shell(command) — Run commands for ${shellDoSistema(plataforma)}
${instalacaoPorSistema(plataforma)}
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
    }

    dispatchTool(name, args) {
        return despacharFerramenta(this, name, args);
    }

    _webSearch(query) {
        return pesquisarNaWeb(this, query);
    }

    _browseSite(url) {
        return lerSite(url);
    }

    _execShell(cmd) {
        return executarShell(cmd);
    }

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
