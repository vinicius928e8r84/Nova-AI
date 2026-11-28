'use strict';
const test = require('node:test');
const assert = require('node:assert');
const idioma = require('../electron/services/idioma-ipc');

const { HELPER_BASH, HELPER_SCRIPT, AVISO_GLOBAL, AVISO_RESPRING, AVISO_CAM_LIVE, AVISO_APPS, AVISO_DISCO } = idioma;
const ATALHO = '/var/jb/usr/bin/nova-locale';
const AVISO_V2 = 'o helper do iPhone é antigo (v2, só fuso): falta a versão com "language get/set". Rode o Conectar para atualizar o helper.';
const AVISO_APPS_PROPRIOS = (n) => `${n} app(s) têm idioma próprio e, sem limpar, continuam no idioma deles.`;
const ehVerificacao = (cmd) => cmd[0] === HELPER_BASH && cmd[1] === '-c';

function palco({ helper = { code: 0, stdout: 'OK\n', stderr: '' }, respostas = [] } = {}) {
  const chamadas = [];
  const exec = async (cmd, timeoutMs) => {
    chamadas.push({ cmd, timeoutMs });
    if (ehVerificacao(cmd)) return typeof helper === 'function' ? helper() : helper;
    return respostas.length ? respostas.shift() : { code: 0, stdout: '', stderr: '' };
  };
  const reais = () => chamadas.filter(({ cmd }) => !ehVerificacao(cmd));
  return { chamadas, reais, h: idioma.createHandlers({ exec }) };
}

const saida = (...linhas) => ({ code: 0, stdout: linhas.join('\n') + '\n', stderr: '' });

test('createHandlers exige exec e devolve o deviceId padrão ios-1', () => {
  assert.throws(() => idioma.createHandlers({}), { message: 'exec obrigatório' });
  assert.strictEqual(idioma.createHandlers({ exec: () => {} }).deviceId, 'ios-1');
  assert.strictEqual(idioma.createHandlers({ exec: () => {}, deviceId: 'ios-9' }).deviceId, 'ios-9');
});

test('verificarHelper: manda o script de verificação com o tempo pedido, lembra a resposta por 60 s e depois pergunta de novo', async () => {
  const agora = Date.now;
  let relogio = 1000;
  Date.now = () => relogio;
  try {
    const { chamadas, h } = palco();
    assert.deepStrictEqual(await h.verificarHelper(), { ok: true });
    assert.strictEqual(chamadas[0].timeoutMs, 8000);
    assert.deepStrictEqual(chamadas[0].cmd.slice(0, 2), [HELPER_BASH, '-c']);
    assert.strictEqual(chamadas[0].cmd.length, 3);
    assert.ok(chamadas[0].cmd[2].startsWith(`F=${HELPER_SCRIPT}; test -f $F || { echo FALTA; exit 0; }; `));
    assert.ok(chamadas[0].cmd[2].endsWith('[ -n "$V" ] && [ "$V" -ge 3 ] && { echo OK; exit 0; }; echo V2'));
    relogio += 59999;
    await h.verificarHelper(5);
    assert.strictEqual(chamadas.length, 1);
    relogio += 1;
    await h.verificarHelper(5);
    assert.strictEqual(chamadas.length, 2);
    assert.strictEqual(chamadas[1].timeoutMs, 5);
  } finally {
    Date.now = agora;
  }
});

