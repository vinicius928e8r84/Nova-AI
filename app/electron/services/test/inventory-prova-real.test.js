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

function criarDublesLocais(raiz, zipEscolhido) {
  return {
    electron: {
      app: { isPackaged: true, getAppPath: () => path.join(raiz, 'app'), getPath: nome => path.join(raiz, nome) },
      ipcMain: { handle: () => {} },
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [zipEscolhido()] }) },
    },
    'better-sqlite3': BancoDeArquivo,
  };
}

function carregarGerente(raiz, zipEscolhido) {
  for (const chave of Object.keys(require.cache)) {
    if (path.dirname(chave) === PASTA_DOS_SERVICOS) delete require.cache[chave];
  }
  const dubles = criarDublesLocais(raiz, zipEscolhido);
  const original = Module._load;
  Module._load = function carregar(pedido, pai, ...resto) {
    const doServico = pai && pai.filename && path.dirname(pai.filename) === PASTA_DOS_SERVICOS;
    if (doServico && pedido in dubles) return dubles[pedido];
    return original.call(this, pedido, pai, ...resto);
  };
  const { inventoryManager } = require(path.join(PASTA_DOS_SERVICOS, 'inventory-manager.js'));
  return { inventoryManager, desfazer: () => { Module._load = original; } };
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

function prepararVault(pastaAtual) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-prova-real-'));
  const bin = path.join(raiz, 'bin');
  fs.mkdirSync(bin);
  const pathOriginal = process.env.PATH;
  if (process.platform === 'linux') {
    instalarPowershellLocal(bin);
    process.env.PATH = bin + path.delimiter + pathOriginal;
  }
  const estado = { zip: null };
  const { inventoryManager, desfazer } = carregarGerente(raiz, () => estado.zip);
  inventoryManager.init(() => pastaAtual.whatsapp);
  const imagens = path.join(raiz, 'documents', 'Nova_Vault', 'inventory', 'product_images');
  return {
    raiz,
    estado,
    imagens,
    gerente: inventoryManager,
    encerrar() {
      desfazer();
      process.env.PATH = pathOriginal;
      if (inventoryManager.db) inventoryManager.db.close();
      fs.rmSync(raiz, { recursive: true, force: true });
    },
  };
}

function gravarAjuste(gerente, chave, valor) {
  gerente.db.prepare('INSERT OR REPLACE INTO inventory_settings (key, value) VALUES (?, ?)').run(chave, String(valor));
}

function lerValor(gerente, chave) {
  const linha = gerente.db.prepare('SELECT value FROM inventory_settings WHERE key = ?').get(chave);
  return linha && linha.value;
}

async function nomesNoZip(zip) {
  const { Open } = require(UNZIPPER);
  const diretorio = Buffer.isBuffer(zip) ? await Open.buffer(zip) : await Open.file(zip);
  return diretorio.files.filter(arquivo => arquivo.type === 'File').map(arquivo => arquivo.path).sort();
}

function atenderSmtp(socket, mensagens) {
  let buffer = '';
  let nosDados = false;
  const responder = texto => socket.write(texto + '\r\n');
  const tratarComando = linha => {
    const resposta = RESPOSTAS_DO_SMTP.find(([comando]) => linha.startsWith(comando));
    responder(resposta ? resposta[1] : '502 no');
    if (linha.startsWith('DATA')) nosDados = true;
    if (linha.startsWith('QUIT')) socket.end();
  };
  responder('220 local ESMTP');
  socket.on('data', pedaco => {
    buffer += pedaco.toString('latin1');
    while (nosDados ? buffer.includes('\r\n.\r\n') : buffer.includes('\r\n')) {
      const fim = nosDados ? buffer.indexOf('\r\n.\r\n') : buffer.indexOf('\r\n');
      const trecho = buffer.slice(0, fim);
      buffer = buffer.slice(fim + (nosDados ? 5 : 2));
      if (nosDados) {
        mensagens.push(trecho);
        nosDados = false;
        responder('250 ok');
      } else {
        tratarComando(trecho);
      }
    }
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

function semarImagem(vault) {
  fs.mkdirSync(vault.imagens, { recursive: true });
  fs.writeFileSync(path.join(vault.imagens, 'foto.png'), 'imagem-de-verdade');
}

test('backup em zip de verdade e restauração pela ferramenta do sistema', async () => {
  const vault = prepararVault({});
  try {
    semarImagem(vault);
    gravarAjuste(vault.gerente, 'marcador', 'antes');
    const backup = await vault.gerente.criarBackupZip();
    assert.strictEqual(backup.success, true, backup.error);
    assert.ok(fs.statSync(backup.zipPath).size > 0);
    assert.deepStrictEqual(await nomesNoZip(backup.zipPath), ['inventory.db', 'product_images/foto.png']);

    gravarAjuste(vault.gerente, 'marcador', 'depois');
    fs.rmSync(path.join(vault.imagens, 'foto.png'));
    vault.estado.zip = backup.zipPath;
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
    semarImagem(vault);
    const ajustes = {
      auto_backup: 'true',
      smtp_sender: 'loja@example.test',
      smtp_password: 'segredo-de-teste',
      smtp_host: '127.0.0.1',
      smtp_port: smtp.porta,
      smtp_receiver: 'dono@example.test',
    };
    for (const [chave, valor] of Object.entries(ajustes)) gravarAjuste(vault.gerente, chave, valor);

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
    assert.match(texto, /\*Invoice ID:\* #77/);
    assert.match(texto, /\*Chai\* \(x2\) — Rs\. 25\.00/);
    assert.match(texto, /\*Grand Total:\* \*Rs\. 25\.00\*/);
  } finally {
    vault.encerrar();
  }
});
