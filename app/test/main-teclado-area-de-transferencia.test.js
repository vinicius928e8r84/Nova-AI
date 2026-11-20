'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { carregarMain, comPlataforma } = require('./ajuda/carregar-main');

const TECLAS_DO_WINDOWS = {
  enter: '{ENTER}', tab: '{TAB}', escape: '{ESC}', backspace: '{BACKSPACE}', delete: '{DELETE}',
  up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}', home: '{HOME}', end: '{END}',
  pageup: '{PGUP}', pagedown: '{PGDN}',
  f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f6: '{F6}',
  f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
  'ctrl+a': '^a', 'ctrl+c': '^c', 'ctrl+v': '^v', 'ctrl+x': '^x', 'ctrl+z': '^z', 'ctrl+s': '^s',
  'ctrl+enter': '^{ENTER}', 'alt+f4': '%{F4}', 'alt+tab': '%{TAB}',
};

const SEND_KEYS = 'Add-Type -AssemblyName System.Windows.Forms;';

function processosFalsos(falharSe = () => null) {
  const pedidos = [];
  return {
    pedidos,
    modulo: {
      spawn: () => { throw new Error('spawn nao esperado'); },
      exec: (comando, opcoes, aoTerminar) => {
        pedidos.push({ comando, opcoes });
        const erro = falharSe(comando);
        setImmediate(() => aoTerminar(erro, erro ? '' : 'saida', erro ? 'falhou' : ''));
      },
    },
  };
}

function macNativeFalso() {
  const chamadas = [];
  return {
    chamadas,
    pressKey: async (key) => {
      chamadas.push(['pressKey', key]);
      if (key === 'quebra') throw new Error('sem acessibilidade');
      return { success: true, via: 'mac', key };
    },
    typeText: async (text, pressEnter) => {
      chamadas.push(['typeText', text, pressEnter]);
      if (text === 'quebra') throw new Error('sem acessibilidade');
      return { success: true, via: 'mac', text, pressEnter };
    },
  };
}

function areaFalsa() {
  const estado = { texto: 'copiado', html: '<b>copiado</b>', imagemVazia: false, escritas: [] };
  return {
    estado,
    clipboard: {
      readText: () => estado.texto,
      readHTML: () => estado.html,
      readImage: () => ({ isEmpty: () => estado.imagemVazia, toDataURL: () => 'data:image/png;base64,AAA' }),
      writeText: (texto) => { if (texto === 'quebra') throw new Error('area ocupada'); estado.escritas.push(['texto', texto]); },
      writeHTML: (html) => estado.escritas.push(['html', html]),
      writeImage: (imagem) => estado.escritas.push(['imagem', imagem]),
    },
    nativeImage: { createFromDataURL: (url) => ({ deUrl: url }) },
  };
}

test('main.js registra os canais de teclado e de area de transferencia', () => {
  const main = carregarMain();
  for (const canal of ['keyboard-press', 'keyboard-type', 'clipboard-read', 'clipboard-write', 'set-clipboard', 'system-exec-command']) {
    assert.ok(main.canais.handle.has(canal), canal);
  }
});

test('keyboard-press no Mac vai para o mac-native e nao abre processo', async () => {
  const processos = processosFalsos();
  const macNative = macNativeFalso();
  const main = carregarMain({ modulos: { child_process: processos.modulo, './services/mac-native': macNative } });
  await comPlataforma('darwin', async () => {
    assert.deepStrictEqual(await main.invocar('keyboard-press', { key: 'Enter' }), { success: true, via: 'mac', key: 'Enter' });
    assert.deepStrictEqual(await main.invocar('keyboard-press', { key: 'quebra' }), { success: false, error: 'sem acessibilidade' });
  });
  assert.deepStrictEqual(macNative.chamadas, [['pressKey', 'Enter'], ['pressKey', 'quebra']]);
  assert.deepStrictEqual(processos.pedidos, []);
});