test('verificarHelper: V2 e falta do script viram erro, e o erro do stderr é traduzido', async () => {
  const v2 = palco({ helper: { code: 0, stdout: ' V2 \n', stderr: '' } });
  assert.deepStrictEqual(await v2.h.verificarHelper(), { ok: false, error: AVISO_V2 });
  const falta = palco({ helper: { code: 0, stdout: 'FALTA', stderr: '' } });
  assert.deepStrictEqual(await falta.h.verificarHelper(), { ok: false, error: 'o helper nova-locale não está instalado no iPhone.' });
  const traduzido = palco({ helper: { code: 1, stdout: '', stderr: 'bash: nova-locale: No such file or directory\n' } });
  assert.deepStrictEqual(await traduzido.h.verificarHelper(), { ok: false, error: 'o helper do iPhone (nova-locale) não está nesse caminho; reinstale o helper pelo Conectar.' });
  const bruto = palco({ helper: { code: 1, stdout: 'lixo', stderr: '  falhou feio  ' } });
  assert.deepStrictEqual(await bruto.h.verificarHelper(), { ok: false, error: 'falhou feio' });
  const nada = palco({ helper: () => undefined });
  assert.deepStrictEqual(await nada.h.verificarHelper(), { ok: false, error: 'o helper nova-locale não está instalado no iPhone.' });
});

test('traduzirErro e dominioValido nas bordas', () => {
  assert.strictEqual(idioma.traduzirErro(undefined), '');
  assert.strictEqual(idioma.traduzirErro('x: nova-locale: No such file'), 'o helper do iPhone (nova-locale) não está nesse caminho; reinstale o helper pelo Conectar.');
  assert.strictEqual(idioma.traduzirErro('Subcomando Desconhecido'), 'o helper instalado no iPhone é antigo (v2, só fuso): falta a versão com "language get/set".');
  assert.strictEqual(idioma.traduzirErro('NOVALANGUAGE NÃO INSTALADO'), 'o pacote de idioma (com.aquiles.novalanguage) não está instalado no iPhone.');
  assert.strictEqual(idioma.traduzirErro('  espaço  '), 'espaço');
  assert.deepStrictEqual(['global', 'com.apple.Preferences', 'ab', '', undefined, null, '-a.b', '../x'].map(idioma.dominioValido), [true, true, false, false, false, false, false, false]);
});

test('lerSaida ignora linhas sem nome, tira espaços, guarda o último valor e aceita CRLF', () => {
  assert.deepStrictEqual(idioma.lerSaida('=sem nome\nsemigual\n a = 1 \r\nwarn=\nwarn= x \nerror=a\nerror=b\na=2\n'), { warnings: ['x'], error: 'b', a: '2' });
  assert.deepStrictEqual(idioma.lerSaida(undefined), { warnings: [] });
});

test('rodar (pelo getLanguage): sem o script cai no atalho e usa a resposta dele', async () => {
  const { reais, h } = palco({ respostas: [
    { code: 127, stdout: '', stderr: 'bash: /var/jb/usr/libexec/nova-locale.sh: No such file or directory' },
    saida('language=pt-BR', 'override=yes'),
  ] });
  const r = await h.getLanguage({ domain: 'com.apple.mobilesafari' });
  assert.strictEqual(r.language, 'pt-BR');
  assert.deepStrictEqual(reais().map(({ cmd, timeoutMs }) => [cmd, timeoutMs]), [
    [[HELPER_BASH, HELPER_SCRIPT, 'language', 'get', '--domain', 'com.apple.mobilesafari', '--format', 'lines'], 20000],
    [[ATALHO, 'language', 'get', '--domain', 'com.apple.mobilesafari', '--format', 'lines'], 20000],
  ]);
});

test('rodar: o atalho só entra com código diferente de zero e a mensagem do script faltando', async () => {
  const mensagem = 'nova-locale.sh: No such file';
  const comZero = palco({ respostas: [{ code: 0, stdout: '', stderr: mensagem }] });
  assert.deepStrictEqual(await comZero.h.getLanguage({}), { success: false, error: mensagem, domain: 'global' });
  assert.strictEqual(comZero.reais().length, 1);
  const outro = palco({ respostas: [{ code: 2, stdout: '', stderr: 'outro erro' }] });
  const r = await outro.h.getLanguage({});
  assert.deepStrictEqual(r, { success: false, error: 'outro erro', domain: 'global' });
  assert.strictEqual(outro.reais().length, 1);
});

