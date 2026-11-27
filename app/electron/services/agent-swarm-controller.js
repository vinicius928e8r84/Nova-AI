'use strict';

const path   = require('path');
const { browserService } = require('./browser-manager');
const { gerarTextoComGemini } = require('./agent-swarm-gemini');
const { temGatilho, ehComandoExplicito, montarPedidoDeIntencao, planoDoTexto, planoDeFallback } = require('./agent-swarm-intencao');
const ChildWorkerAgent = require('./child-worker-agent');

const AGENTES = ['researcher', 'coder', 'downloader', 'sysadmin'];
const MODELO_PADRAO_DO_FILHO = 'gemini-3.8-flash';
const PEDIDOS_DO_PIPELINE_DO_YOUTUBE = ['youtube auto upload', 'meri video upload kar do', 'youtube upload'];
const ESPERA_PARA_LIBERAR_OS_AGENTES_MS = 3000;
const ESPERA_AO_CANCELAR_MS = 500;
const TENTATIVAS_DE_ACHAR_O_VIDEO = 20;
const MARCA_DO_RESULTADO_DO_NAVEGADOR = /Result: "(.*)"/;

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ehPedidoDoPipelineDoYoutube = (comando) => PEDIDOS_DO_PIPELINE_DO_YOUTUBE.some((pedido) => comando.includes(pedido));

function videoEscolhidoNoComando(comando) {
  const achado = comando.match(/youtube upload\s+([\w.-]+)/);
  return achado && !achado[1].includes('auto') ? achado[1] : null;
}

function urlDoVideoNaPagina(resultado) {
  try {
    const achado = resultado.match(MARCA_DO_RESULTADO_DO_NAVEGADOR);
    if (achado && achado[1].includes('/watch?v=')) return achado[1];
  } catch (e) {}
  return '';
}

function gerenteDoWhatsapp(app) {
  const gerente = app?.whatsappManager;
  return gerente?.isReady ? gerente : null;
}

const numeroDoDono = (gerente) => gerente.client?.info?.wid?._serialized;

const planoDelegado = (comando) => ({ isAgentTask: true, tasks: { researcher: comando } });

