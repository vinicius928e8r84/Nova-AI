'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const CAMINHO_DO_SERVICO = require.resolve('../ios-devices');
const OPCOES_DAS_CONSULTAS = { timeout: 6000, windowsHide: true };

const falsos = {};
const carregarOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  return pedido in falsos ? falsos[pedido] : carregarOriginal.call(this, pedido, ...resto);
};
test.after(() => { Module._load = carregarOriginal; });

function montar({ respostas, ferramenta = (nome) => `/ios/${nome}` }) {
  const chamadas = [];
  const pendentes = [];
  falsos.child_process = {
    execFile: (arquivo, argumentos, opcoes, retorno) => {
      chamadas.push({ arquivo, argumentos, opcoes });
      const resposta = respostas(argumentos);
      if (resposta === 'esperar') pendentes.push({ argumentos, retorno });
      else process.nextTick(retorno, ...resposta);
    },
  };
  falsos['./ios-tools'] = { tool: ferramenta };
  delete require.cache[CAMINHO_DO_SERVICO];
  const { listar } = require(CAMINHO_DO_SERVICO);
  const liberar = (udid, chave, resposta) => {
    const posicao = pendentes.findIndex(({ argumentos }) => argumentos[1] === udid && argumentos[3] === chave);
    const [{ retorno }] = pendentes.splice(posicao, 1);
    retorno(...resposta);
  };
  return { listar, chamadas, pendentes, liberar };
}

test.afterEach(() => {
  for (const chave of Object.keys(falsos)) delete falsos[chave];
  delete require.cache[CAMINHO_DO_SERVICO];
});

const resposta = (valor) => [null, valor, ''];
const FALHA = [new Error('sem aparelho'), '', ''];
const informacao = (udid, chave) => ({ arquivo: '/ios/ideviceinfo', argumentos: ['-u', udid, '-k', chave], opcoes: OPCOES_DAS_CONSULTAS });
const aparelho = (udid, nome) => ({ id: `ios-${udid}`, status: 'device', name: nome, type: 'usb', ios: true });

function aparelhosConectados(lista, nomes = {}, versoes = {}) {
  return (argumentos) => {
    if (argumentos[0] === '-l') return lista;
    const [, udid, , chave] = argumentos;
    return (chave === 'DeviceName' ? nomes : versoes)[udid] || FALHA;
  };
}

test('sem idevice_id funcionando ou sem aparelho a lista vem vazia e só pergunta uma vez', async () => {
  const saidas = [FALHA, resposta(''), [null, null, ''], resposta('\n  \n')];
  for (const saida of saidas) {
    const { listar, chamadas } = montar({ respostas: () => saida });
    assert.deepEqual(await listar(), []);
    assert.deepEqual(chamadas, [{ arquivo: '/ios/idevice_id', argumentos: ['-l'], opcoes: OPCOES_DAS_CONSULTAS }]);
  }
});

test('um aparelho: nome e versão viram "nome (iOS versão)" e cada consulta leva o limite e o windowsHide', async () => {
  const { listar, chamadas } = montar({
    respostas: aparelhosConectados(resposta('UDID-1\n'), { 'UDID-1': resposta('Celular de teste\n') }, { 'UDID-1': resposta('17.1.2\n') }),
  });
  assert.deepEqual(await listar(), [aparelho('UDID-1', 'Celular de teste (iOS 17.1.2)')]);
  assert.deepEqual(chamadas.map(({ arquivo, argumentos }) => [arquivo, argumentos]), [
    ['/ios/idevice_id', ['-l']],
    ['/ios/ideviceinfo', ['-u', 'UDID-1', '-k', 'DeviceName']],
    ['/ios/ideviceinfo', ['-u', 'UDID-1', '-k', 'ProductVersion']],
  ]);
  assert.deepEqual(chamadas[1], informacao('UDID-1', 'DeviceName'));
  assert.deepEqual(chamadas[2], informacao('UDID-1', 'ProductVersion'));
});

