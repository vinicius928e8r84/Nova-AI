#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ErroDeUso, arquivoNaBase, lerMudancas, resolverBase } = require('./git');

const configuracao = JSON.parse(fs.readFileSync(path.join(__dirname, 'configuracao.json'), 'utf8'));

const AJUDA = `uso: node scripts/regras/auditoria.js [--base <ref>] [--raiz <pasta>]

Roda \`npm audit --omit=dev\` nas travas de pacotes (package-lock.json) que a mudança tocou, no ramo e na base, e falha só
por vulnerabilidade de severidade ${configuracao.auditoria.nivelMinimo.join(' ou ')} que a mudança introduz (que a base não tinha).
Vulnerabilidade antiga não falha. Precisa de rede para o registro do npm; se o registro não responde, falha (rode de novo).`;

function novasAltas(base, ramo, niveis = configuracao.auditoria.nivelMinimo) {
  const altas = vulnerabilidades => Object.entries((vulnerabilidades && vulnerabilidades.vulnerabilities) || {})
    .filter(([, v]) => niveis.includes(v.severity));
  const antes = new Map(altas(base));
  return altas(ramo).filter(([nome]) => !antes.has(nome)).map(([nome, v]) => ({
    nome,
    severidade: v.severity,
    intervalo: v.range,
    titulos: (v.via || []).filter(x => typeof x === 'object').map(x => x.title).filter(Boolean).slice(0, 3),
  }));
}

function auditar(pasta) {
  const resultado = spawnSync('npm', ['audit', '--json', '--package-lock-only', '--omit=dev'], { cwd: pasta, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let json;
  try {
    json = JSON.parse(resultado.stdout);
  } catch {
    throw new Error(`o npm audit não produziu JSON em ${pasta}: ${String(resultado.stderr).split('\n')[0]}`);
  }
  if (json.error) throw new Error(`o npm audit falhou: ${json.error.summary || json.error.code}`);
  return json;
}

function gravarProjeto(destino, packageJson, lock) {
  fs.mkdirSync(destino, { recursive: true });
  fs.writeFileSync(path.join(destino, 'package.json'), packageJson);
  fs.writeFileSync(path.join(destino, 'package-lock.json'), lock);
}

function main(argv, env = process.env) {
  let pedida = null;
  let raiz = path.resolve(__dirname, '..', '..');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') {
      console.log(AJUDA);
      return 0;
    }
    if (argv[i] === '--base') pedida = argv[++i];
    else if (argv[i] === '--raiz') raiz = path.resolve(argv[++i]);
    else throw new ErroDeUso(`bandeira desconhecida: ${argv[i]}`);
  }
  const base = resolverBase(raiz, pedida, env);
  if (!base) {
    console.log('aviso: sem base de comparação; nada foi auditado');
    return 0;
  }
  const mudancas = lerMudancas(raiz, base);
  const travas = mudancas.itens.filter(item => item.status !== 'D' && path.basename(item.caminho) === 'package-lock.json');
  if (!travas.length) {
    console.log('auditoria: nenhuma trava de pacotes mudou; nada a auditar');
    return 0;
  }
  const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'auditoria-'));
  const novas = [];
  for (const [indice, item] of travas.entries()) {
    const pasta = path.dirname(item.caminho);
    const doRamo = path.join(temporario, `ramo-${indice}`);
    const daBase = path.join(temporario, `base-${indice}`);
    gravarProjeto(doRamo, fs.readFileSync(path.join(raiz, pasta, 'package.json'), 'utf8'), fs.readFileSync(path.join(raiz, item.caminho), 'utf8'));
    const lockAntigo = arquivoNaBase(raiz, base.desde, item.antigo || item.caminho);
    const jsonAntigo = arquivoNaBase(raiz, base.desde, path.posix.join(item.antigo ? path.dirname(item.antigo) : pasta, 'package.json'));
    const sobre = lockAntigo && jsonAntigo ? auditar((gravarProjeto(daBase, jsonAntigo, lockAntigo), daBase)) : null;
    for (const achado of novasAltas(sobre, auditar(doRamo))) novas.push({ ...achado, trava: item.caminho });
  }
  fs.rmSync(temporario, { recursive: true, force: true });
  if (!novas.length) {
    console.log(`auditoria ok: ${travas.map(t => t.caminho).join(', ')} não introduz vulnerabilidade ${configuracao.auditoria.nivelMinimo.join('/')}`);
    return 0;
  }
  for (const achado of novas) {
    console.log(`✗ ${achado.trava}: ${achado.nome} (${achado.severidade}${achado.intervalo ? `, ${achado.intervalo}` : ''}) ${achado.titulos.join('; ')}`);
  }
  console.log('Conserto: atualize ou troque o pacote para uma versão sem a falha (npm audit mostra qual); a mudança não pode introduzir vulnerabilidade alta ou crítica.');
  return 1;
}

function rodar(argv) {
  try {
    return main(argv);
  } catch (erro) {
    console.log(`error: ${erro.message}`);
    return erro instanceof ErroDeUso ? 2 : 1;
  }
}

module.exports = { novasAltas, main, rodar };

if (require.main === module) process.exitCode = rodar(process.argv.slice(2));