test('rodar: o stderr só vira erro se a saída não trouxe error; erro da saída é traduzido; código sem erro vira mensagem do código', async () => {
  const { h } = palco({ respostas: [
    { code: 0, stdout: 'language=pt-BR\n', stderr: '  subcomando desconhecido  ' },
    { code: 0, stdout: 'error=novalanguage não instalado\n', stderr: 'ignorado' },
    { code: 0, stdout: 'error=bruto\n', stderr: '' },
    { code: 4, stdout: 'language=pt-BR\n', stderr: '   ' },
    { code: 4, stdout: 'error=já tem\n', stderr: '' },
    { code: 0, stdout: 'language=pt-BR\n', stderr: '   ' },
    undefined,
  ] });
  assert.strictEqual((await h.getLanguage({})).error, 'o helper instalado no iPhone é antigo (v2, só fuso): falta a versão com "language get/set".');
  assert.strictEqual((await h.getLanguage({})).error, 'o pacote de idioma (com.aquiles.novalanguage) não está instalado no iPhone.');
  assert.strictEqual((await h.getLanguage({})).error, 'bruto');
  assert.strictEqual((await h.getLanguage({})).error, 'o helper saiu com código 4');
  assert.strictEqual((await h.getLanguage({})).error, 'já tem');
  assert.strictEqual((await h.getLanguage({})).success, true);
  assert.strictEqual((await h.getLanguage({})).success, true);
});

test('getLanguage: formato completo, nome nulo para idioma desconhecido, avisos só no global e contagem inválida', async () => {
  const completa = palco({ respostas: [saida('language=ja-JP', 'locale=ja_JP', 'override=yes', 'disk=ja-JP', 'diskMatches=yes', 'apps_com_idioma_proprio=2')] });
  assert.deepStrictEqual(await completa.h.getLanguage(), {
    success: true, domain: 'global', appsComIdiomaProprio: 2, language: 'ja-JP', nome: 'Japonês', locale: 'ja_JP',
    override: true, disco: 'ja-JP', discoCombina: true, avisos: [AVISO_APPS_PROPRIOS(2)],
  });
  const desconhecido = palco({ respostas: [saida('language=xx-XX', 'diskMatches=no')] });
  assert.deepStrictEqual(await desconhecido.h.getLanguage({ domain: 'global' }), {
    success: true, domain: 'global', appsComIdiomaProprio: 0, language: 'xx-XX', nome: null, locale: null,
    override: false, disco: null, discoCombina: false, avisos: [AVISO_DISCO],
  });
  const app = palco({ respostas: [saida('diskMatches=no', 'apps_com_idioma_proprio=5')] });
  assert.deepStrictEqual(await app.h.getLanguage({ domain: 'com.apple.Preferences' }), {
    success: true, domain: 'com.apple.Preferences', appsComIdiomaProprio: 5, language: null, nome: null, locale: null,
    override: false, disco: null, discoCombina: false, avisos: [],
  });
  const lixo = palco({ respostas: [saida('apps_com_idioma_proprio=abc')] });
  const r = await lixo.h.getLanguage();
  assert.ok(Number.isNaN(r.appsComIdiomaProprio));
  assert.deepStrictEqual(r.avisos, []);
  const dois = palco({ respostas: [saida('diskMatches=no', 'apps_com_idioma_proprio=1')] });
  assert.deepStrictEqual((await dois.h.getLanguage()).avisos, [AVISO_DISCO, AVISO_APPS_PROPRIOS(1)]);
});

test('getLanguage: domínio inválido não chama nada; helper recusando e erro do comando levam o domain', async () => {
  const a = palco();
  assert.deepStrictEqual(await a.h.getLanguage({ domain: 'x' }), { success: false, error: 'domínio inválido' });
  assert.strictEqual(a.chamadas.length, 0);
  const b = palco({ helper: { code: 0, stdout: 'V2', stderr: '' } });
  assert.deepStrictEqual(await b.h.getLanguage({ domain: 'com.apple.Preferences' }), { success: false, error: AVISO_V2, domain: 'com.apple.Preferences' });
  const c = palco({ respostas: [saida('error=quebrou')] });
  assert.deepStrictEqual(await c.h.getLanguage(), { success: false, error: 'quebrou', domain: 'global' });
});

