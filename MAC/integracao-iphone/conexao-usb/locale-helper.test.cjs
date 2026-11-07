'use strict';
// Testa o endurecimento do helper nova-locale (v2) SEM aparelho.
//  1. Estático: PATH exportado antes de qualquer comando, guarda do sleep, versão, trim, gêmeo igual.
//  2. Comportamento: roda o script de verdade num sandbox (todos os caminhos /var/... reescritos
//     para uma pasta temporária; nada do Mac nem do iPhone é tocado):
//       - sem `sleep` no PATH o serviço ENCERRA (exit 1) em vez de girar e encher o log;
//       - ao subir, zera erro/log acima de 1 MB e preserva o que é pequeno;
//       - sobe gravando "pronto v<versão>", atende ping e recusa ação/fuso inválidos.
//  3. Conectar: handshake de versão (localeHelperVersion / waitLocaleHandshake) com cliente SSH falso.
//
// Uso: node locale-helper.test.cjs
// Para ensaiar o app instalado (em CÓPIA, nunca no próprio app), aponte os arquivos:
//   NOVA_SETUP_JS=/tmp/x/setup.js NOVA_LOCALE_SH=/tmp/x/nova-locale.sh node locale-helper.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn, spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');

const SH = process.env.NOVA_LOCALE_SH || path.join(__dirname, 'nova-locale.sh');
const TWIN = path.join(__dirname, '..', '..', 'controle-celular-plataformas', 'geo-proxy', 'helper', 'nova-locale.sh');
const SETUP = process.env.NOVA_SETUP_JS || path.join(__dirname, 'setup.js');
const src = fs.readFileSync(SH, 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('tempo esgotado esperando: ' + what);
    await sleep(40);
  }
}

