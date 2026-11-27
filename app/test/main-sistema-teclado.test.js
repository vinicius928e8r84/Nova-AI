'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { EventEmitter } = require('events');
const { carregarMain, comPlataforma } = require('./ajuda/carregar-main');

const SCRIPT_DA_PALAVRA = path.join(__dirname, '..', 'electron', '..', 'wake_word_bg.py');
const SEND_KEYS = 'Add-Type -AssemblyName System.Windows.Forms;';

function processoFalso() {
  const processo = new EventEmitter();
  processo.stdout = new EventEmitter();
  processo.stderr = new EventEmitter();
  processo.mortes = 0;
  processo.kill = () => { processo.mortes++; };
  return processo;
}

function spawnFalso(falhar = false) {
  const criados = [];
  return {
    criados,
    spawn: (comando, argumentos, opcoes) => {
      if (falhar) throw new Error('spawn recusado');
      const processo = processoFalso();
      criados.push({ comando, argumentos, opcoes, processo });
      return processo;
    },
  };
}

function desligamentoFalso(estado) {
  return {
    registerShutdown: () => () => estado.desligando,
    createWindowsProcessCleanup: () => ({}),
    createProcessCleanup: () => ({}),
  };
}

function carregarComPalavra(opcoes = {}) {
  const spawns = spawnFalso(opcoes.falhar);
  const estado = { desligando: false };
  const main = carregarMain({
    modulos: {
      child_process: { spawn: spawns.spawn, exec: () => { throw new Error('exec nao esperado'); } },
      './services/nova-shutdown': desligamentoFalso(estado),
    },
  });
  return { main, spawns, estado };
}

function comFumaca(valor, funcao) {
  const antes = process.env.NOVA_SMOKE_TEST;
  process.env.NOVA_SMOKE_TEST = valor;
  const restaurar = () => { if (antes === undefined) delete process.env.NOVA_SMOKE_TEST; else process.env.NOVA_SMOKE_TEST = antes; };
  return Promise.resolve().then(funcao).finally(restaurar);
}

test('wakeword:start sobe o Python uma vez só e wakeword:stop mata e libera para subir de novo', async () => {
  const { main, spawns } = carregarComPalavra();
  assert.deepStrictEqual(await main.invocar('wakeword:start'), { success: true });
  assert.deepStrictEqual(await main.invocar('wakeword:start'), { success: true });
  assert.strictEqual(spawns.criados.length, 1);
  assert.deepStrictEqual(
    { comando: spawns.criados[0].comando, argumentos: spawns.criados[0].argumentos, opcoes: spawns.criados[0].opcoes },
    { comando: 'python-teste', argumentos: [SCRIPT_DA_PALAVRA], opcoes: { windowsHide: true } },
  );
  assert.deepStrictEqual(await main.invocar('wakeword:stop'), { success: true });
  assert.strictEqual(spawns.criados[0].processo.mortes, 1);
  assert.deepStrictEqual(await main.invocar('wakeword:stop'), { success: true });
  assert.strictEqual(spawns.criados[0].processo.mortes, 1);
  await main.invocar('wakeword:start');
  assert.strictEqual(spawns.criados.length, 2);
});

test('wakeword: cada linha JSON da saída do Python vira wake-word-detected na janela', async () => {
  const { main, spawns } = carregarComPalavra();
  await main.invocar('wakeword:start');
  const { processo } = spawns.criados[0];
  processo.stdout.emit('data', Buffer.from('{"palavra":"nova"}\n\n  \n{"palavra":"oi","n":2}\n'));
  assert.deepStrictEqual(main.janelaPrincipal.enviados, [
    ['wake-word-detected', { palavra: 'nova' }],
    ['wake-word-detected', { palavra: 'oi', n: 2 }],
  ]);
  processo.stdout.emit('data', Buffer.from('lixo\n{"palavra":"ignorada"}\n'));
  processo.stderr.emit('data', Buffer.from('aviso do python'));
  assert.strictEqual(main.janelaPrincipal.enviados.length, 2);
});

