'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const childProcess = require('child_process');
const { carregarMain } = require('./ajuda/carregar-main');

const AGORA = 1790000000000;
const LIMITE_DO_ANEXO = 50 * 1024 * 1024;
const TIPO_DO_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_REAL = require('mime-types');

function dialogoFalso(respostas = []) {
  const fila = respostas.slice();
  const pedidos = [];
  const proxima = (nome) => (...argumentos) => {
    pedidos.push([nome, ...argumentos]);
    const resposta = fila.length > 1 ? fila.shift() : fila[0];
    if (resposta instanceof Error) throw resposta;
    return resposta;
  };
  return { pedidos, showOpenDialog: proxima('abrir'), showSaveDialog: proxima('salvar') };
}

const escolheu = (...filePaths) => ({ canceled: false, filePaths });
const cancelou = { canceled: true, filePaths: [] };

function chamarDireto(main, canal, ...argumentos) {
  return Promise.resolve(main.canais.handle.get(canal)({ sender: {} }, ...argumentos));
}

function anotandoConsole(funcao) {
  const antes = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const chamadas = [];
  const comoNivel = { info: 'log' };
  for (const nivel of Object.keys(antes)) console[nivel] = (...partes) => chamadas.push([comoNivel[nivel] || nivel, ...partes]);
  const restaurar = () => Object.assign(console, antes);
  return Promise.resolve().then(funcao).then((resultado) => ({ resultado, chamadas })).finally(restaurar);
}

function gravar(arquivo, conteudo) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, conteudo);
  return arquivo;
}

const textoDe = (main) => (nome, conteudo) => gravar(path.join(main.raiz, 'entrada', nome), conteudo);

function carregarComDialogo(respostas, extras = {}) {
  const dialog = dialogoFalso(respostas);
  const main = carregarMain({ electron: { dialog, ...extras.electron }, modulos: { 'mime-types': MIME_REAL, ...extras.modulos } });
  return { main, dialog };
}

function carregarSemJanela() {
  const dialog = dialogoFalso([escolheu('x')]);
  const handlers = new Map();
  const ipcMain = { handle: (canal, tratador) => handlers.set(canal, tratador), on: () => {} };
  function JanelaQueNaoAbre() { throw new Error('janela não abre neste teste'); }
  try {
    carregarMain({ electron: { dialog, ipcMain, BrowserWindow: JanelaQueNaoAbre }, modulos: { 'mime-types': MIME_REAL } });
  } catch (erro) {
    assert.strictEqual(erro.message, 'janela não abre neste teste');
  }
  return { dialog, chamar: (canal, ...argumentos) => handlers.get(canal)({ sender: {} }, ...argumentos) };
}

const FILTRO_DE_MIDIA = [{ name: 'Media Files', extensions: ['mp4', 'mkv', 'avi', 'jpg', 'jpeg', 'png'] }];
const FILTRO_DE_AUDIO = [{ name: 'Audio Files', extensions: ['wav'] }];
const FILTRO_DE_VIDEOS = [{ name: 'Videos', extensions: ['mp4', 'mkv', 'mov'] }];
const FILTRO_DE_AUDIOS = [{ name: 'Audio', extensions: ['mp3', 'wav', 'aac'] }];
const FILTRO_DE_IMAGENS = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }];

test('dialog:open-file abre a janela de escolha sobre a janela principal, com as opções pedidas ou as padrão, e devolve null se cancelou', async () => {
  const { main, dialog } = carregarComDialogo([escolheu('a.txt'), cancelou]);
  const opcoes = { properties: ['openDirectory'], title: 'x' };
  assert.deepStrictEqual(await main.invocar('dialog:open-file', opcoes), escolheu('a.txt'));
  assert.strictEqual(dialog.pedidos[0][1], main.janelaPrincipal);
  assert.strictEqual(dialog.pedidos[0][2], opcoes);
  assert.strictEqual(await main.invocar('dialog:open-file'), null);
  assert.deepStrictEqual(dialog.pedidos[1].slice(2), [{ properties: ['openFile'] }]);
  assert.strictEqual(dialog.pedidos[1][1], main.janelaPrincipal);
  assert.strictEqual(await main.invocar('dialog:open-file', null), null);
  assert.deepStrictEqual(dialog.pedidos[2].slice(2), [{ properties: ['openFile'] }]);
});