test('keyboard-press fora do Mac: SendKeys do PowerShell com a tabela de teclas, sem caixa, e Enter espera 8 s', async () => {
  const processos = processosFalsos();
  const macNative = macNativeFalso();
  const main = carregarMain({ modulos: { child_process: processos.modulo, './services/mac-native': macNative } });
  await comPlataforma('win32', async () => {
    for (const [tecla, enviada] of Object.entries(TECLAS_DO_WINDOWS)) {
      const resposta = await main.invocar('keyboard-press', { key: tecla.toUpperCase() });
      assert.deepStrictEqual(resposta, { success: true, key: enviada, delayed: tecla === 'enter' }, tecla);
    }
    assert.deepStrictEqual(await main.invocar('keyboard-press', { key: 'x' }), { success: true, key: 'x', delayed: false });
  });
  assert.strictEqual(processos.pedidos.length, Object.keys(TECLAS_DO_WINDOWS).length + 1);
  assert.deepStrictEqual(processos.pedidos[0], {
    comando: `powershell -Command "${SEND_KEYS} Start-Sleep -Seconds 8; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')"`,
    opcoes: { timeout: 30000 },
  });
  assert.deepStrictEqual(processos.pedidos[1], {
    comando: `powershell -Command "${SEND_KEYS} [System.Windows.Forms.SendKeys]::SendWait('{TAB}')"`,
    opcoes: { timeout: 30000 },
  });
  assert.strictEqual(processos.pedidos.at(-1).comando, `powershell -Command "${SEND_KEYS} [System.Windows.Forms.SendKeys]::SendWait('x')"`);
  assert.deepStrictEqual(macNative.chamadas, []);
});

test('keyboard-press fora do Mac: erro do PowerShell e tecla ausente viram { error }', async () => {
  const processos = processosFalsos(() => new Error('powershell nao encontrado'));
  const main = carregarMain({ modulos: { child_process: processos.modulo } });
  await comPlataforma('linux', async () => {
    assert.deepStrictEqual(await main.invocar('keyboard-press', { key: 'tab' }), { error: 'powershell nao encontrado' });
    const semTecla = await main.invocar('keyboard-press', {});
    assert.deepStrictEqual(Object.keys(semTecla), ['error']);
    assert.match(semTecla.error, /toLowerCase/);
  });
  assert.strictEqual(processos.pedidos.length, 1);
});

test('keyboard-type no Mac vai para o mac-native com o texto e o Enter', async () => {
  const processos = processosFalsos();
  const macNative = macNativeFalso();
  const main = carregarMain({ modulos: { child_process: processos.modulo, './services/mac-native': macNative } });
  await comPlataforma('darwin', async () => {
    assert.deepStrictEqual(await main.invocar('keyboard-type', { text: 'ola', pressEnter: true }), { success: true, via: 'mac', text: 'ola', pressEnter: true });
    assert.deepStrictEqual(await main.invocar('keyboard-type', { text: 'quebra' }), { success: false, error: 'sem acessibilidade' });
  });
  assert.deepStrictEqual(macNative.chamadas, [['typeText', 'ola', true], ['typeText', 'quebra', undefined]]);
  assert.deepStrictEqual(processos.pedidos, []);
});

test('keyboard-type fora do Mac: escapa os simbolos do SendKeys como hoje (as chaves sao escapadas de novo)', async () => {
  const processos = processosFalsos();
  const main = carregarMain({ modulos: { child_process: processos.modulo } });
  const texto = 'a+b^c%d~e(f)g[h]i{j}k';
  await comPlataforma('win32', async () => {
    assert.deepStrictEqual(await main.invocar('keyboard-type', { text: texto, pressEnter: false }), { success: true, typed: texto, enterPressed: false });
    assert.deepStrictEqual(await main.invocar('keyboard-type', { text: 'oi', pressEnter: true }), { success: true, typed: 'oi', enterPressed: true });
    assert.deepStrictEqual(await main.invocar('keyboard-type', { text: 'sem enter' }), { success: true, typed: 'sem enter', enterPressed: undefined });
  });
  const escapado = 'a{{{}}+{}}b{{{}}^{}}c{{{}}%{}}d{{{}}~{}}e{{{}}({}}f{{{}}){}}g{{{}}[{}}h{{{}}]{}}i{{{}}j{}}k';
  assert.deepStrictEqual(processos.pedidos[0], {
    comando: `powershell -Command "${SEND_KEYS} [System.Windows.Forms.SendKeys]::SendWait('${escapado}')"`,
    opcoes: { timeout: 20000 },
  });
  const comEnter = [
    '',
    `          ${SEND_KEYS}`,
    "          [System.Windows.Forms.SendKeys]::SendWait('oi');",
    '          Start-Sleep -Seconds 5;',
    "          [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')",
    '        ',
  ].join('\n');
  assert.deepStrictEqual(processos.pedidos[1], { comando: `powershell -Command "${comEnter}"`, opcoes: { timeout: 20000 } });
  assert.strictEqual(processos.pedidos[2].comando, `powershell -Command "${SEND_KEYS} [System.Windows.Forms.SendKeys]::SendWait('sem enter')"`);
});