test('wakeword: quando o processo fecha ou dá erro, o próximo start sobe outro', async () => {
  const { main, spawns } = carregarComPalavra();
  await main.invocar('wakeword:start');
  spawns.criados[0].processo.emit('close', 0);
  await main.invocar('wakeword:start');
  assert.strictEqual(spawns.criados.length, 2);
  spawns.criados[1].processo.emit('error', new Error('sem python'));
  await main.invocar('wakeword:start');
  assert.strictEqual(spawns.criados.length, 3);
  await main.invocar('wakeword:stop');
  assert.strictEqual(spawns.criados[2].processo.mortes, 1);
  assert.strictEqual(spawns.criados[1].processo.mortes, 0);
});

test('wakeword:start não sobe no teste de fumaça, durante o desligamento, e devolve o erro do spawn', async () => {
  const { main, spawns, estado } = await comPlataforma('win32', () => carregarComPalavra());
  await comFumaca('1', () => main.invocar('wakeword:start'));
  assert.strictEqual(spawns.criados.length, 0);
  estado.desligando = true;
  assert.deepStrictEqual(await main.invocar('wakeword:start'), { success: true });
  assert.strictEqual(spawns.criados.length, 0);
  estado.desligando = false;
  assert.deepStrictEqual(await main.invocar('wakeword:start'), { success: true });
  assert.strictEqual(spawns.criados.length, 1);

  const quebrado = carregarComPalavra({ falhar: true });
  assert.deepStrictEqual(await quebrado.main.invocar('wakeword:start'), { success: false, error: 'spawn recusado' });
});

function axiosFalso(resposta) {
  const pedidos = [];
  const chamar = async (configuracao) => {
    pedidos.push(configuracao);
    if (resposta instanceof Error) throw resposta;
    return resposta;
  };
  chamar.pedidos = pedidos;
  return chamar;
}

test('http-fetch: GET por padrão com 30 s de limite, e devolve status, dados e cabeçalhos', async () => {
  const axios = axiosFalso({ status: 200, data: { ok: 1 }, headers: { 'x-a': 'b' }, ignorado: true });
  const main = carregarMain({ modulos: { axios } });
  assert.deepStrictEqual(await main.invocar('http-fetch', { url: 'https://exemplo.test/a' }), {
    success: true, status: 200, data: { ok: 1 }, headers: { 'x-a': 'b' },
  });
  assert.deepStrictEqual(await main.invocar('http-fetch', { url: 'https://exemplo.test/b', method: 'POST', headers: { h: '1' }, body: 'corpo' }), {
    success: true, status: 200, data: { ok: 1 }, headers: { 'x-a': 'b' },
  });
  assert.deepStrictEqual(axios.pedidos, [
    { url: 'https://exemplo.test/a', method: 'GET', headers: {}, data: undefined, timeout: 30000 },
    { url: 'https://exemplo.test/b', method: 'POST', headers: { h: '1' }, data: 'corpo', timeout: 30000 },
  ]);
});

test('http-fetch: o erro vira { error, status, data } com os dados da resposta quando existem', async () => {
  const comResposta = Object.assign(new Error('Request failed'), { response: { status: 404, data: 'nada' } });
  const principal = carregarMain({ modulos: { axios: axiosFalso(comResposta) } });
  assert.deepStrictEqual(await principal.invocar('http-fetch', { url: 'x' }), { error: 'Request failed', status: 404, data: 'nada' });
  const semResposta = carregarMain({ modulos: { axios: axiosFalso(new Error('timeout of 30000ms exceeded')) } });
  assert.deepStrictEqual(await semResposta.invocar('http-fetch', { url: 'x' }), { error: 'timeout of 30000ms exceeded', status: undefined, data: undefined });
});

function execFalso(falharSe = () => null) {
  const pedidos = [];
  return {
    pedidos,
    modulo: {
      spawn: () => { throw new Error('spawn nao esperado'); },
      exec: (comando, ...resto) => {
        const aoTerminar = resto.pop();
        pedidos.push({ comando, opcoes: resto[0] });
        const erro = falharSe(comando);
        setImmediate(() => aoTerminar(erro, '', ''));
      },
    },
  };
}