const JANELAS_DE_UM_ARQUIVO = [
  ['open-media-dialog', FILTRO_DE_MIDIA],
  ['open-audio-dialog', FILTRO_DE_AUDIO],
];

for (const [canal, filtros] of JANELAS_DE_UM_ARQUIVO) {
  test(`${canal}: abre sobre a janela principal com o filtro dele, devolve o primeiro caminho e null se cancelou`, async () => {
    const { main, dialog } = carregarComDialogo([escolheu('um.mp4', 'dois.mp4'), cancelou, escolheu()]);
    assert.strictEqual(await main.invocar(canal), 'um.mp4');
    assert.strictEqual(dialog.pedidos[0][1], main.janelaPrincipal);
    assert.deepStrictEqual(dialog.pedidos[0].slice(2), [{ properties: ['openFile'], filters: filtros }]);
    assert.strictEqual(await main.invocar(canal), null);
    assert.strictEqual(await main.invocar(canal), undefined);
    assert.strictEqual(dialog.pedidos.length, 3);
  });
}

test('as janelas de escolha que dependem da janela principal não abrem nada sem ela', async () => {
  const { dialog, chamar } = carregarSemJanela();
  assert.strictEqual(await chamar('dialog:open-file', { properties: ['openFile'] }), null);
  assert.strictEqual(await chamar('open-media-dialog'), null);
  assert.strictEqual(await chamar('open-audio-dialog'), null);
  assert.deepStrictEqual(dialog.pedidos, []);
  assert.deepStrictEqual(await chamar('select-directory'), 'x');
  assert.deepStrictEqual(dialog.pedidos, [['abrir', { properties: ['openDirectory'] }]]);
});

const FILTROS_DO_TIPO = [
  ['video', FILTRO_DE_VIDEOS],
  ['audio', FILTRO_DE_AUDIOS],
  ['image', FILTRO_DE_IMAGENS],
  [undefined, FILTRO_DE_IMAGENS],
  ['qualquer coisa', FILTRO_DE_IMAGENS],
  ['constructor', FILTRO_DE_IMAGENS],
];

test('select-media-file: filtra por tipo (vídeo, áudio, imagem para o resto), sem janela-mãe, e devolve o primeiro caminho ou null', async () => {
  for (const [tipo, filtros] of FILTROS_DO_TIPO) {
    const { main, dialog } = carregarComDialogo([escolheu('um', 'dois'), cancelou, escolheu()]);
    assert.strictEqual(await main.invocar('select-media-file', tipo), 'um', String(tipo));
    assert.strictEqual(await main.invocar('select-media-file', tipo), null);
    assert.strictEqual(await main.invocar('select-media-file', tipo), null);
    assert.deepStrictEqual(dialog.pedidos[0], ['abrir', { properties: ['openFile'], filters: filtros }], String(tipo));
    assert.strictEqual(dialog.pedidos.length, 3);
  }
});

test('select-directory pede uma pasta, sem janela-mãe, e devolve o primeiro caminho ou null', async () => {
  const { main, dialog } = carregarComDialogo([escolheu('/pasta', '/outra'), cancelou, escolheu()]);
  assert.strictEqual(await main.invocar('select-directory'), '/pasta');
  assert.strictEqual(await main.invocar('select-directory'), null);
  assert.strictEqual(await main.invocar('select-directory'), null);
  assert.deepStrictEqual(dialog.pedidos[0], ['abrir', { properties: ['openDirectory'] }]);
  assert.strictEqual(dialog.pedidos.length, 3);
});