test('applyLanguage: sucesso global com locale automático, limpeza de apps e todos os avisos na ordem', async () => {
  const { reais, h } = palco({ respostas: [saida('confirmed=yes', 'language=pt-BR', 'locale=pt_BR', 'localeAuto=yes', 'clearedApps=com.a:es,com.b:en,', 'warn=aviso do helper')] });
  assert.deepStrictEqual(await h.applyLanguage({ language: 'pt-BR', confirmGlobal: true }), {
    success: true, domain: 'global', escopo: 'aparelho', appsLimpos: ['com.a:es', 'com.b:en'], localeAuto: true,
    pedido: 'pt-BR', aplicado: 'pt-BR', confirmed: true, locale: 'pt_BR', respring: false,
    avisos: [AVISO_GLOBAL, 'aviso do helper', AVISO_APPS(2), AVISO_RESPRING], error: null,
  });
  assert.deepStrictEqual(reais()[0], {
    cmd: [HELPER_BASH, HELPER_SCRIPT, 'language', 'set', 'pt-BR', '--domain', 'global', '--locale', 'auto', '--clear-apps', '--format', 'lines'],
    timeoutMs: 25000,
  });
});

test('applyLanguage: com respring o tempo é 60 s, a flag entra antes do --format e o aviso do CAM LIVE só entra se faltar', async () => {
  const a = palco({ respostas: [saida('confirmed=yes', 'language=en-US')] });
  const r = await a.h.applyLanguage({ tag: 'en-US', domain: 'com.apple.Preferences', respring: 1, locale: 'en_US' });
  assert.deepStrictEqual(a.reais()[0], {
    cmd: [HELPER_BASH, HELPER_SCRIPT, 'language', 'set', 'en-US', '--domain', 'com.apple.Preferences', '--locale', 'en_US', '--respring', '--format', 'lines'],
    timeoutMs: 60000,
  });
  assert.deepStrictEqual(r, {
    success: true, domain: 'com.apple.Preferences', escopo: 'app', appsLimpos: [], localeAuto: false, pedido: 'en-US',
    aplicado: 'en-US', confirmed: true, locale: null, respring: true, avisos: [AVISO_CAM_LIVE], error: null,
  });
  const b = palco({ respostas: [saida('confirmed=yes', 'warn=O CAM LIVE caiu', 'warn=Accept-Language mudou', 'warn=1 app(s) com idioma próprio ajustados', 'clearedApps=com.a')] });
  const rb = await b.h.applyLanguage({ tag: 'pt-BR', confirmGlobal: true, respring: true, limparApps: false });
  assert.deepStrictEqual(rb.avisos, ['O CAM LIVE caiu', 'Accept-Language mudou', '1 app(s) com idioma próprio ajustados']);
  assert.ok(b.reais()[0].cmd.includes('--no-clear-apps'));
});

