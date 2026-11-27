'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { once } = require('events');

const RAIZ = path.join(__dirname, '../..');
const ARQUIVOS_DO_PALCO = /\.(palco|cenas|test)\.js$/;
const ESPERA_MAXIMA_MS = 3000;

function mascarar(valor, pasta) {
  if (typeof valor === 'string') return pasta && valor.includes(pasta) ? valor.split(pasta).join('<pasta>').replaceAll('\\', '/') : valor;
  if (Array.isArray(valor)) return valor.map(item => mascarar(item, pasta));
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, mascarar(item, pasta)]));
  return valor;
}

function criarRegistro() {
  const registro = { entradas: [], pasta: null, servidor: null, fluxos: [], processos: 0 };
  registro.anotar = (rotulo, valor) => registro.entradas.push([rotulo, mascarar(valor === undefined ? null : valor, registro.pasta)]);
  return registro;
}

function criarTrocas() {
  const desfazer = [];
  return {
    trocar: (objeto, nome, novo) => {
      const antigo = objeto[nome];
      objeto[nome] = novo;
      desfazer.push(() => { objeto[nome] = antigo; });
    },
    trocarAmbiente: (chave, valor) => {
      const antigo = process.env[chave];
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
      desfazer.push(() => (antigo === undefined ? delete process.env[chave] : (process.env[chave] = antigo)));
    },
    guardar: acao => desfazer.push(acao),
    desfazerTudo: () => {
      while (desfazer.length) desfazer.pop()();
    },
  };
}

function falsificarModulo(arquivo, exportado, trocas) {
  const resolvido = require.resolve(path.join(RAIZ, arquivo));
  const antigo = require.cache[resolvido];
  require.cache[resolvido] = { id: resolvido, filename: resolvido, loaded: true, exports: exportado, children: [], paths: [] };
  trocas.guardar(() => (antigo ? (require.cache[resolvido] = antigo) : delete require.cache[resolvido]));
}

function limparCacheDaBancada() {
  for (const arquivo of Object.keys(require.cache)) {
    if (arquivo.startsWith(__dirname + path.sep) && !ARQUIVOS_DO_PALCO.test(arquivo)) delete require.cache[arquivo];
  }
}

function interceptarServidor(registro, trocas) {
  const criar = http.createServer;
  trocas.trocar(http, 'createServer', (...argumentos) => {
    const servidor = criar.apply(http, argumentos);
    const escutar = servidor.listen.bind(servidor);
    servidor.listen = (porta, ...resto) => {
      registro.anotar('listen', Number.isNaN(porta) ? 'NaN' : porta);
      return escutar(0, '127.0.0.1', ...resto);
    };
    registro.servidor = servidor;
    return servidor;
  });
}

function falsificarProcessos(registro, trocas, cenario) {
  trocas.trocar(childProcess, 'spawn', (programa, argumentos, opcoes) => {
    const numero = registro.processos++;
    registro.anotar('spawn', { numero, programa, argumentos, opcoes });
    return {
      kill: sinal => {
        registro.anotar('kill', { numero, sinal });
        if (cenario.matarFalha) throw new Error('o processo já saiu');
      },
    };
  });
  trocas.trocar(childProcess, 'spawnSync', (programa, argumentos) => {
    registro.anotar('spawnSync', { programa, argumentos });
    const saida = cenario.ffprobe || {};
    return { stdout: Buffer.from(saida.stdout || ''), stderr: Buffer.from(saida.stderr || '') };
  });
}

function falsificarPastaTemporaria(registro, trocas) {
  const criar = fs.mkdtempSync;
  trocas.trocar(fs, 'mkdtempSync', prefixo => {
    registro.pasta = criar(prefixo);
    registro.anotar('mkdtempSync', { prefixo: path.basename(prefixo), dentroDoTmp: path.dirname(prefixo) === os.tmpdir() });
    return registro.pasta;
  });
}

function prepararAmbiente(registro, trocas, cena) {
  const ambiente = cena.ambiente || {};
  trocas.trocarAmbiente('PORT', ambiente.PORT);
  trocas.trocarAmbiente('RTMP_PORT', ambiente.RTMP_PORT);
  trocas.trocar(console, 'log', (...partes) => registro.anotar('console.log', partes.join(' ')));
  interceptarServidor(registro, trocas);
  falsificarProcessos(registro, trocas, cena.cenario || {});
  falsificarPastaTemporaria(registro, trocas);
  for (const [arquivo, exportado] of Object.entries(cena.modulos(registro))) falsificarModulo(arquivo, exportado, trocas);
}