test('select-multiple-media: vídeo ou áudio (áudio para o resto), vários arquivos, devolve todos os caminhos ou null', async () => {
  const filtrosDoTipo = [['video', FILTRO_DE_VIDEOS], ['audio', FILTRO_DE_AUDIOS], [undefined, FILTRO_DE_AUDIOS], ['image', FILTRO_DE_AUDIOS]];
  for (const [tipo, filtros] of filtrosDoTipo) {
    const { main, dialog } = carregarComDialogo([escolheu('um', 'dois'), cancelou, escolheu()]);
    assert.deepStrictEqual(await main.invocar('select-multiple-media', tipo), ['um', 'dois'], String(tipo));
    assert.strictEqual(await main.invocar('select-multiple-media', tipo), null);
    assert.strictEqual(await main.invocar('select-multiple-media', tipo), null);
    assert.deepStrictEqual(dialog.pedidos[0], ['abrir', { properties: ['openFile', 'multiSelections'], filters: filtros }], String(tipo));
  }
});

test('open-file abre pelo shell e devolve true; erro do shell e exceção devolvem false e vão para o console', async () => {
  const pedidos = [];
  const respostas = ['', 'não achei', new Error('shell caiu')];
  const shell = { openPath: async (caminho) => { pedidos.push(caminho); const r = respostas.shift(); if (r instanceof Error) throw r; return r; } };
  const main = carregarMain({ electron: { shell } });
  const { resultado, chamadas } = await anotandoConsole(async () => [
    await chamarDireto(main, 'open-file', '/a.txt'),
    await chamarDireto(main, 'open-file', '/b.txt'),
    await chamarDireto(main, 'open-file', '/c.txt'),
  ]);
  assert.deepStrictEqual(resultado, [true, false, false]);
  assert.deepStrictEqual(pedidos, ['/a.txt', '/b.txt', '/c.txt']);
  assert.deepStrictEqual(chamadas.slice(0, 1), [['error', 'Failed to open file:', 'não achei']]);
  assert.deepStrictEqual(chamadas[1].slice(0, 2), ['error', 'Failed to open file exception:']);
  assert.strictEqual(chamadas[1][2].message, 'shell caiu');
  assert.strictEqual(chamadas.length, 2);
});

test('delete-file apaga o arquivo e devolve true, com ou sem arquivo; se não consegue apagar devolve false e avisa no console', async () => {
  const main = carregarMain();
  const arquivo = textoDe(main)('apagar.txt', 'x');
  assert.strictEqual(await main.invocar('delete-file', arquivo), true);
  assert.ok(!fs.existsSync(arquivo));
  assert.strictEqual(await main.invocar('delete-file', arquivo), true);
  const pasta = path.join(main.raiz, 'pasta-no-lugar');
  fs.mkdirSync(pasta);
  const { resultado, chamadas } = await anotandoConsole(() => chamarDireto(main, 'delete-file', pasta));
  assert.strictEqual(resultado, false);
  assert.strictEqual(chamadas.length, 1);
  assert.deepStrictEqual(chamadas[0].slice(0, 2), ['error', 'Error deleting file:']);
  assert.ok(chamadas[0][2] instanceof Error);
  assert.ok(fs.existsSync(pasta));
});

test('save-file pergunta onde salvar sobre a janela focada, copia o vídeo e devolve true; cancelado devolve false; erro devolve false', async () => {
  const { main, dialog } = carregarComDialogo([]);
  const origem = textoDe(main)('video.mp4', 'conteudo do video');
  const destino = path.join(main.raiz, 'salvos', 'copia.mp4');
  fs.mkdirSync(path.dirname(destino));
  const focada = { nome: 'focada' };
  main.focar(focada);
  dialog.showSaveDialog = (...argumentos) => { dialog.pedidos.push(['salvar', ...argumentos]); return { filePath: destino }; };
  assert.strictEqual(await main.invocar('save-file', origem, 'nome.mp4'), true);
  assert.strictEqual(fs.readFileSync(destino, 'utf8'), 'conteudo do video');
  assert.deepStrictEqual(dialog.pedidos, [['salvar', focada, { title: 'Salvar Vídeo', defaultPath: 'nome.mp4', filters: [{ name: 'Videos', extensions: ['mp4'] }] }]]);

  dialog.showSaveDialog = () => ({ canceled: true });
  fs.rmSync(destino);
  assert.strictEqual(await main.invocar('save-file', origem, 'nome.mp4'), false);
  assert.ok(!fs.existsSync(destino));

  dialog.showSaveDialog = () => ({ filePath: destino });
  const { resultado, chamadas } = await anotandoConsole(() => chamarDireto(main, 'save-file', path.join(main.raiz, 'nao-existe.mp4'), 'x.mp4'));
  assert.strictEqual(resultado, false);
  assert.deepStrictEqual(chamadas[0].slice(0, 2), ['error', 'Failed to save file:']);
  assert.strictEqual(chamadas[0][2].code, 'ENOENT');
  assert.strictEqual(chamadas.length, 1);
});