function macNativeDeDigitar() {
  const chamadas = [];
  return {
    chamadas,
    typeText: async (text, pressEnter) => {
      chamadas.push([text, pressEnter]);
      if (text === 'quebra') throw new Error('sem acessibilidade');
      return { success: true, via: 'mac', text, pressEnter };
    },
  };
}

test('keyboard-type no Mac vai para o mac-native e não abre processo', async () => {
  const processos = execFalso();
  const macNative = macNativeDeDigitar();
  const main = carregarMain({ modulos: { child_process: processos.modulo, './services/mac-native': macNative } });
  await comPlataforma('darwin', async () => {
    assert.deepStrictEqual(await main.invocar('keyboard-type', { text: 'oi', pressEnter: true }), { success: true, via: 'mac', text: 'oi', pressEnter: true });
    assert.deepStrictEqual(await main.invocar('keyboard-type', { text: 'quebra' }), { success: false, error: 'sem acessibilidade' });
  });
  assert.deepStrictEqual(macNative.chamadas, [['oi', true], ['quebra', undefined]]);
  assert.deepStrictEqual(processos.pedidos, []);
});

test('keyboard-type fora do Mac: escapa os caracteres do SendKeys (as chaves saem escapadas duas vezes, como hoje) e, com pressEnter, espera 5 s antes do Enter', async () => {
  const processos = execFalso();
  const main = carregarMain({ modulos: { child_process: processos.modulo } });
  await comPlataforma('win32', async () => {
    assert.deepStrictEqual(await main.invocar('keyboard-type', { text: '+^%~()[]{}', pressEnter: false }), { success: true, typed: '+^%~()[]{}', enterPressed: false });
    assert.deepStrictEqual(await main.invocar('keyboard-type', { text: 'olá', pressEnter: true }), { success: true, typed: 'olá', enterPressed: true });
    assert.deepStrictEqual(await main.invocar('keyboard-type', { text: 'sem enter' }), { success: true, typed: 'sem enter', enterPressed: undefined });
  });
  assert.deepStrictEqual(processos.pedidos[0], {
    comando: `powershell -Command "${SEND_KEYS} [System.Windows.Forms.SendKeys]::SendWait('{{{}}+{}}{{{}}^{}}{{{}}%{}}{{{}}~{}}{{{}}({}}{{{}}){}}{{{}}[{}}{{{}}]{}}{{{}}{}}')"`,
    opcoes: { timeout: 20000 },
  });
  assert.deepStrictEqual(processos.pedidos[1], {
    comando: `powershell -Command "\n          Add-Type -AssemblyName System.Windows.Forms;\n          [System.Windows.Forms.SendKeys]::SendWait('olá');\n          Start-Sleep -Seconds 5;\n          [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')\n        "`,
    opcoes: { timeout: 20000 },
  });
  assert.strictEqual(processos.pedidos[2].comando, `powershell -Command "${SEND_KEYS} [System.Windows.Forms.SendKeys]::SendWait('sem enter')"`);
});

test('keyboard-type fora do Mac: o erro do PowerShell e o texto ausente viram { error }', async () => {
  const processos = execFalso(() => new Error('powershell nao encontrado'));
  const main = carregarMain({ modulos: { child_process: processos.modulo } });
  await comPlataforma('linux', async () => {
    assert.deepStrictEqual(await main.invocar('keyboard-type', { text: 'oi' }), { error: 'powershell nao encontrado' });
    const semTexto = await main.invocar('keyboard-type', {});
    assert.deepStrictEqual(Object.keys(semTexto), ['error']);
    assert.match(semTexto.error, /replace/);
  });
  assert.strictEqual(processos.pedidos.length, 1);
});

function robotFalso(diario, relogio, falharEm = null) {
  const registrar = (nome) => (...argumentos) => {
    diario.push([nome, ...argumentos, relogio.agora]);
    if (nome === falharEm) throw new Error(`robo quebrou em ${nome}`);
  };
  return { typeString: registrar('typeString'), keyTap: registrar('keyTap') };
}

