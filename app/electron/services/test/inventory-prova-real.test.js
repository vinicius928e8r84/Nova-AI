'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PASTA_DOS_SERVICOS = path.join(__dirname, '..');
const UNZIPPER = require.resolve('unzipper');
const RESPOSTAS_DO_SMTP = [
  ['EHLO', '250-local\r\n250 AUTH PLAIN'],
  ['AUTH', '235 ok'],
  ['MAIL', '250 ok'],
  ['RCPT', '250 ok'],
  ['DATA', '354 go'],
  ['QUIT', '221 bye'],
];
const FIM_DA_LINHA = '\r\n';
const FIM_DOS_DADOS = '\r\n.\r\n';

class BancoDeArquivo {
  constructor(caminho) {
    this.banco = new DatabaseSync(caminho);
  }

  pragma(texto) {
    return this.banco.prepare('PRAGMA ' + texto).all();
  }

  exec(sql) {
    this.banco.exec(sql);
    return this;
  }

  prepare(sql) {
    return this.banco.prepare(sql);
  }

  transaction(fazer) {
    return (...argumentos) => fazer(...argumentos);
  }

  close() {
    this.banco.close();
  }
}

function criarDublesLocais(raiz) {
  return {
    electron: {
      app: { isPackaged: true, getAppPath: () => path.join(raiz, 'app'), getPath: nome => path.join(raiz, nome) },
      ipcMain: { handle: () => {} },
    },
    'better-sqlite3': BancoDeArquivo,
  };
}

function limparCacheDosServicos() {
  const chaves = Object.keys(require.cache);
  chaves.filter(chave => path.dirname(chave) === PASTA_DOS_SERVICOS).forEach(chave => delete require.cache[chave]);
}

function pedidoVemDoServico(pai) {
  return Boolean(pai && pai.filename) && path.dirname(pai.filename) === PASTA_DOS_SERVICOS;
}

function criarCarregadorComDubles(dubles, original) {
  return function carregar(pedido, pai, ...resto) {
    const substituir = pedidoVemDoServico(pai) && Object.hasOwn(dubles, pedido);
    return substituir ? dubles[pedido] : original.call(this, pedido, pai, ...resto);
  };
}

function carregarGerente(raiz) {
  limparCacheDosServicos();
  const original = Module._load;
  Module._load = criarCarregadorComDubles(criarDublesLocais(raiz), original);
  const desfazer = () => { Module._load = original; };
  try {
    const { inventoryManager } = require(path.join(PASTA_DOS_SERVICOS, 'inventory-manager.js'));
    return { inventoryManager, desfazer };
  } catch (erro) {
    desfazer();
    throw erro;
  }
}

function instalarPowershellLocal(pasta) {
  const alvo = path.join(pasta, 'powershell');
  const corpo = [
    '#!/usr/bin/env node',
    `const unzipper = require(${JSON.stringify(UNZIPPER)});`,
    "const [origem, destino] = [...process.argv[4].matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, \"'\"));",
    "unzipper.Open.file(origem).then(zip => zip.extract({ path: destino })).catch(erro => { console.error(erro.message); process.exit(1); });",
  ].join('\n');
  fs.writeFileSync(alvo, corpo, { mode: 0o755 });
}

function instalarPowershellNoPath(raiz) {
  if (process.platform !== 'linux') return;
  const bin = path.join(raiz, 'bin');
  fs.mkdirSync(bin);
  instalarPowershellLocal(bin);
  process.env.PATH = bin + path.delimiter + process.env.PATH;
}

function iniciarGerente(raiz, pastaAtual, vault) {
  instalarPowershellNoPath(raiz);
  const carregado = carregarGerente(raiz);
  vault.desfazer = carregado.desfazer;
  vault.gerente = carregado.inventoryManager;
  vault.gerente.init(() => pastaAtual.whatsapp);
}

function encerrarVault(vault) {
  vault.desfazer();
  process.env.PATH = vault.pathOriginal;
  vault.gerente?.db?.close();
  fs.rmSync(vault.raiz, { recursive: true, force: true });
}