function subprocessoFalso() {
  const processo = new EventEmitter();
  processo.unref = () => {};
  setImmediate(() => { processo.emit('spawn'); processo.emit('close', 0); });
  return processo;
}

test('system-open entrega o alvo ao pacote open e devolve true', async () => {
  const main = carregarMain();
  const chamadas = [];
  const spawnOriginal = childProcess.spawn;
  childProcess.spawn = (...argumentos) => { chamadas.push(argumentos); return subprocessoFalso(); };
  try {
    assert.strictEqual(await main.invocar('system-open', { target: 'https://exemplo.com/pagina' }), true);
  } finally {
    childProcess.spawn = spawnOriginal;
  }
  assert.strictEqual(chamadas.length, 1);
  const argumentos = chamadas[0][1];
  const posicao = argumentos.indexOf('-EncodedCommand');
  const texto = posicao >= 0 ? Buffer.from(argumentos[posicao + 1], 'base64').toString('utf16le') : JSON.stringify(chamadas[0]);
  assert.ok(texto.includes('https://exemplo.com/pagina'), texto);
});

test('save-image grava o PNG em Downloads com a hora no nome, aceita o prefixo data URL e devolve o caminho', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: AGORA });
  const main = carregarMain();
  const esperado = path.join(main.pasta('downloads'), `NOVA_Generated_${AGORA}.png`);
  const bytes = Buffer.from('imagem de mentira');
  assert.strictEqual(await main.invocar('save-image', { base64Data: `data:image/png;base64,${bytes.toString('base64')}` }), esperado);
  assert.deepStrictEqual(fs.readFileSync(esperado), bytes);
  fs.rmSync(esperado);
  assert.strictEqual(await main.invocar('save-image', { base64Data: bytes.toString('base64') }), esperado);
  assert.deepStrictEqual(fs.readFileSync(esperado), bytes);
  await assert.rejects(main.invocar('save-image', {}), TypeError);
});

function carregarLeitor(extras = {}) {
  const leituras = { pdf: [], docx: [] };
  const PDFParse = async (buffer) => { leituras.pdf.push(buffer.toString()); if (extras.pdfFalha) throw new Error(extras.pdfFalha); return { text: extras.pdfTexto }; };
  const mammoth = { extractRawText: async ({ buffer }) => { leituras.docx.push(buffer.toString()); return { value: extras.docxTexto }; } };
  const main = carregarMain({ modulos: { 'mime-types': MIME_REAL, 'pdf-parse': { PDFParse }, mammoth } });
  return { main, leituras };
}

const LEITURAS_DE_TEXTO = [
  ['nota.txt', 'texto simples'],
  ['dados.json', '{"a":1}'],
  ['leia.md', '# titulo'],
  ['codigo.js', 'const a = 1;'],
  ['tipos.ts', 'let a: number'],
  ['estilo.css', 'a{}'],
  ['pagina.html', '<p>oi</p>'],
  ['planilha.csv', 'a,b'],
  ['MAIUSCULA.TXT', 'extensão em caixa alta'],
];