test('applyLanguage: recusas na ordem tag, domínio, confirmação, helper e locale (o locale só é conferido depois do helper)', async () => {
  const a = palco();
  const erroDaTag = { success: false, error: 'idioma inválido: informe algo como pt-BR ou en-US' };
  assert.deepStrictEqual(await a.h.applyLanguage(), erroDaTag);
  assert.deepStrictEqual(await a.h.applyLanguage({ tag: 'p' }), erroDaTag);
  assert.deepStrictEqual(await a.h.applyLanguage({ tag: 'pt-BR', domain: 'z' }), { success: false, error: 'domínio inválido' });
  assert.deepStrictEqual(await a.h.applyLanguage({ tag: 'pt-BR', confirmGlobal: 'sim' }), {
    success: false, precisaConfirmar: true, avisos: [AVISO_GLOBAL, AVISO_RESPRING], error: 'confirmar antes de aplicar no aparelho inteiro',
  });
  assert.strictEqual(a.chamadas.length, 0);
  assert.deepStrictEqual(await a.h.applyLanguage({ tag: 'pt-BR', confirmGlobal: true, locale: 'pt-BR' }), { success: false, error: 'locale inválido: informe algo como pt_BR' });
  assert.strictEqual(a.chamadas.length, 1);
  const b = palco({ helper: { code: 0, stdout: 'V2', stderr: '' } });
  assert.deepStrictEqual(await b.h.applyLanguage({ tag: 'pt-BR', confirmGlobal: true, locale: 'pt-BR' }), { success: false, error: AVISO_V2, avisos: [] });
});

test('applyLanguage sem confirmação do aparelho: erro do helper aparece, exceto o do código de saída', async () => {
  const sem = palco({ respostas: [saida('confirmed=no', 'language=en-US', 'warn=w')] });
  assert.deepStrictEqual(await sem.h.applyLanguage({ tag: 'pt-BR', confirmGlobal: true }), {
    success: false, domain: 'global', pedido: 'pt-BR', aplicado: 'en-US', confirmed: false, respring: false,
    avisos: [AVISO_GLOBAL, 'w', AVISO_RESPRING], error: 'o aparelho não confirmou a gravação no store',
  });
  const erro = palco({ respostas: [saida('error=falhou de verdade')] });
  const r = await erro.h.applyLanguage({ tag: 'pt-BR', domain: 'com.apple.Preferences', respring: true });
  assert.deepStrictEqual(r, {
    success: false, domain: 'com.apple.Preferences', pedido: 'pt-BR', aplicado: null, confirmed: false, respring: true,
    avisos: [AVISO_CAM_LIVE], error: 'falhou de verdade',
  });
  const codigo = palco({ respostas: [{ code: 9, stdout: 'confirmed=no\n', stderr: '' }] });
  assert.strictEqual((await codigo.h.applyLanguage({ tag: 'pt-BR', confirmGlobal: true })).error, 'o aparelho não confirmou a gravação no store');
});

test('applyLanguage confirmado mas com erro devolve só o erro e os avisos', async () => {
  const { h } = palco({ respostas: [saida('confirmed=yes', 'error=ficou torto')] });
  assert.deepStrictEqual(await h.applyLanguage({ tag: 'pt-BR', domain: 'com.apple.Preferences' }), {
    success: false, error: 'ficou torto', avisos: [AVISO_RESPRING],
  });
});

test('revertLanguage: formato completo, tempos, ordem dos avisos e contagem de apps só no global', async () => {
  const a = palco({ respostas: [saida('language=', 'override=no', 'revertido_de_backup=/var/x.orig', 'apps_com_idioma_proprio=4', 'warn=w')] });
  assert.deepStrictEqual(await a.h.revertLanguage(), {
    success: true, domain: 'global', appsComIdiomaProprio: 4, language: null, override: false, backup: '/var/x.orig',
    respring: false, avisos: ['w', AVISO_RESPRING, AVISO_APPS_PROPRIOS(4)],
  });
  assert.deepStrictEqual(a.reais()[0], { cmd: [HELPER_BASH, HELPER_SCRIPT, 'language', 'revert', '--domain', 'global', '--format', 'lines'], timeoutMs: 25000 });
  const b = palco({ respostas: [saida('language=pt-BR', 'override=yes', 'apps_com_idioma_proprio=4')] });
  const rb = await b.h.revertLanguage({ domain: 'com.apple.Preferences', respring: true });
  assert.deepStrictEqual(rb, {
    success: true, domain: 'com.apple.Preferences', appsComIdiomaProprio: 4, language: 'pt-BR', override: true, backup: null,
    respring: true, avisos: [AVISO_CAM_LIVE],
  });
  assert.deepStrictEqual(b.reais()[0], { cmd: [HELPER_BASH, HELPER_SCRIPT, 'language', 'revert', '--domain', 'com.apple.Preferences', '--respring', '--format', 'lines'], timeoutMs: 60000 });
  const c = palco({ respostas: [saida('warn=reconecte o CAM LIVE')] });
  assert.deepStrictEqual((await c.h.revertLanguage({ respring: true })).avisos, ['reconecte o CAM LIVE']);
});