function prepararVault(pastaAtual) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-prova-real-'));
  const imagens = path.join(raiz, 'documents', 'Nova_Vault', 'inventory', 'product_images');
  const vault = { raiz, imagens, gerente: null, desfazer: () => {}, pathOriginal: process.env.PATH };
  vault.encerrar = () => encerrarVault(vault);
  try {
    iniciarGerente(raiz, pastaAtual, vault);
  } catch (erro) {
    vault.encerrar();
    throw erro;
  }
  return vault;
}

function gravarAjuste(gerente, chave, valor) {
  gerente.db.prepare('INSERT OR REPLACE INTO inventory_settings (key, value) VALUES (?, ?)').run(chave, String(valor));
}

function gravarAjustes(gerente, ajustes) {
  Object.entries(ajustes).forEach(([chave, valor]) => gravarAjuste(gerente, chave, valor));
}

function lerValor(gerente, chave) {
  const linha = gerente.db.prepare('SELECT value FROM inventory_settings WHERE key = ?').get(chave);
  return linha?.value;
}

async function nomesNoZip(zip) {
  const { Open } = require(UNZIPPER);
  const diretorio = Buffer.isBuffer(zip) ? await Open.buffer(zip) : await Open.file(zip);
  return diretorio.files.filter(arquivo => arquivo.type === 'File').map(arquivo => arquivo.path).sort();
}

function respostaAoComando(linha) {
  const resposta = RESPOSTAS_DO_SMTP.find(([comando]) => linha.startsWith(comando));
  return resposta ? resposta[1] : '502 no';
}

function separadorDaSessao(sessao) {
  return sessao.nosDados ? FIM_DOS_DADOS : FIM_DA_LINHA;
}

function cortarAteSeparador(buffer, separador) {
  const fim = buffer.indexOf(separador);
  if (fim < 0) return null;
  return { trecho: buffer.slice(0, fim), resto: buffer.slice(fim + separador.length) };
}

function receberDados(sessao, trecho) {
  sessao.mensagens.push(trecho);
  sessao.nosDados = false;
  sessao.responder('250 ok');
}

function receberComando(sessao, linha) {
  sessao.responder(respostaAoComando(linha));
  if (linha.startsWith('DATA')) sessao.nosDados = true;
  if (linha.startsWith('QUIT')) sessao.socket.end();
}

function tratarTrecho(sessao, trecho) {
  if (sessao.nosDados) receberDados(sessao, trecho);
  else receberComando(sessao, trecho);
}

function consumirBuffer(sessao) {
  const parte = cortarAteSeparador(sessao.buffer, separadorDaSessao(sessao));
  if (!parte) return;
  sessao.buffer = parte.resto;
  tratarTrecho(sessao, parte.trecho);
  consumirBuffer(sessao);
}

function atenderSmtp(socket, mensagens) {
  const sessao = {
    socket,
    mensagens,
    buffer: '',
    nosDados: false,
    responder: texto => socket.write(texto + FIM_DA_LINHA),
  };
  sessao.responder('220 local ESMTP');
  socket.on('data', pedaco => {
    sessao.buffer += pedaco.toString('latin1');
    consumirBuffer(sessao);
  });
}

function abrirServidorSmtp() {
  const mensagens = [];
  const servidor = net.createServer(socket => atenderSmtp(socket, mensagens));
  return new Promise(resolve => {
    servidor.listen(0, '127.0.0.1', () => resolve({ servidor, mensagens, porta: servidor.address().port }));
  });
}

function anexoDaMensagem(mensagem) {
  const [, nome] = mensagem.match(/filename="?([^"\r\n;]+)"?/);
  const [, base64] = mensagem.match(/Content-Transfer-Encoding: base64\r\n[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/);
  return { nome, conteudo: Buffer.from(base64, 'base64') };
}

function semearImagem(vault) {
  fs.mkdirSync(vault.imagens, { recursive: true });
  fs.writeFileSync(path.join(vault.imagens, 'foto.png'), 'imagem-de-verdade');
}

