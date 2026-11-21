'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { carregarMain } = require('./ajuda/carregar-main');

function nucleo(user, sys, idle) {
  return { times: { user, nice: 0, sys, idle, irq: 0 } };
}

function osFalso(leituras, memoria = { total: 1000, livre: 250 }) {
  const fila = leituras.slice();
  return {
    ...os,
    cpus: () => {
      const proxima = fila.length > 1 ? fila.shift() : fila[0];
      if (proxima instanceof Error) throw proxima;
      return proxima;
    },
    totalmem: () => memoria.total,
    freemem: () => memoria.livre,
  };
}

function imagemFalsa(largura, altura, nome, registro) {
  return {
    getSize: () => ({ width: largura, height: altura }),
    toDataURL: () => `data:${nome}`,
    toPNG: () => Buffer.from(`png:${nome}`),
    resize: (opcoes) => {
      registro.push(opcoes);
      return imagemFalsa(opcoes.width, opcoes.height, `${nome}-reduzida`, registro);
    },
  };
}

test('window-minimize e window-restore agem na janela principal so se ela existe', async () => {
  const main = carregarMain();
  const janela = main.janelaPrincipal;
  janela.chamadas.length = 0;
  assert.strictEqual(await main.invocar('window-minimize'), undefined);
  assert.strictEqual(await main.invocar('window-restore'), undefined);
  assert.deepStrictEqual(janela.chamadas, [['minimize'], ['restore'], ['focus']]);
  janela.destruida = true;
  janela.chamadas.length = 0;
  await main.invocar('window-minimize');
  await main.invocar('window-restore');
  assert.deepStrictEqual(janela.chamadas, []);
});

test('window-control: sem janela focada, cada acao, alternancias, acao desconhecida e erro', async () => {
  const main = carregarMain();
  assert.deepStrictEqual(await main.invocar('window-control', { action: 'minimize' }), { error: 'No focused window' });
  const janela = main.janelaPrincipal;
  main.focar(janela);
  janela.chamadas.length = 0;
  const acoes = ['minimize', 'maximize', 'close', 'fullscreen', 'desconhecida'];
  for (const action of acoes) assert.deepStrictEqual(await main.invocar('window-control', { action }), { success: true });
  janela.maximizada = true;
  janela.telaCheia = true;
  await main.invocar('window-control', { action: 'maximize' });
  await main.invocar('window-control', { action: 'fullscreen' });
  assert.deepStrictEqual(janela.chamadas, [['minimize'], ['maximize'], ['close'], ['setFullScreen', true], ['unmaximize'], ['setFullScreen', false]]);
  janela.isMaximized = () => { throw new Error('janela sumiu'); };
  assert.deepStrictEqual(await main.invocar('window-control', { action: 'maximize' }), { error: 'janela sumiu' });
});

test('trigger-system-log manda swarm:log da nova com hora, so com a janela viva', () => {
  const main = carregarMain();
  const janela = main.janelaPrincipal;
  main.emitir('trigger-system-log', { text: 'tarefa concluida' });
  assert.strictEqual(janela.enviados.length, 1);
  const [canal, dados] = janela.enviados[0];
  assert.strictEqual(canal, 'swarm:log');
  assert.strictEqual(dados.agent, 'nova');
  assert.match(dados.text, /^\[\d{1,2}\D\d{2}\D\d{2}\] \[NOVA\] → tarefa concluida$/);
  janela.destruida = true;
  main.emitir('trigger-system-log', { text: 'de novo' });
  assert.strictEqual(janela.enviados.length, 1);
});

test('get-realtime-system-metrics: cpu pela diferenca entre leituras, memoria, gpu e temperatura derivadas', async () => {
  const antes = [nucleo(100, 100, 800), nucleo(100, 100, 800)];
  const depois = [nucleo(300, 200, 1500), nucleo(300, 200, 1500)];
  const main = carregarMain({ modulos: { os: osFalso([antes, depois]) } });
  assert.deepStrictEqual(await main.invocar('get-realtime-system-metrics'), { cpu: 30, mem: 75, gpu: 22, temperature: 47.8, online: true });
  assert.deepStrictEqual(await main.invocar('get-realtime-system-metrics'), { cpu: 8, mem: 75, gpu: 12, temperature: 41, online: true });
});