// ── 1. Estático ──────────────────────────────────────────────────────────────
function testeEstatico() {
  assert.equal(spawnSync('bash', ['-n', SH]).status, 0, 'bash -n falhou no nova-locale.sh');

  if (fs.existsSync(TWIN)) assert.equal(fs.readFileSync(TWIN, 'utf8'), src, 'cópia em geo-proxy/helper difere do nova-locale.sh canônico');

  // A primeira linha de código (fora comentário/branco) tem que ser o export do PATH: o launchd
  // só entrega /usr/bin:/bin:/usr/sbin:/sbin e lá não existe sleep, date, sed, cp, mv...
  const primeira = src.split('\n').find((l) => l.trim() && !l.trim().startsWith('#'));
  assert.match(primeira, /^export PATH=\/var\/jb\/usr\/bin:/, 'o PATH do Procursus tem que ser a primeira instrução');

  assert.match(src, /^HELPER_VERSION=\d+\s*$/m, 'falta HELPER_VERSION=<n>');
  assert.match(src, /sleep 1 \|\| \{/, 'o sleep do laço precisa de guarda (|| { ...; exit 1; })');
  assert.doesNotMatch(src, /^\s*sleep 1\s*$/m, 'sobrou sleep 1 sem guarda');
  assert.ok(src.indexOf('\ntrim_logs\n') < src.indexOf('status true "pronto v$HELPER_VERSION"'), 'trim_logs tem que rodar antes do primeiro status');
  assert.doesNotMatch(src, /status true "pronto"\s*$/m, 'status "pronto" sem versão não pode sobrar (o Conectar espera "pronto v<n>")');
  console.log('OK 1: estático (bash -n, PATH 1ª instrução, versão, guarda do sleep, trim antes do status, gêmeo igual)');
}

// ── 2. Comportamento no sandbox ──────────────────────────────────────────────
function criarSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-locale-test-'));
  for (const d of ['tmp', 'mobile/Library/Preferences', 'tz/zoneinfo/America', 'bin']) fs.mkdirSync(path.join(root, d), { recursive: true });
  const ferramentas = ['date', 'sed', 'head', 'mv', 'rm', 'cp', 'chmod', 'chown', 'ln', 'readlink', 'cat', 'grep', 'wc', 'mkdir', 'touch'];
  const pasta = (nome, comSleep) => {
    const dir = path.join(root, nome);
    fs.mkdirSync(dir);
    for (const t of comSleep ? ferramentas.concat('sleep') : ferramentas) {
      const achou = ['/bin/', '/usr/bin/', '/usr/sbin/', '/sbin/'].map((p) => p + t).find((p) => fs.existsSync(p));
      assert.ok(achou, 'ferramenta ausente no Mac de teste: ' + t);
      fs.symlinkSync(achou, path.join(dir, t));
    }
    return dir;
  };
  const comSleep = pasta('path-com-sleep', true);
  const semSleep = pasta('path-sem-sleep', false);

  const script = (pathDir) => {
    let s = src.replace(/^export PATH=.*$/m, 'export PATH=' + pathDir);
    s = s.split('/var/tmp/').join(root + '/tmp/').split('/var/mobile/').join(root + '/mobile/')
      .split('/var/db/timezone/').join(root + '/tz/').split('/var/jb/usr/bin/').join(root + '/bin/');
    // Garantia: nenhum caminho real do aparelho sobrou em linha de código. (A pasta temporária do
    // macOS também começa com /var/, por isso o caminho do sandbox é tirado antes de procurar.)
    const sobras = s.split(root).join('<SANDBOX>').split('\n').filter((l) => !/^\s*#/.test(l) && l.includes('/var/'));
    assert.deepEqual(sobras, [], 'caminho /var/ sem reescrever no sandbox');
    const file = path.join(root, path.basename(pathDir) + '.sh');
    fs.writeFileSync(file, s);
    return file;
  };
  const t = (n) => path.join(root, 'tmp', n);
  return { root, t, scriptComSleep: script(comSleep), scriptSemSleep: script(semSleep) };
}

function testeGuardaSleepETrim(sb) {
  // Antes: err e log enormes (2 MB) e out pequeno. O serviço sobe sem sleep no PATH.
  fs.writeFileSync(sb.t('nova-locale.err'), Buffer.alloc(2 * 1048576, 65));
  fs.writeFileSync(sb.t('nova-locale.log'), Buffer.alloc(2 * 1048576, 66));
  fs.writeFileSync(sb.t('nova-locale.out'), 'pequeno\n');

  const t0 = Date.now();
  const r = spawnSync('/bin/bash', [sb.scriptSemSleep], { env: { PATH: '/usr/bin:/bin' }, timeout: 8000, encoding: 'utf8' });
  const ms = Date.now() - t0;

  assert.equal(r.error, undefined, 'o serviço sem sleep NÃO pode girar: estourou o tempo limite');
  assert.equal(r.status, 1, 'sem sleep o serviço tem que sair com código 1');
  assert.match(r.stderr, /sleep indisponivel/);
  const linhasErro = r.stderr.split('\n').filter(Boolean).length;
  assert.ok(linhasErro <= 3, 'erro demais no stderr (' + linhasErro + ' linhas)');
  assert.ok(ms < 4000, 'demorou ' + ms + ' ms para encerrar');

  assert.equal(fs.statSync(sb.t('nova-locale.err')).size, 0, 'err > 1 MB deveria ser zerado ao subir');
  assert.ok(fs.statSync(sb.t('nova-locale.log')).size < 200, 'log > 1 MB deveria ser zerado ao subir (sobra só a linha de início)');
  assert.equal(fs.readFileSync(sb.t('nova-locale.out'), 'utf8'), 'pequeno\n', 'arquivo pequeno não pode ser mexido');
  assert.match(fs.readFileSync(sb.t('nova-locale-status.json'), 'utf8'), /"message":"pronto v\d+"/);
  console.log('OK 2a: sem sleep o serviço encerra em ' + ms + ' ms (exit 1, ' + linhasErro + ' linhas de erro); err/log > 1 MB zerados, arquivo pequeno intacto');
}

async function testeFluxoNormal(sb) {
  for (const n of ['nova-locale.err', 'nova-locale.log', 'nova-locale.out', 'nova-locale-status.json']) fs.rmSync(sb.t(n), { force: true });
  const versao = /^HELPER_VERSION=(\d+)/m.exec(src)[1];
  const filho = spawn('/bin/bash', [sb.scriptComSleep], { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  filho.stderr.on('data', (d) => (stderr += d));
  try {
    const status = () => { try { return JSON.parse(fs.readFileSync(sb.t('nova-locale-status.json'), 'utf8')); } catch (_) { return null; } };
    const linhasLog = () => { try { return fs.readFileSync(sb.t('nova-locale.log'), 'utf8').split('\n').filter(Boolean).length; } catch (_) { return 0; } };
    const enviar = async (corpo, esperado) => {
      fs.rmSync(sb.t('nova-locale-status.json'), { force: true });
      fs.writeFileSync(sb.t('nova-locale.cmd'), corpo);
      const st = await waitFor(() => { const s = status(); return s && s.message === esperado.message ? s : null; }, 5000, 'status ' + esperado.message);
      assert.equal(st.ok, esperado.ok);
      await waitFor(() => !fs.existsSync(sb.t('nova-locale.cmd')) && !fs.existsSync(sb.t('nova-locale.proc')), 3000, 'cmd/proc consumidos');
    };

    await waitFor(() => status(), 4000, 'status de partida');
    assert.deepEqual(status(), { ok: true, message: 'pronto v' + versao });
    assert.equal(linhasLog(), 1);

    await enviar('action=ping\n', { ok: true, message: 'pronto v' + versao });
    assert.equal(linhasLog(), 2, 'o ping tem que registrar uma linha nova no log');
    await enviar('action=foo\n', { ok: false, message: 'acao desconhecida' });
    await enviar('action=apply\ntz=../etc/passwd\n', { ok: false, message: 'fuso invalido' });
    await enviar('action=apply\ntz=America/Nowhere\n', { ok: false, message: 'fuso inexistente' });
    assert.equal(stderr, '', 'o serviço em funcionamento normal não pode escrever no stderr:\n' + stderr);
    console.log('OK 2b: sobe com "pronto v' + versao + '", atende ping, recusa ação desconhecida / fuso inválido / fuso inexistente, stderr vazio');
  } finally {
    filho.kill('SIGKILL');
  }
}

// ── 3. Handshake do Conectar ─────────────────────────────────────────────────
function carregarSetup() {
  const sandbox = {
    module: { exports: {} }, __dirname, Buffer, console, setTimeout, clearTimeout,
    require(nome) {
      if (nome === './node_modules/ssh2') return { Client: class {} };
      if (nome === '../ios-tools') return { tool: (x) => '/bundled/' + x };
      return require(nome);
    },
  };
  vm.runInNewContext(fs.readFileSync(SETUP, 'utf8'), sandbox);
  return sandbox.module.exports;
}

function clienteFalso(respostas) {
  let n = 0;
  const chamadas = [];
  return {
    chamadas,
    exec(cmd, cb) {
      chamadas.push(cmd);
      const out = respostas[Math.min(n++, respostas.length - 1)];
      const stream = new EventEmitter();
      stream.stderr = new EventEmitter();
      stream.close = () => {};
      stream.end = () => setImmediate(() => { stream.emit('data', out); stream.emit('close', 0); });
      cb(null, stream);
    },
  };
}

async function testeHandshake() {
  const mod = carregarSetup();
  assert.ok(mod.__test, 'setup.js tem que expor __test.{localeHelperVersion,waitLocaleHandshake}');
  const { localeHelperVersion, waitLocaleHandshake } = mod.__test;
  const versao = /^HELPER_VERSION=(\d+)/m.exec(src)[1];

  assert.equal(localeHelperVersion(SH), versao);
  const semVersao = path.join(os.tmpdir(), 'nova-locale-sem-versao-' + process.pid + '.sh');
  fs.writeFileSync(semVersao, '#!/bin/sh\nexport PATH=/bin\n');
  assert.equal(localeHelperVersion(semVersao), null);
  fs.rmSync(semVersao);
  assert.equal(localeHelperVersion('/caminho/que/nao/existe.sh'), null);

  const ok = (m) => '{"ok":true,"message":"' + m + '"}\n';
  const rapido = { tries: 3, delayMs: 1 };

  let c = clienteFalso([ok('pronto v' + versao)]);
  assert.equal(await waitLocaleHandshake(c, versao, rapido), true);
  assert.equal(c.chamadas.length, 1);

  c = clienteFalso([ok('pronto')]); // processo antigo ainda vivo: status sem versão
  assert.equal(await waitLocaleHandshake(c, versao, rapido), false);
  assert.equal(c.chamadas.length, 3);

  c = clienteFalso([ok('pronto'), ok('pronto'), ok('pronto v' + versao)]); // sobe no meio da espera
  assert.equal(await waitLocaleHandshake(c, versao, rapido), true);
  assert.equal(c.chamadas.length, 3);

  c = clienteFalso([ok('pronto v' + versao + '0')]); // v20 não vale como v2
  assert.equal(await waitLocaleHandshake(c, versao, rapido), false);

  c = clienteFalso([ok('pronto')]); // script sem versão: nada a conferir
  assert.equal(await waitLocaleHandshake(c, null, rapido), true);
  assert.equal(c.chamadas.length, 0);

  c = clienteFalso([ok('pronto')]);
  await waitLocaleHandshake(c, versao, rapido);
  for (const cmd of c.chamadas) {
    assert.equal(cmd, 'cat /var/tmp/nova-locale-status.json 2>/dev/null || true');
    assert.ok(!/sudo/.test(cmd), 'a conferência não pode usar sudo');
  }

  // O texto fixo "atualizado" só pode sair depois da conferência.
  const fonte = fs.readFileSync(SETUP, 'utf8');
  assert.match(fonte, /await waitLocaleHandshake\(client,locVer\)/);
  assert.doesNotMatch(fonte, /camera\+=' Fuso\/idioma \(nova-locale\) atualizado\.';/);
  console.log('OK 3: handshake do Conectar (versão lida do script, espera o "pronto v' + versao + '", recusa status antigo e v' + versao + '0, só leitura, sem sudo)');
}

(async () => {
  testeEstatico();
  const sb = criarSandbox();
  try {
    testeGuardaSleepETrim(sb);
    await testeFluxoNormal(sb);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
  await testeHandshake();
  console.log('TODOS OS TESTES DO HELPER NOVA-LOCALE PASSARAM');
})().catch((e) => { console.error('FALHOU:', e && e.stack || e); process.exit(1); });