test('read-file-content lê como texto os tipos de texto, o JSON, o JavaScript e as extensões de código', async () => {
  const { main } = carregarLeitor();
  for (const [nome, conteudo] of LEITURAS_DE_TEXTO) {
    const arquivo = textoDe(main)(nome, conteudo);
    const { resultado, chamadas } = await anotandoConsole(() => chamarDireto(main, 'read-file-content', { path: arquivo }));
    assert.deepStrictEqual(resultado, { content: conteudo }, nome);
    assert.deepStrictEqual(chamadas.map(([nivel, texto]) => [nivel, texto]).slice(-1), [['log', '[File-Reader] Reading as Text...']], nome);
  }
});

test('read-file-content: os logs de cada leitura dizem arquivo, tipo, tamanho e o que foi feito', async () => {
  const { main } = carregarLeitor({ pdfTexto: 'abc' });
  const arquivo = textoDe(main)('dados.json', '{"a":1}');
  const { chamadas } = await anotandoConsole(() => chamarDireto(main, 'read-file-content', { path: arquivo }));
  assert.deepStrictEqual(chamadas, [
    ['log', `[File-Reader] Reading file: ${arquivo}`],
    ['log', '[File-Reader] Detected Mime: application/json, Ext: .json, Size: 7 bytes'],
    ['log', '[File-Reader] Reading as Text...'],
  ]);
});

test('read-file-content: PDF (pelo tipo ou pela extensão) passa o conteúdo ao leitor de PDF e devolve o texto', async () => {
  const { main, leituras } = carregarLeitor({ pdfTexto: 'texto do pdf' });
  const arquivo = textoDe(main)('livro.pdf', 'bytes do pdf');
  const { resultado, chamadas } = await anotandoConsole(() => chamarDireto(main, 'read-file-content', { path: arquivo }));
  assert.deepStrictEqual(resultado, { content: 'texto do pdf' });
  assert.deepStrictEqual(leituras.pdf, ['bytes do pdf']);
  assert.deepStrictEqual(chamadas.slice(2), [['log', '[File-Reader] Parsing PDF...'], ['log', '[File-Reader] PDF Parsed. Content length: 12']]);
  const semTexto = carregarLeitor({ pdfTexto: undefined });
  const vazio = textoDe(semTexto.main)('vazio.pdf', 'x');
  const lido = await anotandoConsole(() => chamarDireto(semTexto.main, 'read-file-content', { path: vazio }));
  assert.deepStrictEqual(lido.resultado, { content: undefined });
  assert.deepStrictEqual(lido.chamadas[3], ['log', '[File-Reader] PDF Parsed. Content length: 0']);
});

test('read-file-content: DOCX passa o conteúdo ao mammoth e devolve o texto', async () => {
  const { main, leituras } = carregarLeitor({ docxTexto: 'texto do docx' });
  const arquivo = textoDe(main)('carta.docx', 'bytes do docx');
  const { resultado, chamadas } = await anotandoConsole(() => chamarDireto(main, 'read-file-content', { path: arquivo }));
  assert.deepStrictEqual(resultado, { content: 'texto do docx' });
  assert.deepStrictEqual(leituras.docx, ['bytes do docx']);
  assert.deepStrictEqual(chamadas.slice(1), [
    ['log', `[File-Reader] Detected Mime: ${TIPO_DO_DOCX}, Ext: .docx, Size: 13 bytes`],
    ['log', '[File-Reader] Parsing Docx...'],
    ['log', '[File-Reader] Docx Parsed. Content length: 13'],
  ]);
});

