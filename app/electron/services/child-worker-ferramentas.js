'use strict';

const { net } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { browserService } = require('./browser-manager');

const TEMPO_DO_SHELL_EM_MS = 15000;
const LIMITE_DO_TEXTO_DA_PESQUISA = 1500;
const LIMITE_DO_TEXTO_DO_SITE = 4000;
const LIMITE_DO_ARQUIVO_LIDO = 3000;
const MAXIMO_DE_RESULTADOS = 3;
const PADRAO_DOS_RESULTADOS = /<a href="\/url\?q=(https?:\/\/[^"&]+)[^>]*><h3[^>]*>(?:<div[^>]*>)?([^<]+)(?:<\/div>)?<\/h3>/g;

const jsonOuTexto = (dados) => {
    try {
        return JSON.parse(dados);
    } catch (erro) {
        return dados;
    }
};

const textoLimpo = (html, limite) => html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, limite);

function lerRespostaDoElectron(resposta, resolve, reject) {
    let dados = '';
    resposta.on('data', (pedaco) => { dados += pedaco.toString(); });
    resposta.on('end', () => resolve(jsonOuTexto(dados)));
    resposta.on('error', (erro) => reject(new Error(`Net response error: ${erro.message}`)));
}

function postarNoElectron(url, corpo = '') {
    return new Promise((resolve, reject) => {
        try {
            const pedido = net.request({ method: corpo ? 'POST' : 'GET', url, useSessionCookies: true });
            pedido.on('response', (resposta) => lerRespostaDoElectron(resposta, resolve, reject));
            pedido.on('error', (erro) => reject(new Error(`Net request error: ${erro.message}`)));
            if (corpo) {
                pedido.setHeader('Content-Type', 'application/json');
                pedido.write(corpo);
            }
            pedido.end();
        } catch (erro) {
            reject(new Error(`_electronPost fatal: ${erro.message}`));
        }
    });
}

function resultadosDoGoogle(html) {
    return [...html.matchAll(PADRAO_DOS_RESULTADOS)]
        .map(([, link, titulo]) => ({ title: titulo.replace(/&amp;/g, '&').replace(/&quot;/g, '"'), link }))
        .filter((resultado) => !resultado.link.includes('google.com'))
        .slice(0, MAXIMO_DE_RESULTADOS);
}

function textoDosResultados(consulta, resultados) {
    const linhas = resultados.map((resultado, indice) => `${indice + 1}. ${resultado.title}\n   ${resultado.link}`);
    return `Google Results for "${consulta}":\n\n${linhas.join('\n\n')}`;
}

async function pesquisarNaWeb(agente, consulta) {
    try {
        const html = await agente._electronPost(`https://www.google.com/search?q=${encodeURIComponent(consulta)}`, '');
        if (typeof html !== 'string' || !html) return 'web_search error: Empty or invalid response from Google.';
        const resultados = resultadosDoGoogle(html);
        if (resultados.length > 0) return textoDosResultados(consulta, resultados);
        return `Google search results for "${consulta}":\n${textoLimpo(html, LIMITE_DO_TEXTO_DA_PESQUISA)}\n\n(Regex failed, try browse_site with a URL)`;
    } catch (erro) {
        return `web_search error: ${erro.message}`;
    }
}