function agentesQueVaoRodar(plano) {
  return {
    researcher: !!plano.tasks?.researcher,
    coder:      !!plano.tasks?.coder,
    downloader: !!plano.tasks?.downloader,
    sysadmin:   !!plano.tasks?.sysadmin,
  };
}

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
        console.info('[Swarm]', line);
    }

    setStatus(agentId, status, progress = 0) {
        this.broadcast('status', { agentId, status, progress });
    }

    async sendWA(text) {
        try {
            const gerente = gerenteDoWhatsapp(this.app);
            const numero = gerente && numeroDoDono(gerente);
            if (numero) await gerente.sendReply(numero, text);
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
        this._resetAgents(ESPERA_AO_CANCELAR_MS);
    }

    _checkCancelled() {
        if (this.isCancelled) throw new Error('SWARM_CANCELLED');
    }

    _resetAgents(delayMs = ESPERA_PARA_LIBERAR_OS_AGENTES_MS) {
        setTimeout(() => {
            AGENTES.forEach(id => this.setStatus(id, 'idle'));
            this.isSwarmActive = false;
            this.isCancelled   = false;
        }, delayMs);
    }

    async detectIntent(command, apiKey) {
        this.log('ceo', `Analyzing: "${command}"`);
        const lowerCmd = command.toLowerCase();
        const prompt = montarPedidoDeIntencao(command, temGatilho(lowerCmd));
        const explicito = ehComandoExplicito(lowerCmd);
        try {
            const texto = await gerarTextoComGemini(apiKey, prompt);
            return planoDoTexto(texto, command, explicito);
        } catch (e) {
            console.error('[Swarm-Intent]', e.message);
            return planoDeFallback(command, explicito);
        }
    }

    _repassarLinhaDoPipeline(linha, t0) {
        try {
            const parsed = JSON.parse(linha);
            if (!parsed.message) return;
            this.log('sysadmin', `[YT-Auto] ${parsed.message}`);
            this.broadcast('task-result', {
                task: 'YouTube Upload Status',
                answer: parsed.message,
                elapsed: Math.round((Date.now() - t0) / 1000)
            });
        } catch (e) {
            this.log('sysadmin', `[YT-Log] ${linha}`);
        }
    }

    _repassarSaidaDoPipeline(data, t0) {
        const lines = data.toString().split('\n').filter(l => l.trim());
        for (const line of lines) this._repassarLinhaDoPipeline(line, t0);
    }

    _aoFecharOPipeline(code, userCommand) {
        this.isSwarmActive = false;
        this.setStatus('sysadmin', 'idle');
        this.log('ceo', `YouTube pipeline closed with code ${code}`);
        if (code === 0) {
            this.broadcast('task-result', { task: userCommand, answer: "YouTube upload pipeline successful." });
        }
    }

    _rodarOPipelineDoYoutube(userCommand, t0) {
        this.log('ceo', `═══ YOUTUBE AUTOMATION PIPELINE ACTIVATED ═══`);
        const specificVideo = videoEscolhidoNoComando(userCommand.toLowerCase());
        this.isSwarmActive = true;
        this.setStatus('sysadmin', 'busy');

        const pythonArgs = ['youtube_auto/pipeline.py'];
        if (specificVideo) pythonArgs.push(specificVideo);

        const { spawn } = require('child_process');
        const pyProcess = spawn(require('./python-runtime').python(), pythonArgs, { cwd: path.join(__dirname, '..', '..'), windowsHide: true });

        pyProcess.stdout.on('data', (data) => this._repassarSaidaDoPipeline(data, t0));
        pyProcess.stderr.on('data', (data) => this.log('sysadmin', `[YT-Error] ${data.toString()}`));
        pyProcess.on('close', (code) => this._aoFecharOPipeline(code, userCommand));
        return { handled: true };
    }

    async executeWorkflow(userCommand, apiKey, isDelegated = false, { model: childModel = MODELO_PADRAO_DO_FILHO, groqKey = '' } = {}) {
        if (this.isSwarmActive) {
            this.log('ceo', 'Swarm already running. Wait or cancel first.');
            return { handled: false };
        }

        const t0 = Date.now();

        if (!isDelegated && ehPedidoDoPipelineDoYoutube(userCommand.toLowerCase())) {
            return this._rodarOPipelineDoYoutube(userCommand, t0);
        }

        const plan = isDelegated ? planoDelegado(userCommand) : await this.detectIntent(userCommand, apiKey);
        if (!plan.isAgentTask) {
            console.info('[Swarm] Not an agent task — passing to standard AI.');
            return { handled: false };
        }

        this.isSwarmActive = true;
        this.isCancelled   = false;

        this.log('ceo', `═══ NEURAL SUB-AGENT ACTIVATED ═══`);
        this.log('ceo', `Task: "${userCommand}"`);
        this.log('ceo', `Model: ${childModel}${groqKey ? ' | Groq backup: ON' : ' | Groq backup: OFF'}`);

        const tarefa = { userCommand, apiKey, t0, filho: { model: childModel, groqKey } };
        this._runAgentsAsync(agentesQueVaoRodar(plan), tarefa).catch(e => {
            console.error('[Swarm] Background exec failed:', e);
            this.isSwarmActive = false;
        });

        return { handled: true };
    }

    async _avisarQueOsAgentesComecaram(willRun, userCommand) {
        const agentCount = Object.values(willRun).filter(Boolean).length;
        await this.sendWA(
            ` *Nova Agent Swarm!*\n` +
            `Task: ${userCommand}\n` +
            `${agentCount} agents working...`
        );
        for (const id of ['coder', 'downloader', 'sysadmin']) {
            if (willRun[id]) this.setStatus(id, 'waiting');
        }
    }

    async _concluirOTrabalho(resultado, { userCommand, t0 }) {
        const elapsed = Math.round((Date.now() - t0) / 1000);
        this.log('ceo', ` All tasks complete (${elapsed}s)`);
        this.broadcast('task-result', {
            task:    userCommand,
            answer:  resultado.finalAnswer || 'Task completed successfully.',
            elapsed,
        });
        await this.sendWA(
            ` *Swarm Complete!*\n` +
            `Task: ${userCommand}\n` +
            `Time: ${elapsed}s`
        );
    }

    async _runAgentsAsync(willRun, tarefa) {
        const { userCommand, apiKey, filho } = tarefa;
        await this._avisarQueOsAgentesComecaram(willRun, userCommand);

        try {
            const result = await this.childWorker.executeTask(userCommand, apiKey, filho.model, filho.groqKey || '');
            if (!result.success) throw new Error(result.error || 'Worker failed');
            await this._concluirOTrabalho(result, tarefa);
        } catch (e) {
            if (e.message !== 'SWARM_CANCELLED') {
                this.log('ceo', `ERROR: ${e.message}`);
                await this.sendWA(` *Swarm Error*: ${e.message}`);
            }
        } finally {
            this._resetAgents(ESPERA_PARA_LIBERAR_OS_AGENTES_MS);
            this.isSwarmActive = false;
        }
    }

    async _pesquisarNoYoutube(searchQuery) {
        await browserService.launch();

        this.log('researcher', ` Navigating to YouTube...`);
        await browserService.navigate('https://www.youtube.com');
        await esperar(2000);

        this.log('researcher', ` Typing query: "${searchQuery}"`);
        await browserService.type('input#search', searchQuery, true);

        this.log('researcher', ` Waiting for results...`);
        await browserService.wait('ytd-video-renderer', 'visible', 10000);
        await esperar(1000);

        this.log('researcher', ` Selecting top result...`);
        await browserService.click('ytd-video-renderer a#video-title');
    }

    async _esperarOVideoAbrir() {
        this.log('researcher', ` Waiting for video page to stabilize...`);
        for (let i = 0; i < TENTATIVAS_DE_ACHAR_O_VIDEO; i++) {
            await esperar(500);
            const currentUrlResult = await browserService.executeScript('window.location.href');
            const url = urlDoVideoNaPagina(currentUrlResult);
            if (url) return url;
        }
        return '';
    }

    _trazerAJanelaDoNova() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.show();
            this.mainWindow.focus();
        }
    }

    async _concluirABuscaNoYoutube(finalUrl) {
        if (finalUrl && finalUrl.includes('/watch')) {
            this.log('researcher', ` URL Extracted: ${finalUrl}`);
            await browserService.close();
            this._trazerAJanelaDoNova();
            return finalUrl;
        }

        this.log('researcher', ` Extraction failed or invalid URL.`);
        await browserService.close();
        return null;
    }

    async _falhaNaBuscaDoYoutube(e) {
        console.error('[Swarm-RPA] Error:', e.message);
        this.log('researcher', ` Error: ${e.message}`);
        try { await browserService.close(); } catch (_) {}
        return null;
    }

    async executeVisibleYouTubeDownload(searchQuery) {
        this._checkCancelled();
        this.log('researcher', ` Initializing VISIBLE browser sub-system...`);

        try {
            await this._pesquisarNoYoutube(searchQuery);
            return await this._concluirABuscaNoYoutube(await this._esperarOVideoAbrir());
        } catch (e) {
            return this._falhaNaBuscaDoYoutube(e);
        }
    }
}


module.exports = AgentSwarmController;