test('read-file-content: imagem e outros tipos conhecidos viram o aviso de binário; arquivo que não existe e falha de leitura viram erro', async () => {
  const { main } = carregarLeitor({ pdfFalha: 'pdf quebrado' });
  const imagem = textoDe(main)('foto.png', 'png');
  const lido = await anotandoConsole(() => chamarDireto(main, 'read-file-content', { path: imagem }));
  assert.deepStrictEqual(lido.resultado, { content: '[Binary/Image File: foto.png]. The content of this file is visual or binary.' });
  assert.deepStrictEqual(lido.chamadas.slice(-1), [['warn', '[File-Reader] Unsupported file type: image/png']]);

  const faltando = path.join(main.raiz, 'entrada', 'nada.txt');
  const ausente = await anotandoConsole(() => chamarDireto(main, 'read-file-content', { path: faltando }));
  assert.deepStrictEqual(ausente.resultado, { error: 'File not found' });
  assert.deepStrictEqual(ausente.chamadas, [
    ['log', `[File-Reader] Reading file: ${faltando}`],
    ['error', `[File-Reader] File not found: ${faltando}`],
  ]);

  const pdf = textoDe(main)('quebrado.pdf', 'x');
  const quebrado = await anotandoConsole(() => chamarDireto(main, 'read-file-content', { path: pdf }));
  assert.deepStrictEqual(quebrado.resultado, { error: 'pdf quebrado' });
  assert.strictEqual(quebrado.chamadas.slice(-1)[0][1], '[File-Reader] CRITICAL ERROR:');
  assert.strictEqual(quebrado.chamadas.slice(-1)[0][2].message, 'pdf quebrado');
});

test('read-file-content: extensão que o tipo MIME não conhece cai no erro do tipo, e sem o argumento também erra', async () => {
  const { main } = carregarLeitor();
  const desconhecido = textoDe(main)('arquivo.xyzzy', 'x');
  const { resultado } = await anotandoConsole(() => chamarDireto(main, 'read-file-content', { path: desconhecido }));
  assert.deepStrictEqual(resultado, { error: 'mimeType.startsWith is not a function' });
  await assert.rejects(main.invocar('read-file-content'), TypeError);
  const pasta = path.join(main.raiz, 'entrada');
  const daPasta = await anotandoConsole(() => chamarDireto(main, 'read-file-content', { path: pasta }));
  assert.strictEqual(typeof daPasta.resultado.error, 'string');
});

test('pick-and-read-files devolve [] se cancelou e, se escolheu, nome, base64, tipo e caminho de cada arquivo, pulando os de mais de 50 MB', async () => {
  const { main, dialog } = carregarComDialogo([]);
  const texto = textoDe(main)('a.txt', 'um');
  const pdf = textoDe(main)('b.pdf', 'dois');
  const semTipo = textoDe(main)('c.zzz', 'tres');
  const grande = textoDe(main)('grande.pdf', '');
  fs.truncateSync(grande, LIMITE_DO_ANEXO + 1);
  const noLimite = textoDe(main)('limite.txt', '');
  fs.truncateSync(noLimite, LIMITE_DO_ANEXO);
  dialog.showOpenDialog = (...argumentos) => { dialog.pedidos.push(['abrir', ...argumentos]); return dialog.proxima; };
  dialog.proxima = cancelou;
  assert.deepStrictEqual(await main.invocar('pick-and-read-files'), []);
  dialog.proxima = escolheu(texto, grande, pdf, semTipo, noLimite);
  const lidos = await main.invocar('pick-and-read-files');
  assert.deepStrictEqual(lidos.map(({ data, ...resto }) => resto), [
    { name: 'a.txt', mimeType: 'text/plain', path: texto },
    { name: 'b.pdf', mimeType: 'application/pdf', path: pdf },
    { name: 'c.zzz', mimeType: 'application/octet-stream', path: semTipo },
    { name: 'limite.txt', mimeType: 'text/plain', path: noLimite },
  ]);
  assert.deepStrictEqual(lidos.slice(0, 3).map(({ data }) => Buffer.from(data, 'base64').toString()), ['um', 'dois', 'tres']);
  assert.strictEqual(Buffer.from(lidos[3].data, 'base64').length, LIMITE_DO_ANEXO);
  const filtros = [{ name: 'Multimodal Files', extensions: ['jpg', 'png', 'jpeg', 'webp', 'pdf', 'doc', 'docx', 'txt', 'mp3', 'wav', 'mpeg'] }];
  assert.deepStrictEqual(dialog.pedidos[0], ['abrir', { properties: ['openFile', 'multiSelections'], filters: filtros }]);
  dialog.proxima = escolheu(path.join(main.raiz, 'nao-existe.txt'));
  await assert.rejects(main.invocar('pick-and-read-files'), { code: 'ENOENT' });
});