test('keyboard-type fora do Mac: erro do PowerShell e texto ausente viram { error }', async () => {
  const processos = processosFalsos(() => new Error('acesso negado'));
  const main = carregarMain({ modulos: { child_process: processos.modulo } });
  await comPlataforma('win32', async () => {
    assert.deepStrictEqual(await main.invocar('keyboard-type', { text: 'x' }), { error: 'acesso negado' });
    const semTexto = await main.invocar('keyboard-type', {});
    assert.deepStrictEqual(Object.keys(semTexto), ['error']);
    assert.match(semTexto.error, /replace/);
  });
  assert.strictEqual(processos.pedidos.length, 1);
});

test('system-exec-command: roda o comando com buffer de 10 MB e devolve saida, erro e sucesso', async () => {
  const processos = processosFalsos((comando) => (comando === 'falha' ? new Error('codigo 1') : null));
  const main = carregarMain({ modulos: { child_process: processos.modulo } });
  assert.deepStrictEqual(await main.invocar('system-exec-command', { command: 'echo ok' }), { success: true, stdout: 'saida', stderr: '', error: undefined });
  assert.deepStrictEqual(await main.invocar('system-exec-command', { command: 'falha' }), { success: false, stdout: '', stderr: 'falhou', error: 'codigo 1' });
  assert.deepStrictEqual(processos.pedidos, [
    { comando: 'echo ok', opcoes: { maxBuffer: 10 * 1024 * 1024 } },
    { comando: 'falha', opcoes: { maxBuffer: 10 * 1024 * 1024 } },
  ]);
});

test('clipboard-read: texto, html e imagem em data URL, null sem imagem, e o erro', async () => {
  const area = areaFalsa();
  const main = carregarMain({ electron: { clipboard: area.clipboard, nativeImage: area.nativeImage } });
  assert.deepStrictEqual(await main.invocar('clipboard-read'), { text: 'copiado', html: '<b>copiado</b>', image: 'data:image/png;base64,AAA' });
  area.estado.imagemVazia = true;
  assert.deepStrictEqual(await main.invocar('clipboard-read'), { text: 'copiado', html: '<b>copiado</b>', image: null });
  area.clipboard.readHTML = () => { throw new Error('sem acesso'); };
  assert.deepStrictEqual(await main.invocar('clipboard-read'), { error: 'sem acesso' });
});

test('clipboard-write: escreve so o que veio, imagem pelo nativeImage, e devolve o erro', async () => {
  const area = areaFalsa();
  const main = carregarMain({ electron: { clipboard: area.clipboard, nativeImage: area.nativeImage } });
  assert.deepStrictEqual(await main.invocar('clipboard-write', { text: 'oi', html: '<i>oi</i>', image: 'data:image/png;base64,BBB' }), { success: true });
  assert.deepStrictEqual(await main.invocar('clipboard-write', { text: '', html: '' }), { success: true });
  assert.deepStrictEqual(await main.invocar('clipboard-write', { html: '<p>so html</p>' }), { success: true });
  assert.deepStrictEqual(area.estado.escritas, [
    ['texto', 'oi'],
    ['html', '<i>oi</i>'],
    ['imagem', { deUrl: 'data:image/png;base64,BBB' }],
    ['html', '<p>so html</p>'],
  ]);
  assert.deepStrictEqual(await main.invocar('clipboard-write', { text: 'quebra' }), { error: 'area ocupada' });
});

test('set-clipboard: converte para texto, escreve e devolve success, ou success false com o erro', async () => {
  const area = areaFalsa();
  const main = carregarMain({ electron: { clipboard: area.clipboard, nativeImage: area.nativeImage } });
  assert.deepStrictEqual(await main.invocar('set-clipboard', 'prompt'), { success: true });
  assert.deepStrictEqual(await main.invocar('set-clipboard', 42), { success: true });
  assert.deepStrictEqual(await main.invocar('set-clipboard', undefined), { success: true });
  assert.deepStrictEqual(area.estado.escritas, [['texto', 'prompt'], ['texto', '42'], ['texto', 'undefined']]);
  assert.deepStrictEqual(await main.invocar('set-clipboard', 'quebra'), { success: false, error: 'area ocupada' });
});