async function aguardar(condicao) {
  const limite = Date.now() + ESPERA_MAXIMA_MS;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error('a espera acabou');
    await new Promise(resolver => setTimeout(resolver, 10));
  }
}

function pedir(porta, metodo, rota, corpo) {
  return new Promise((resolver, rejeitar) => {
    const requisicao = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: rota, agent: false }, resposta => {
      const pedacos = [];
      resposta.on('data', pedaco => pedacos.push(pedaco));
      resposta.on('end', () => resolver({ status: resposta.statusCode, tipo: resposta.headers['content-type'], corpo: Buffer.concat(pedacos) }));
    });
    requisicao.on('error', rejeitar);
    requisicao.end(corpo);
  });
}

function igualAoArquivo(corpo, arquivo) {
  const relativo = path.relative(RAIZ, arquivo).split(path.sep).join('/');
  return corpo.equals(fs.readFileSync(arquivo)) ? `igual a ${relativo}` : `diferente de ${relativo}`;
}

function descreverResposta(resposta, arquivo) {
  return { status: resposta.status, tipo: resposta.tipo ?? null, corpo: arquivo ? igualAoArquivo(resposta.corpo, arquivo) : resposta.corpo.toString('utf8') };
}

function abrirEventos(porta, registro) {
  return new Promise((resolver, rejeitar) => {
    let recebido = '';
    const requisicao = http.request({ host: '127.0.0.1', port: porta, path: '/events', agent: false }, resposta => {
      resposta.setEncoding('utf8');
      resposta.on('data', pedaco => { recebido += pedaco; });
      resolver({
        cabecalhos: { status: resposta.statusCode, tipo: resposta.headers['content-type'], cache: resposta.headers['cache-control'] },
        lido: () => recebido,
        esperarTexto: texto => aguardar(() => recebido.includes(texto)),
        fechar: () => requisicao.destroy(),
      });
    });
    requisicao.on('error', rejeitar);
    registro.fluxos.push(requisicao);
    requisicao.end();
  });
}

function impressaoDaResposta(resposta) {
  return { status: resposta.status, tipo: resposta.tipo ?? null, bytes: resposta.corpo.length, sha256: crypto.createHash('sha256').update(resposta.corpo).digest('hex') };
}

function criarControles(registro) {
  const porta = () => registro.servidor.address().port;
  return {
    anotar: registro.anotar,
    pasta: () => registro.pasta,
    get: async (rota, arquivo) => registro.anotar(`GET ${rota}`, descreverResposta(await pedir(porta(), 'GET', rota), arquivo)),
    post: async (rota, corpo) => registro.anotar(`POST ${rota}`, descreverResposta(await pedir(porta(), 'POST', rota, corpo))),
    getImpressao: async rota => registro.anotar(`GET ${rota}`, impressaoDaResposta(await pedir(porta(), 'GET', rota))),
    pausa: ms => new Promise(resolver => setTimeout(resolver, ms)),
    aguardar,
    abrirEventos: () => abrirEventos(porta(), registro),
  };
}

async function encerrar(registro, trocas) {
  trocas.desfazerTudo();
  delete globalThis.__counts;
  registro.fluxos.forEach(fluxo => fluxo.destroy());
  if (registro.servidor) {
    registro.servidor.closeAllConnections();
    await new Promise(resolver => registro.servidor.close(resolver));
  }
  if (registro.pasta) fs.rmSync(registro.pasta, { recursive: true, force: true });
}

async function iniciar(arquivoDoHarness, registro) {
  limparCacheDaBancada();
  require(arquivoDoHarness);
  if (!registro.servidor.listening) await once(registro.servidor, 'listening');
}

async function rodarCena(arquivoDoHarness, cena) {
  const registro = criarRegistro();
  const trocas = criarTrocas();
  try {
    prepararAmbiente(registro, trocas, cena);
    await iniciar(arquivoDoHarness, registro);
    await cena.roteiro(criarControles(registro));
  } catch (erro) {
    registro.anotar('erro', erro.message);
  } finally {
    await encerrar(registro, trocas);
  }
  return registro.entradas;
}

module.exports = { rodarCena, RAIZ };