async function mensagensDoFsOp(main, pedido) {
  return anotandoConsole(() => chamarDireto(main, 'system-fs-op', pedido));
}

test('system-fs-op: o que diz no console ao corrigir a variável literal e ao resolver caminho relativo', async () => {
  const main = carregarMain();
  const documentos = main.pasta('documents');
  const novaData = path.join(documentos, 'Nova Data');
  const literal = await mensagensDoFsOp(main, { operation: 'exists', path: '${resolvedNotesPath}/x.txt' });
  assert.deepStrictEqual(literal.chamadas, [
    ['warn', '[FS-OP] WARNING: AI used literal template variable "${resolvedNotesPath}/x.txt". Fixing...'],
    ['log', `[FS-OP] Fixed literal variable: \${resolvedNotesPath}/x.txt → ${path.join(novaData, 'x.txt')}`],
  ]);
  const sozinho = await mensagensDoFsOp(main, { operation: 'exists', path: '$resolvedNotesPath' });
  assert.deepStrictEqual(sozinho.chamadas[1], ['log', `[FS-OP] Fixed literal variable: $resolvedNotesPath → ${novaData}`]);
  const relativo = await mensagensDoFsOp(main, { operation: 'exists', path: 'a/b.txt' });
  assert.deepStrictEqual(relativo.chamadas, [['log', `[FS-OP] Resolved relative path: a/b.txt → ${path.join(novaData, 'a', 'b.txt')}`]]);
  const absoluto = await mensagensDoFsOp(main, { operation: 'exists', path: path.join(main.raiz, 'abs') });
  assert.deepStrictEqual(absoluto.chamadas, []);
});

test('system-fs-op: o destino aceita os mesmos prefixos do caminho, avisa só da variável literal e não comenta o relativo', async () => {
  const main = carregarMain();
  const documentos = main.pasta('documents');
  const novaData = path.join(documentos, 'Nova Data');
  gravar(path.join(novaData, 'origem.txt'), 'o');
  const destinos = [
    ['rel/c.txt', path.join(novaData, 'rel', 'c.txt')],
    ['Documents\\d.txt', path.join(documentos, 'd.txt')],
    ['Documents/e.txt', path.join(documentos, 'e.txt')],
    ['Nova Data\\f.txt', path.join(documentos, 'Nova Data\\f.txt')],
    ['Nova Data/g.txt', path.join(novaData, 'g.txt')],
    ['$resolvedNotesPath\\h.txt', path.join(novaData, 'h.txt')],
    ['${resolvedNotesPath}', novaData],
    [path.join(main.raiz, 'fora', 'i.txt'), path.join(main.raiz, 'fora', 'i.txt')],
  ];
  fs.mkdirSync(path.join(novaData, 'rel'), { recursive: true });
  fs.mkdirSync(path.join(main.raiz, 'fora'), { recursive: true });
  for (const [pedido, destino] of destinos.slice(0, 5).concat([destinos[5], destinos[7]])) {
    const { resultado, chamadas } = await mensagensDoFsOp(main, { operation: 'copy-file', path: 'origem.txt', dest: pedido });
    assert.strictEqual(resultado, true, pedido);
    assert.strictEqual(fs.readFileSync(destino, 'utf8'), 'o', pedido);
    const avisos = chamadas.filter(([nivel]) => nivel === 'warn');
    const esperadosAvisos = pedido.includes('resolvedNotesPath') ? [['warn', `[FS-OP] WARNING: AI used literal template variable in dest "${pedido}". Fixing...`]] : [];
    assert.deepStrictEqual(avisos, esperadosAvisos, pedido);
  }
  const literal = await mensagensDoFsOp(main, { operation: 'copy-file', path: 'origem.txt', dest: 'Nova Data/j.txt' });
  assert.deepStrictEqual(literal.chamadas.map(([nivel, texto]) => [nivel, texto.split(' → ')[0]]), [['log', '[FS-OP] Resolved relative path: origem.txt']]);
  const copiaParaPasta = await mensagensDoFsOp(main, { operation: 'exists', path: 'origem.txt', dest: '${resolvedNotesPath}' });
  assert.deepStrictEqual(copiaParaPasta.chamadas[2], ['log', `[FS-OP] Fixed literal variable in dest: \${resolvedNotesPath} → ${novaData}`]);
});