test('get-realtime-system-metrics: pisos de cpu 2 e memoria 5, teto 100, e valores fixos no erro', async () => {
  const memoria = { total: 1000, livre: 999 };
  const ocioso = osFalso([[nucleo(0, 0, 0)], [nucleo(0, 0, 1000)], [nucleo(1000, 0, 1000)], new Error('sem cpus')], memoria);
  const main = carregarMain({ modulos: { os: ocioso } });
  assert.deepStrictEqual(await main.invocar('get-realtime-system-metrics'), { cpu: 2, mem: 5, gpu: 9, temperature: 39.1, online: true });
  memoria.livre = -500;
  assert.deepStrictEqual(await main.invocar('get-realtime-system-metrics'), { cpu: 100, mem: 100, gpu: 53, temperature: 69.5, online: true });
  assert.deepStrictEqual(await main.invocar('get-realtime-system-metrics'), { error: 'sem cpus', cpu: 12, mem: 45, gpu: 10, temperature: 42.0, online: true });
});

test('get-detailed-system-info junta as 6 leituras do systeminformation e devolve o erro', async () => {
  const si = { cpu: async () => 'c', mem: async () => 'm', graphics: async () => 'g', osInfo: async () => 'o', networkInterfaces: async () => 'n', battery: async () => 'b' };
  const main = carregarMain({ modulos: { systeminformation: si } });
  assert.deepStrictEqual(await main.invocar('get-detailed-system-info'), { cpu: 'c', mem: 'm', graphics: 'g', os: 'o', network: 'n', battery: 'b' });
  si.battery = async () => { throw new Error('sem bateria'); };
  assert.deepStrictEqual(await main.invocar('get-detailed-system-info'), { error: 'sem bateria' });
});

test('get-processes: os 20 de maior cpu, em ordem, so nome, pid, cpu e mem', async () => {
  const lista = Array.from({ length: 25 }, (_, i) => ({ name: `p${i}`, pid: 1000 + i, cpu: (i * 7) % 25, mem: i, user: 'x' }));
  const si = { processes: async () => ({ list: lista }) };
  const main = carregarMain({ modulos: { systeminformation: si } });
  const resultado = await main.invocar('get-processes');
  const esperado = lista.slice().sort((a, b) => b.cpu - a.cpu).slice(0, 20).map(p => ({ name: p.name, pid: p.pid, cpu: p.cpu, mem: p.mem }));
  assert.deepStrictEqual(resultado, esperado);
  assert.deepStrictEqual(resultado.slice(0, 3).map(p => p.cpu), [24, 23, 22]);
  si.processes = async () => { throw new Error('sem lista'); };
  assert.deepStrictEqual(await main.invocar('get-processes'), { error: 'sem lista' });
});

test('kill-process manda o sinal padrao ao pid e devolve o erro', async () => {
  const main = carregarMain();
  const original = process.kill;
  const pedidos = [];
  process.kill = (...args) => {
    pedidos.push(args);
    if (args[0] === 2) throw new Error('ESRCH');
  };
  try {
    assert.deepStrictEqual(await main.invocar('kill-process', { pid: 1 }), { success: true });
    assert.deepStrictEqual(await main.invocar('kill-process', { pid: 2 }), { error: 'ESRCH' });
  } finally {
    process.kill = original;
  }
  assert.deepStrictEqual(pedidos, [[1], [2]]);
});

test('system-fs-op: caminho relativo vai para Documentos/Nova Data e os prefixos Documents e Nova Data', async () => {
  const main = carregarMain();
  const documentos = main.pasta('documents');
  const novaData = path.join(documentos, 'Nova Data');
  const casos = [
    ['notas/a.txt', path.join(novaData, 'notas', 'a.txt')],
    ['Documents/b.txt', path.join(documentos, 'b.txt')],
    ['Documents\\c.txt', path.join(documentos, 'c.txt')],
    ['Nova Data/d.txt', path.join(novaData, 'd.txt')],
    ['${resolvedNotesPath}/e.txt', path.join(novaData, 'e.txt')],
    ['$resolvedNotesPath\\f.txt', path.join(novaData, 'f.txt')],
    [path.join(main.raiz, 'fora', 'g.txt'), path.join(main.raiz, 'fora', 'g.txt')],
  ];
  for (const [pedido, destino] of casos) {
    assert.strictEqual(await main.invocar('system-fs-op', { operation: 'write-file', path: pedido, content: pedido }), true, pedido);
    assert.strictEqual(fs.readFileSync(destino, 'utf8'), pedido, pedido);
    assert.strictEqual(await main.invocar('system-fs-op', { operation: 'read-file', path: pedido }), pedido);
    assert.strictEqual(await main.invocar('system-fs-op', { operation: 'exists', path: pedido }), true);
  }
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'write-file', path: 'vazio.txt' }), true);
  assert.strictEqual(fs.readFileSync(path.join(novaData, 'vazio.txt'), 'utf8'), '');
  const raizDaNovaData = (await main.invocar('system-fs-op', { operation: 'read-dir', path: '${resolvedNotesPath}' })).sort();
  assert.deepStrictEqual(raizDaNovaData, ['d.txt', 'e.txt', 'f.txt', 'notas', 'vazio.txt']);
  assert.deepStrictEqual(await main.invocar('system-fs-op', { operation: 'read-dir', path: '$resolvedNotesPath' }), await main.invocar('system-fs-op', { operation: 'read-dir', path: '${resolvedNotesPath}' }));
});