async function comRelogioFalso(funcao) {
  const original = Date.now;
  const relogio = { agora: 0 };
  Date.now = () => { relogio.agora += 50; return relogio.agora; };
  try {
    return await funcao(relogio);
  } finally {
    Date.now = original;
  }
}

async function enviarPeloRobo(plataforma, argumentos, { falharEm = null, falharExec = false } = {}) {
  return comRelogioFalso(async (relogio) => {
    const diario = [];
    const processos = execFalso(() => (falharExec ? new Error('sem protocolo') : null));
    const main = carregarMain({ modulos: { child_process: processos.modulo, '@jitsi/robotjs': robotFalso(diario, relogio, falharEm) } });
    const resposta = await comPlataforma(plataforma, () => main.invocar('send-whatsapp-keyboard', argumentos));
    return { resposta, diario, pedidos: processos.pedidos, fim: relogio.agora };
  });
}

test('send-whatsapp-keyboard no Windows: abre o WhatsApp e digita contato e mensagem nos tempos de hoje', async () => {
  const { resposta, diario, pedidos, fim } = await enviarPeloRobo('win32', { name: 'Ana', message: 'Oi, tudo bem?' });
  assert.deepStrictEqual(resposta, { success: true, output: 'Message sent successfully using RobotJS', method: 'robotjs_native' });
  assert.deepStrictEqual(pedidos, [{ comando: 'start whatsapp:', opcoes: undefined }]);
  assert.deepStrictEqual(diario, [
    ['keyTap', 'n', 'control', 4050],
    ['typeString', 'Ana', 5600],
    ['keyTap', 'enter', 7150],
    ['typeString', 'Oi, tudo bem?', 8200],
    ['keyTap', 'enter', 9050],
  ]);
  assert.strictEqual(fim, 9050);
});

test('send-whatsapp-keyboard no Mac usa open -a e o atalho com command', async () => {
  const { resposta, diario, pedidos } = await enviarPeloRobo('darwin', { name: 'Ana', message: 'Oi' });
  assert.strictEqual(resposta.success, true);
  assert.deepStrictEqual(pedidos, [{ comando: 'open -a WhatsApp', opcoes: undefined }]);
  assert.deepStrictEqual(diario[0], ['keyTap', 'n', 'command', 4050]);
});

test('send-whatsapp-keyboard: o aviso de protocolo que falha não muda o resultado', async () => {
  const { resposta, diario } = await enviarPeloRobo('win32', { name: 'Ana', message: 'Oi' }, { falharExec: true });
  assert.strictEqual(resposta.success, true);
  assert.strictEqual(diario.length, 5);
});

test('send-whatsapp-keyboard: nome ou mensagem vazios e argumentos ausentes não tocam no robô', async () => {
  for (const argumentos of [{ name: '', message: 'Oi' }, { name: 'Ana', message: '' }, {}, undefined]) {
    const { resposta, diario, pedidos } = await enviarPeloRobo('win32', argumentos);
    assert.deepStrictEqual(resposta, { success: false, error: 'Contact name and message are required' });
    assert.deepStrictEqual(diario, []);
    assert.deepStrictEqual(pedidos, []);
  }
});

test('send-whatsapp-keyboard: números viram texto e um erro do robô devolve { success: false, error }', async () => {
  const numerico = await enviarPeloRobo('win32', { name: 123, message: 456 });
  assert.deepStrictEqual(numerico.diario.map((linha) => linha[1]), ['n', '123', 'enter', '456', 'enter']);
  const quebrado = await enviarPeloRobo('win32', { name: 'Ana', message: 'Oi' }, { falharEm: 'typeString' });
  assert.deepStrictEqual(quebrado.resposta, { success: false, error: 'robo quebrou em typeString' });
  assert.strictEqual(quebrado.diario.length, 2);
});

test('send-whatsapp-keyboard: sem o módulo do robô responde com a instrução de instalação', async () => {
  const main = carregarMain({ ausentes: ['@jitsi/robotjs'] });
  assert.deepStrictEqual(await main.invocar('send-whatsapp-keyboard', { name: 'Ana', message: 'Oi' }), {
    success: false,
    error: 'RobotJS module not installed. Run: npm install robotjs',
  });
});