test('system-fs-op: operação desconhecida (inclusive nomes que o JavaScript já tem), sem caminho e sem argumento', async () => {
  const main = carregarMain();
  for (const operation of ['constructor', 'toString', '__proto__', 'READ-FILE', undefined, '']) {
    assert.strictEqual(await main.invocar('system-fs-op', { operation, path: 'x' }), undefined, String(operation));
  }
  await assert.rejects(main.invocar('system-fs-op', { operation: 'read-dir' }), TypeError);
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'exists' }), false);
  await assert.rejects(main.invocar('system-fs-op', { operation: 'rename', path: 'a' }), TypeError);
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'qualquer' }), undefined);
  await assert.rejects(main.invocar('system-fs-op'), TypeError);
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'qualquer', path: '' }), undefined);
});

test('system-fs-op: write-file cria as pastas que faltam e grava texto vazio sem conteúdo; read-dir devolve a lista inteira até 50', async () => {
  const main = carregarMain();
  const novaData = path.join(main.pasta('documents'), 'Nova Data');
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'write-file', path: 'a/b/c.txt', content: 'oi' }), true);
  assert.strictEqual(fs.readFileSync(path.join(novaData, 'a', 'b', 'c.txt'), 'utf8'), 'oi');
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'write-file', path: 'a/b/c.txt', content: 0 }), true);
  assert.strictEqual(fs.readFileSync(path.join(novaData, 'a', 'b', 'c.txt'), 'utf8'), '');
  assert.deepStrictEqual(await main.invocar('system-fs-op', { operation: 'read-dir', path: 'a/b' }), ['c.txt']);
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'delete', path: 'a/b/c.txt' }), true);
  assert.deepStrictEqual(await main.invocar('system-fs-op', { operation: 'read-dir', path: 'a/b' }), []);
  const muitos = path.join(novaData, 'muitos');
  for (let n = 0; n < 52; n++) gravar(path.join(muitos, `arquivo-${String(n).padStart(2, '0')}.txt`), 'x');
  const lista = await main.invocar('system-fs-op', { operation: 'read-dir', path: 'muitos' });
  assert.strictEqual(lista.length, 51);
  assert.strictEqual(lista[49], 'arquivo-49.txt');
  assert.strictEqual(lista[50], '... and 2 more items (Truncated for stability)');
  gravar(path.join(novaData, 'cinquenta', 'a.txt'), 'x');
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'create-dir', path: 'cinquenta/nova/funda' }), true);
  assert.strictEqual(fs.statSync(path.join(novaData, 'cinquenta', 'nova', 'funda')).isDirectory(), true);
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'create-dir', path: 'cinquenta/nova/funda' }), true);
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'read-file', path: 'cinquenta/a.txt' }), 'x');
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'rename', path: 'cinquenta/a.txt', dest: 'cinquenta/b.txt' }), true);
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'exists', path: 'cinquenta/a.txt' }), false);
  await assert.rejects(main.invocar('system-fs-op', { operation: 'copy-file', path: 'a/nao-existe.txt', dest: 'z.txt' }), { code: 'ENOENT' });
  await assert.rejects(main.invocar('system-fs-op', { operation: 'rename', path: 'a/nao-existe.txt', dest: 'z.txt' }), { code: 'ENOENT' });
  await assert.rejects(main.invocar('system-fs-op', { operation: 'read-dir', path: 'a/nao-existe' }), { code: 'ENOENT' });
});