test('system-fs-op: read-dir corta em 50, create-dir, rename, copy-file com dest relativo, delete, desconhecida e erro', async () => {
  const main = carregarMain();
  const novaData = path.join(main.pasta('documents'), 'Nova Data');
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'create-dir', path: 'muitos/sub' }), true);
  assert.ok(fs.statSync(path.join(novaData, 'muitos', 'sub')).isDirectory());
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'create-dir', path: 'muitos/sub' }), true);
  const encher = (pasta, quantos) => {
    fs.mkdirSync(path.join(novaData, pasta), { recursive: true });
    for (let i = 0; i < quantos; i++) fs.writeFileSync(path.join(novaData, pasta, `f${i}.txt`), '');
    return main.invocar('system-fs-op', { operation: 'read-dir', path: pasta });
  };
  const cinquenta = await encher('cinquenta', 50);
  assert.strictEqual(cinquenta.length, 50);
  assert.ok(cinquenta.every(nome => nome.endsWith('.txt')));
  const cinquentaEUm = await encher('cinquenta-e-um', 51);
  assert.strictEqual(cinquentaEUm.length, 51);
  assert.strictEqual(cinquentaEUm[50], '... and 1 more items (Truncated for stability)');
  for (let i = 0; i < 52; i++) fs.writeFileSync(path.join(novaData, 'muitos', `f${i}.txt`), '');
  const lista = await main.invocar('system-fs-op', { operation: 'read-dir', path: 'muitos' });
  assert.strictEqual(lista.length, 51);
  assert.strictEqual(lista[50], '... and 3 more items (Truncated for stability)');
  assert.strictEqual(new Set(lista.slice(0, 50)).size, 50);

  fs.writeFileSync(path.join(novaData, 'origem.txt'), 'conteudo');
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'copy-file', path: 'origem.txt', dest: '${resolvedNotesPath}/copia.txt' }), true);
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'copy-file', path: 'origem.txt', dest: 'Documents/copia2.txt' }), true);
  assert.strictEqual(fs.readFileSync(path.join(novaData, 'copia.txt'), 'utf8'), 'conteudo');
  assert.strictEqual(fs.readFileSync(path.join(main.pasta('documents'), 'copia2.txt'), 'utf8'), 'conteudo');
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'rename', path: 'origem.txt', dest: 'Nova Data/movido.txt' }), true);
  assert.strictEqual(fs.existsSync(path.join(novaData, 'origem.txt')), false);
  assert.strictEqual(fs.readFileSync(path.join(novaData, 'movido.txt'), 'utf8'), 'conteudo');
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'rename', path: 'movido.txt', dest: 'pasta-nova.txt' }), true);
  assert.ok(fs.existsSync(path.join(novaData, 'pasta-nova.txt')));

  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'delete', path: 'muitos' }), true);
  assert.strictEqual(fs.existsSync(path.join(novaData, 'muitos')), false);
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'delete', path: 'nao-existe' }), true);
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'exists', path: 'nao-existe' }), false);
  assert.strictEqual(await main.invocar('system-fs-op', { operation: 'inventada', path: 'x' }), undefined);
  await assert.rejects(main.invocar('system-fs-op', { operation: 'read-file', path: 'nao-existe.txt' }), { code: 'ENOENT' });
});

test('open-external-url abre pelo shell do Electron e devolve o erro', async () => {
  const abertos = [];
  const shell = { openExternal: async (url) => { abertos.push(url); if (url === 'ruim') throw new Error('sem navegador'); } };
  const main = carregarMain({ electron: { shell } });
  assert.deepStrictEqual(await main.invocar('open-external-url', 'https://exemplo.com'), { success: true });
  assert.deepStrictEqual(await main.invocar('open-external-url', 'ruim'), { success: false, error: 'sem navegador' });
  assert.deepStrictEqual(abertos, ['https://exemplo.com', 'ruim']);
});