function enderecoDoSite(url) {
    const limpo = url.trim().replace(/^["']|["']$/g, '');
    return limpo.startsWith('http') ? limpo : `https://${limpo}`;
}

function lerRespostaDoSite(resposta, endereco, resolve) {
    if (resposta.statusCode >= 400) {
        resolve(`Browse error: Server returned status ${resposta.statusCode} for ${endereco}`);
        return;
    }
    let dados = '';
    resposta.on('data', (pedaco) => { dados += pedaco.toString(); });
    resposta.on('end', () => resolve(`Content from ${endereco}:\n${textoLimpo(dados, LIMITE_DO_TEXTO_DO_SITE)}`));
    resposta.on('error', (erro) => resolve(`Browse error: ${erro.message}`));
}

async function lerSite(url) {
    const endereco = enderecoDoSite(url);
    return new Promise((resolve) => {
        try {
            const pedido = net.request({ method: 'GET', url: endereco, redirect: 'follow' });
            pedido.on('response', (resposta) => lerRespostaDoSite(resposta, endereco, resolve));
            pedido.on('error', (erro) => resolve(`Browse error: ${erro.message}`));
            pedido.end();
        } catch (erro) {
            resolve(`Browse error: ${erro.message}`);
        }
    });
}

function respostaDoShell(erro, saida, saidaDeErro) {
    if (erro) return `Error: ${saidaDeErro || erro.message}`;
    return saida?.trim() || 'Command executed successfully.';
}

function executarShell(comando) {
    return new Promise((resolve) => {
        exec(comando, { timeout: TEMPO_DO_SHELL_EM_MS }, (erro, saida, saidaDeErro) => resolve(respostaDoShell(erro, saida, saidaDeErro)));
    });
}

const caminhoDosDados = (relativo) => path.resolve(os.homedir(), 'Documents', 'Nova Data', relativo);

function gravarArquivo(args) {
    const barra = args.indexOf('|');
    if (barra === -1) return 'Error: Format must be filename|content';
    const conteudo = args.substring(barra + 1).trim();
    const destino = caminhoDosDados(args.substring(0, barra).trim());
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, conteudo);
    return `OK: Saved ${conteudo.length} chars to ${destino}`;
}

function lerArquivo(args) {
    const origem = caminhoDosDados(args.trim());
    if (!fs.existsSync(origem)) return `Error: File not found at ${origem}`;
    return fs.readFileSync(origem, 'utf8').substring(0, LIMITE_DO_ARQUIVO_LIDO);
}

const resultadoDoNavegador = (retorno) => (typeof retorno === 'object' ? retorno.result : retorno);

async function navegarPara(args) {
    await browserService.launch();
    return browserService.navigate(args.trim());
}

async function fotografarPagina(args) {
    const comImagem = args && args.toLowerCase().includes('true');
    const foto = await browserService.snapshot(comImagem);
    return foto.result || 'Snapshot taken successfully.';
}

async function digitarNaPagina(args) {
    const partes = args.split('|');
    if (partes.length < 2) return 'Error: Format must be selector|text';
    const retorno = await browserService.type(partes[0].trim(), partes.slice(1).join('|').trim(), true);
    return resultadoDoNavegador(retorno);
}

async function baixarComOGerenciador(agente, args) {
    const partes = args.split('|');
    const url = partes[0].trim();
    const formato = (partes[1] || 'best').trim();
    if (!agente.app?.ytdlpManager) return 'Error: Downloader not ready.';
    await agente.app.ytdlpManager.manualDownload(url, formato, 'video');
    return `OK: Download started via IDM-style downloader for ${url}`;
}

const FERRAMENTAS = new Map([
    ['web_search', (agente, args) => agente._webSearch(args)],
    ['browse_site', (agente, args) => agente._browseSite(args)],
    ['execute_shell', (agente, args) => agente._execShell(args)],
    ['write_file', (agente, args) => gravarArquivo(args)],
    ['read_file', (agente, args) => lerArquivo(args)],
    ['browser_navigate', (agente, args) => navegarPara(args)],
    ['browser_snapshot', (agente, args) => fotografarPagina(args)],
    ['browser_click', async (agente, args) => resultadoDoNavegador(await browserService.click(args.trim()))],
    ['browser_vision_click', async (agente, args) => resultadoDoNavegador(await browserService.visionClick(args.trim()))],
    ['browser_type', (agente, args) => digitarNaPagina(args)],
    ['browser_scroll', (agente, args) => browserService.scroll(args.trim().toLowerCase() || 'down')],
    ['browser_extract', (agente, args) => browserService.extract(args.trim() || undefined)],
    ['idm_download', (agente, args) => baixarComOGerenciador(agente, args)],
]);

async function despacharFerramenta(agente, nome, args) {
    try {
        const ferramenta = FERRAMENTAS.get(nome.toLowerCase());
        if (!ferramenta) return `Error: Unknown tool "${nome}".`;
        return await ferramenta(agente, args);
    } catch (erro) {
        return `Tool error (${nome}): ${erro.message}`;
    }
}

module.exports = { despacharFerramenta, executarShell, lerSite, pesquisarNaWeb, postarNoElectron };