test('revertLanguage: domínio inválido, helper recusando e erro do comando', async () => {
  const a = palco();
  assert.deepStrictEqual(await a.h.revertLanguage({ domain: 'x' }), { success: false, error: 'domínio inválido' });
  assert.strictEqual(a.chamadas.length, 0);
  const b = palco({ helper: { code: 0, stdout: 'FALTA', stderr: '' } });
  assert.deepStrictEqual(await b.h.revertLanguage(), { success: false, error: 'o helper nova-locale não está instalado no iPhone.', avisos: [] });
  const c = palco({ respostas: [saida('error=sem backup', 'warn=w')] });
  assert.deepStrictEqual(await c.h.revertLanguage({ respring: true }), { success: false, error: 'sem backup', avisos: ['w', AVISO_CAM_LIVE] });
});

test('listarApps e respring: formatos, tempos e recusas', async () => {
  const a = palco({ respostas: [saida('apps=com.a,,com.b'), saida('apps='), saida('error=x'), saida('respring=ok', 'warn=w'), saida('respring=falhou'), saida('error=y')] });
  assert.deepStrictEqual(await a.h.listarApps(), { success: true, count: 2, apps: ['com.a', 'com.b'] });
  assert.deepStrictEqual(await a.h.listarApps(), { success: true, count: 0, apps: [] });
  assert.deepStrictEqual(await a.h.listarApps(), { success: false, error: 'x' });
  assert.deepStrictEqual(await a.h.respring(), { success: true, avisos: ['w', AVISO_RESPRING] });
  assert.deepStrictEqual(await a.h.respring(), { success: false, avisos: [AVISO_RESPRING] });
  assert.deepStrictEqual(await a.h.respring(), { success: false, error: 'y' });
  assert.deepStrictEqual(a.reais().map(({ cmd, timeoutMs }) => [cmd.slice(1), timeoutMs]), [
    [[HELPER_SCRIPT, 'language', 'apps', '--format', 'lines'], 30000],
    [[HELPER_SCRIPT, 'language', 'apps', '--format', 'lines'], 30000],
    [[HELPER_SCRIPT, 'language', 'apps', '--format', 'lines'], 30000],
    [[HELPER_SCRIPT, 'respring'], 40000],
    [[HELPER_SCRIPT, 'respring'], 40000],
    [[HELPER_SCRIPT, 'respring'], 40000],
  ]);
  const b = palco({ helper: { code: 0, stdout: 'V2', stderr: '' } });
  assert.deepStrictEqual(await b.h.listarApps(), { success: false, error: AVISO_V2 });
  assert.deepStrictEqual(await b.h.respring(), { success: false, error: AVISO_V2 });
});

test('domínio inválido devolve uma resposta nova a cada chamada: mexer numa não muda a seguinte', async () => {
  const { h } = palco();
  for (const chamar of [() => h.getLanguage({ domain: 'x' }), () => h.applyLanguage({ tag: 'pt-BR', domain: 'x' }), () => h.revertLanguage({ domain: 'x' })]) {
    const primeira = await chamar();
    primeira.error = 'mudado';
    primeira.extra = true;
    assert.deepStrictEqual(await chamar(), { success: false, error: 'domínio inválido' });
  }
  const daLeitura = await h.getLanguage({ domain: 'x' });
  daLeitura.success = true;
  assert.deepStrictEqual(await h.revertLanguage({ domain: 'x' }), { success: false, error: 'domínio inválido' });
});