test('backup em zip de verdade e restauração a partir dele', async () => {
  const vault = prepararVault({});
  try {
    semearImagem(vault);
    gravarAjuste(vault.gerente, 'marcador', 'antes');
    const backup = await vault.gerente.criarBackupZip();
    assert.strictEqual(backup.success, true, backup.error);
    assert.ok(fs.statSync(backup.zipPath).size > 0);
    assert.deepStrictEqual(await nomesNoZip(backup.zipPath), ['inventory.db', 'product_images/foto.png']);

    gravarAjuste(vault.gerente, 'marcador', 'depois');
    fs.rmSync(path.join(vault.imagens, 'foto.png'));
    const restauracao = await vault.gerente.restaurarDoZip(backup.zipPath);

    assert.deepStrictEqual(restauracao, { success: true });
    assert.strictEqual(lerValor(vault.gerente, 'marcador'), 'antes');
    assert.strictEqual(fs.readFileSync(path.join(vault.imagens, 'foto.png'), 'utf8'), 'imagem-de-verdade');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(vault.imagens)).filter(nome => nome.startsWith('temp_restore_')), []);
  } finally {
    vault.encerrar();
  }
});

test('backup automático chega por SMTP local com o zip do vault anexado', async () => {
  const smtp = await abrirServidorSmtp();
  const vault = prepararVault({});
  try {
    semearImagem(vault);
    const ajustes = {
      auto_backup: 'true',
      smtp_sender: 'loja@example.test',
      smtp_password: 'segredo-de-teste',
      smtp_host: '127.0.0.1',
      smtp_port: smtp.porta,
      smtp_receiver: 'dono@example.test',
    };
    gravarAjustes(vault.gerente, ajustes);

    await vault.gerente.runAutoEmailBackup();

    assert.strictEqual(smtp.mensagens.length, 1);
    const [mensagem] = smtp.mensagens;
    assert.match(mensagem, /^From: loja@example\.test/m);
    assert.match(mensagem, /^To: dono@example\.test/m);
    const anexo = anexoDaMensagem(mensagem);
    assert.match(anexo.nome, /^nova_inventory_autobackup_\d+\.zip$/);
    assert.deepStrictEqual(await nomesNoZip(anexo.conteudo), ['inventory.db', 'product_images/foto.png']);
    const sobras = fs.readdirSync(path.dirname(vault.imagens)).filter(nome => nome.endsWith('.zip'));
    assert.deepStrictEqual(sobras, []);
  } finally {
    vault.encerrar();
    smtp.servidor.close();
  }
});

test('recibo do WhatsApp sai com o número, a loja e os itens da venda', async () => {
  const enviados = [];
  const whatsapp = {
    client: {},
    isReady: true,
    sendReply: async (...argumentos) => { enviados.push(argumentos); return true; },
  };
  const vault = prepararVault({ whatsapp });
  try {
    const vendas = require(path.join(PASTA_DOS_SERVICOS, 'inventory-vendas.js'));
    vault.gerente.gravarPerfil({ name: 'Mercearia Prova', type: 'Mercado', details: '', contact: '' });
    const resposta = await vendas.enviarRecibo(vault.gerente, {
      invoiceId: 77,
      items: [{ name: 'Chai', quantity: 2, price: 12.5 }],
      total: 25,
      discount: 0,
      paymentMethod: 'Cash',
      customerPhone: '0300-1234567',
    });

    assert.deepStrictEqual(resposta, { success: true });
    assert.strictEqual(enviados.length, 1);
    const [jid, texto, citar] = enviados[0];
    assert.strictEqual(jid, '923001234567@c.us');
    assert.strictEqual(citar, true);
    assert.match(texto, /^🧾 \*RECEIPT: MERCEARIA PROVA\*$/m);
    assert.match(texto, /\*Invoice ID:\* #77/);
    assert.match(texto, /\*Chai\* \(x2\) — Rs\. 25\.00/);
    assert.match(texto, /\*Grand Total:\* \*Rs\. 25\.00\*/);
  } finally {
    vault.encerrar();
  }
});