test('take-screenshot: primeira tela no tamanho do monitor, reduz para 1024 de largura e devolve PNG em base64', async () => {
  const reducoes = [];
  const pedidos = [];
  let fontes = [{ thumbnail: imagemFalsa(2560, 1441, 'tela1', reducoes) }, { thumbnail: imagemFalsa(800, 600, 'tela2', reducoes) }];
  const desktopCapturer = { getSources: async (opcoes) => { pedidos.push(opcoes); return fontes; } };
  const screen = { getPrimaryDisplay: () => ({ size: { width: 2560, height: 1441 } }) };
  const main = carregarMain({ electron: { desktopCapturer, screen } });
  assert.deepStrictEqual(await main.invocar('take-screenshot'), { success: true, data: Buffer.from('png:tela1-reduzida').toString('base64'), mimeType: 'image/png' });
  assert.deepStrictEqual(pedidos, [{ types: ['screen'], thumbnailSize: { width: 2560, height: 1441 } }]);
  assert.deepStrictEqual(reducoes, [{ width: 1024, height: 576, quality: 'better' }]);
  fontes = [{ thumbnail: imagemFalsa(1024, 768, 'pequena', reducoes) }];
  assert.deepStrictEqual(await main.invocar('take-screenshot'), { success: true, data: Buffer.from('png:pequena').toString('base64'), mimeType: 'image/png' });
  assert.strictEqual(reducoes.length, 1);
  fontes = [];
  assert.deepStrictEqual(await main.invocar('take-screenshot'), { success: false, error: 'No screen sources found' });
  fontes = null;
  assert.deepStrictEqual(await main.invocar('take-screenshot'), { success: false, error: 'No screen sources found' });
  desktopCapturer.getSources = async () => { throw new Error('sem permissao'); };
  assert.deepStrictEqual(await main.invocar('take-screenshot'), { success: false, error: 'sem permissao' });
});

test('get-screen-sources: so telas, miniatura 320x180, e o tamanho e display_id de cada uma', async () => {
  const pedidos = [];
  const desktopCapturer = {
    getSources: async (opcoes) => {
      pedidos.push(opcoes);
      return [
        { id: 'screen:1', name: 'Tela 1', display_id: '77', thumbnail: imagemFalsa(320, 180, 'a', []) },
        { id: 'screen:2', name: 'Tela 2', thumbnail: imagemFalsa(300, 169, 'b', []) },
      ];
    },
  };
  const main = carregarMain({ electron: { desktopCapturer } });
  assert.deepStrictEqual(await main.invocar('get-screen-sources'), [
    { id: 'screen:1', name: 'Tela 1', thumbnail: 'data:a', width: 320, height: 180, display_id: '77' },
    { id: 'screen:2', name: 'Tela 2', thumbnail: 'data:b', width: 300, height: 169, display_id: '' },
  ]);
  assert.deepStrictEqual(pedidos, [{ types: ['screen'], thumbnailSize: { width: 320, height: 180 } }]);
  desktopCapturer.getSources = async () => { throw new Error('negado'); };
  assert.deepStrictEqual(await main.invocar('get-screen-sources'), { error: 'negado' });
});

test('send-notification: titulo Nova AI e corpo vazio por padrao, mostra e devolve o erro', async () => {
  const criadas = [];
  class Notification {
    constructor(opcoes) { this.opcoes = opcoes; this.mostrada = false; criadas.push(this); }
    show() { if (this.opcoes.title === 'quebra') throw new Error('sem permissao'); this.mostrada = true; }
  }
  const main = carregarMain({ electron: { Notification } });
  assert.deepStrictEqual(await main.invocar('send-notification', {}), { success: true });
  assert.deepStrictEqual(await main.invocar('send-notification', { title: 'Oi', body: 'Corpo', icon: 'i.png' }), { success: true });
  assert.deepStrictEqual(await main.invocar('send-notification', { title: 'quebra' }), { error: 'sem permissao' });
  assert.deepStrictEqual(criadas.map(n => [n.opcoes, n.mostrada]), [
    [{ title: 'Nova AI', body: '', icon: undefined }, true],
    [{ title: 'Oi', body: 'Corpo', icon: 'i.png' }, true],
    [{ title: 'quebra', body: '', icon: undefined }, false],
  ]);
});
