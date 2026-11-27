const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const cloudflared = require('cloudflared');
const toolPaths = require('./tool-paths');

const URL_DO_TRYCLOUDFLARE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const ESPERA_PELA_URL_PUBLICA_MS = 15000;

const emDesenvolvimento = () => process.env.NODE_ENV === 'development';

function caminhoDoCloudflared() {
    if (emDesenvolvimento()) return cloudflared.bin;
    return toolPaths.tool('cloudflared') || path.join(process.resourcesPath, toolPaths.exe('cloudflared'));
}

function liberarExecucao(binario) {
    console.info('[RemoteAccess] ✅ Binary found at:', binario);
    try {
        fs.chmodSync(binario, 0o755);
    } catch (err) {
        console.info('[RemoteAccess] Could not set permissions (Windows - not needed):', err.message);
    }
}

function argumentosDoTunel(porta) {
    return ['tunnel', '--url', `http://localhost:${porta}`, '--no-autoupdate'];
}

async function abrirTunelCloudflared(servico) {
    if (servico.cloudflaredProcess) servico.cloudflaredProcess.kill();

    try {
        console.info('[RemoteAccess] Starting Cloudflare Tunnel...');
        const binario = caminhoDoCloudflared();
        console.info('[RemoteAccess] Using binary path:', binario);
        if (fs.existsSync(binario)) liberarExecucao(binario);
        else if (!(await recuperarBinarioAusente(servico, binario))) return;
        dispararCloudflared(servico, binario);
    } catch (error) {
        console.error('[RemoteAccess] Failed to start Cloudflare Tunnel:', error);
        servico.startFallbackTunnel();
    }
}

async function recuperarBinarioAusente(servico, binario) {
    console.warn('[RemoteAccess] Cloudflared binary not found at:', binario);
    if (!emDesenvolvimento()) {
        desistirSemBinario(servico, binario);
        return false;
    }
    await cloudflared.install(binario).catch(err => console.error('[RemoteAccess] Manual install failed:', err));
    return true;
}

function desistirSemBinario(servico, binario) {
    console.error('[RemoteAccess] Binary missing in production build!');
    console.info('[RemoteAccess] Checked path:', binario);
    console.info('[RemoteAccess] Resources path:', process.resourcesPath);
    servico.startFallbackTunnel();
}

function dispararCloudflared(servico, binario) {
    servico.cloudflaredProcess = spawn(binario, argumentosDoTunel(servico.port), {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    console.info('[RemoteAccess] Cloudflared process spawned');
    acompanharCloudflared(servico, servico.cloudflaredProcess);
    setTimeout(() => recuarSemUrlPublica(servico), ESPERA_PELA_URL_PUBLICA_MS);
}

function acompanharCloudflared(servico, processo) {
    const lerSaida = (data) => lerSaidaDoCloudflared(servico, data);
    processo.stdout.on('data', lerSaida);
    processo.stderr.on('data', lerSaida);
    processo.on('error', (err) => {
        console.error('[RemoteAccess] Cloudflared spawn error:', err);
        servico.startFallbackTunnel();
    });
    processo.on('close', (code) => aoFecharCloudflared(servico, code));
}

function lerSaidaDoCloudflared(servico, data) {
    const achada = data.toString().match(URL_DO_TRYCLOUDFLARE);
    if (!achada || servico.publicUrl) return;
    servico.publicUrl = achada[0].trim();
    console.info(`[RemoteAccess] ✅ Cloudflared URL Ready: ${servico.publicUrl}`);
    servico.writeLinkToFile();
    servico.notifyDesktop('tunnel-ready', {
        url: servico.publicUrl,
        provider: 'cloudflare'
    });
}

function aoFecharCloudflared(servico, code) {
    console.info(`[RemoteAccess] Cloudflared exited with code ${code}`);
    if (code !== 0 && !servico.publicUrl) servico.startFallbackTunnel();
    servico.publicUrl = null;
}

function recuarSemUrlPublica(servico) {
    if (servico.publicUrl || !servico.isRunning) return;
    console.info('[RemoteAccess] Cloudflare timeout, trying fallback...');
    servico.startFallbackTunnel();
}

async function abrirTunelReserva(servico) {
    if (servico.publicUrl) return;
    if (!servico.isRunning) return;

    try {
        console.info('[RemoteAccess] Starting Localtunnel fallback...');
        let localtunnel;
        try {
            localtunnel = require('localtunnel');
        } catch (err) {
            console.error('[RemoteAccess] localtunnel module not installed. Fallback unavailable.');
            return;
        }

        const tunnel = await localtunnel({ port: servico.port });

        servico.publicUrl = tunnel.url;
        console.info(`[RemoteAccess] ✅ Localtunnel Ready: ${servico.publicUrl}`);

        servico.writeLinkToFile();

        servico.notifyDesktop('tunnel-ready', {
            url: servico.publicUrl,
            provider: 'localtunnel'
        });

        tunnel.on('close', () => {
            console.info('[RemoteAccess] Localtunnel closed');
            servico.publicUrl = null;
        });

    } catch (error) {
        console.error('[RemoteAccess] Fallback tunnel failed:', error);
    }
}

module.exports = { abrirTunelCloudflared, abrirTunelReserva };