const NOMES_E_VERSOES = [
  ['sem nome nem versão', FALHA, FALHA, 'iPhone'],
  ['nome vazio', resposta(''), resposta('16.0'), 'iPhone (iOS 16.0)'],
  ['nome só com espaço', resposta('  \n'), resposta('16.0'), 'iPhone (iOS 16.0)'],
  ['nome nulo', [null, null, ''], resposta('16.0'), 'iPhone (iOS 16.0)'],
  ['versão com falha', resposta('Meu iPhone'), FALHA, 'Meu iPhone'],
  ['versão vazia', resposta('Meu iPhone'), resposta(''), 'Meu iPhone'],
  ['versão só com espaço', resposta('Meu iPhone'), resposta(' \n'), 'Meu iPhone'],
  ['nome com falha e versão boa', FALHA, resposta('15.8'), 'iPhone (iOS 15.8)'],
  ['saída em Buffer', resposta(Buffer.from(' Buffer \n')), resposta(Buffer.from('14.1\n')), 'Buffer (iOS 14.1)'],
];

for (const [nome, doNome, daVersao, esperado] of NOMES_E_VERSOES) {
  test(`o nome do aparelho: ${nome}`, async () => {
    const { listar } = montar({ respostas: aparelhosConectados(resposta('X'), { X: doNome }, { X: daVersao }) });
    assert.deepEqual(await listar(), [aparelho('X', esperado)]);
  });
}

test('os UDIDs saem limpos de espaço e de linha em branco', async () => {
  const { listar } = montar({
    respostas: aparelhosConectados(resposta('  A \n\n\tB\n \nC'), { A: resposta('a'), B: resposta('b'), C: resposta('c') }, {}),
  });
  assert.deepEqual((await listar()).map(({ id }) => id), ['ios-A', 'ios-B', 'ios-C']);
});

test('a lista sai na ordem em que cada aparelho termina de responder, não na dos UDIDs', async () => {
  const { listar, pendentes, liberar } = montar({ respostas: (argumentos) => (argumentos[0] === '-l' ? resposta('A\nB\nC\n') : 'esperar') });
  const lista = listar();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(pendentes.map(({ argumentos }) => argumentos[1] + argumentos[3]), ['ADeviceName', 'BDeviceName', 'CDeviceName']);
  liberar('C', 'DeviceName', resposta('Nome C'));
  liberar('A', 'DeviceName', resposta('Nome A'));
  liberar('B', 'DeviceName', resposta('Nome B'));
  await new Promise((resolve) => setImmediate(resolve));
  liberar('B', 'ProductVersion', resposta('2'));
  liberar('C', 'ProductVersion', resposta('3'));
  assert.equal(pendentes.length, 1);
  liberar('A', 'ProductVersion', resposta('1'));
  assert.deepEqual(await lista, [aparelho('B', 'Nome B (iOS 2)'), aparelho('C', 'Nome C (iOS 3)'), aparelho('A', 'Nome A (iOS 1)')]);
});

test('o nome vem antes da versão e a versão só é pedida depois do nome', async () => {
  const { listar, pendentes, liberar } = montar({ respostas: (argumentos) => (argumentos[0] === '-l' ? resposta('A') : 'esperar') });
  const lista = listar();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(pendentes.map(({ argumentos }) => argumentos[3]), ['DeviceName']);
  liberar('A', 'DeviceName', resposta('Nome'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(pendentes.map(({ argumentos }) => argumentos[3]), ['ProductVersion']);
  liberar('A', 'ProductVersion', resposta('9'));
  assert.deepEqual(await lista, [aparelho('A', 'Nome (iOS 9)')]);
});

test('ferramenta ausente: a lista falha com o erro da ferramenta, sem consultar nada', async () => {
  const { listar, chamadas } = montar({
    respostas: () => resposta('A'),
    ferramenta: () => { throw new Error('Ferramenta USB ausente no Nova: idevice_id. Reinstale o aplicativo completo.'); },
  });
  await assert.rejects(listar(), /Ferramenta USB ausente no Nova: idevice_id/);
  assert.deepEqual(chamadas, []);
});

test('cada consulta pede o caminho da ferramenta na hora, pelo nome dela', async () => {
  const pedidos = [];
  const { listar } = montar({
    respostas: aparelhosConectados(resposta('A'), { A: resposta('n') }, { A: resposta('1') }),
    ferramenta: (nome) => { pedidos.push(nome); return `/ios/${nome}`; },
  });
  await listar();
  assert.deepEqual(pedidos, ['idevice_id', 'ideviceinfo', 'ideviceinfo']);
});
