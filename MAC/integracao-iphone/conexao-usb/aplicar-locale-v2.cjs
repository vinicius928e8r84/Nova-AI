#!/usr/bin/env node
'use strict';
// Aplica o helper nova-locale v2 no app instalado: troca nova-locale.sh e acrescenta ao setup.js
// o handshake de versão do Conectar.
//
// O setup.js do app instalado NÃO é igual ao do repositório (ex.: ele tem o `iproxy -u <udid>`),
// por isso este script NÃO copia o arquivo do repo: faz 3 substituições ancoradas, cada âncora
// tem que aparecer exatamente 1 vez, e o texto novo vem do setup.js deste repositório.
//
// Padrão = simulação (não grava nada). Para gravar:
//   node aplicar-locale-v2.cjs --aplicar
// Outro destino (teste em cópia):
//   node aplicar-locale-v2.cjs --app /caminho/da/pasta/iphone-setup [--aplicar]
//
// Antes de gravar, guarda cada arquivo como <arquivo>.bak-locale-v2-<data-hora>. Depois de gravar,
// roda `node --check` no setup.js e `bash -n` no nova-locale.sh e desfaz tudo se algum falhar.
// Depois de aplicar: feche e abra o Nova (o setup.js fica em cache) e use Conectar uma vez.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const APP_PADRAO = '/Applications/Nova AI Mac.app/Contents/Resources/app/electron/services/iphone-setup';
const ANCORA_PREPARE = 'async function prepare(id,password,service){';
const ANCORA_MENSAGEM = "   camera+=' Fuso/idioma (nova-locale) atualizado.';";
const ANCORA_EXPORTS = 'module.exports={prepare,prompt};';

// Tira do setup.js novo (deste repo) os três pedaços que entram no do app.
function extrair(novo) {
  const iniA = novo.indexOf('// Versão do helper nova-locale');
  const fimA = novo.indexOf(ANCORA_PREPARE);
  const iniB = novo.indexOf('   // Confere o reinício antes de dizer "atualizado"');
  const linhaB = iniB < 0 ? -1 : novo.indexOf('   camera+=(await waitLocaleHandshake', iniB);
  const fimB = linhaB < 0 ? -1 : novo.indexOf('\n', linhaB);
  const exportsNovo = /^module\.exports=\{prepare,prompt,__test:.*\};$/m.exec(novo);
  if (iniA < 0 || fimA < iniA || iniB < 0 || fimB < 0 || !exportsNovo) {
    throw new Error('o setup.js deste repositório não tem os trechos esperados do handshake (helpers, mensagem, exports)');
  }
  return { helpers: novo.slice(iniA, fimA), mensagem: novo.slice(iniB, fimB), exports: exportsNovo[0] };
}

function transformarSetup(antigo, novo) {
  if (antigo.includes('waitLocaleHandshake')) return { texto: antigo, trocas: 0 };
  const p = extrair(novo);
  for (const [nome, ancora] of [['prepare', ANCORA_PREPARE], ['mensagem', ANCORA_MENSAGEM], ['exports', ANCORA_EXPORTS]]) {
    const n = antigo.split(ancora).length - 1;
    if (n !== 1) throw new Error('âncora "' + nome + '" aparece ' + n + 'x no setup.js do app (esperado 1x); nada foi alterado');
  }
  let texto = antigo.replace(ANCORA_PREPARE, () => p.helpers + ANCORA_PREPARE);
  texto = texto.replace(ANCORA_MENSAGEM, () => p.mensagem);
  texto = texto.replace(ANCORA_EXPORTS, () => p.exports);
  return { texto, trocas: 3 };
}

function carimbo() {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds());
}

function principal(argv) {
  const aplicar = argv.includes('--aplicar');
  const i = argv.indexOf('--app');
  const app = i >= 0 ? argv[i + 1] : APP_PADRAO;
  if (!app || !fs.existsSync(path.join(app, 'setup.js'))) throw new Error('pasta do app sem setup.js: ' + app);

  const novoSetup = fs.readFileSync(path.join(__dirname, 'setup.js'), 'utf8');
  const novoSh = fs.readFileSync(path.join(__dirname, 'nova-locale.sh'), 'utf8');
  const arqSetup = path.join(app, 'setup.js');
  const arqSh = path.join(app, 'nova-locale.sh');
  const antigoSetup = fs.readFileSync(arqSetup, 'utf8');
  const antigoSh = fs.existsSync(arqSh) ? fs.readFileSync(arqSh, 'utf8') : null;

  const setup = transformarSetup(antigoSetup, novoSetup);
  const mudaSh = antigoSh !== novoSh;
  console.log((aplicar ? 'APLICANDO' : 'SIMULAÇÃO (nada será gravado; use --aplicar)') + ' em ' + app);
  console.log('- setup.js: ' + (setup.trocas ? setup.trocas + ' trocas ancoradas (handshake de versão no Conectar)' : 'já tem o handshake — nada a fazer'));
  console.log('- nova-locale.sh: ' + (mudaSh ? 'será substituído pela v2 do repositório' : 'já é a v2 — nada a fazer'));
  if (!setup.trocas && !mudaSh) return 0;
  if (!aplicar) return 0;

  const ts = carimbo();
  const feitos = [];
  const desfazer = () => { for (const f of feitos.reverse()) fs.copyFileSync(f.bak, f.alvo); };
  try {
    if (setup.trocas) {
      const bak = arqSetup + '.bak-locale-v2-' + ts;
      fs.copyFileSync(arqSetup, bak); feitos.push({ alvo: arqSetup, bak });
      fs.writeFileSync(arqSetup, setup.texto);
      const r = spawnSync(process.execPath, ['--check', arqSetup], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('node --check falhou no setup.js novo:\n' + r.stderr);
    }
    if (mudaSh) {
      if (antigoSh !== null) { const bak = arqSh + '.bak-locale-v2-' + ts; fs.copyFileSync(arqSh, bak); feitos.push({ alvo: arqSh, bak }); }
      fs.writeFileSync(arqSh, novoSh, { mode: 0o755 });
      fs.chmodSync(arqSh, 0o755);
      const r = spawnSync('bash', ['-n', arqSh], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('bash -n falhou no nova-locale.sh novo:\n' + r.stderr);
    }
  } catch (e) {
    desfazer();
    console.error('FALHOU e foi desfeito (arquivos antigos restaurados): ' + e.message);
    return 1;
  }
  console.log('OK. Backups: *.bak-locale-v2-' + ts + '. Feche e abra o Nova e use Conectar uma vez (senha do iPhone).');
  return 0;
}

if (require.main === module) {
  try { process.exitCode = principal(process.argv.slice(2)); } catch (e) { console.error('ERRO: ' + e.message); process.exitCode = 1; }
}
module.exports = { transformarSetup, extrair };
