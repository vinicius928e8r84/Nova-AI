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

const RAIZ_DO_REPOSITORIO = path.resolve(__dirname, '..', '..');

function lerBandeira(opcoes, argv, i) {
  const bandeira = argv[i];
  if (bandeira === '--help') opcoes.ajuda = true;
  else if (bandeira === '--base') opcoes.pedida = argv[i + 1];
  else if (bandeira === '--raiz') opcoes.raiz = path.resolve(argv[i + 1]);
  else throw new ErroDeUso(`bandeira desconhecida: ${bandeira}`);
  return bandeira === '--base' || bandeira === '--raiz' ? i + 2 : i + 1;
}

function lerArgumentos(argv) {
  const opcoes = { pedida: null, raiz: RAIZ_DO_REPOSITORIO, ajuda: false };
  for (let i = 0; i < argv.length && !opcoes.ajuda;) i = lerBandeira(opcoes, argv, i);
  return opcoes;
}

const ehTravaMudada = item => item.status !== 'D' && path.basename(item.caminho) === 'package-lock.json';

function auditarABase(raiz, base, item, destino) {
  const pastaAntiga = item.antigo ? path.dirname(item.antigo) : path.dirname(item.caminho);
  const lockAntigo = arquivoNaBase(raiz, base.desde, item.antigo || item.caminho);
  const jsonAntigo = arquivoNaBase(raiz, base.desde, path.posix.join(pastaAntiga, 'package.json'));
  if (!lockAntigo || !jsonAntigo) return null;
  gravarProjeto(destino, jsonAntigo, lockAntigo);
  return auditar(destino);
}

function novasDaTrava(raiz, base, item, destinos) {
  gravarProjeto(destinos.ramo, fs.readFileSync(path.join(raiz, path.dirname(item.caminho), 'package.json'), 'utf8'), fs.readFileSync(path.join(raiz, item.caminho), 'utf8'));
  const daBase = auditarABase(raiz, base, item, destinos.base);
  return novasAltas(daBase, auditar(destinos.ramo)).map(achado => ({ ...achado, trava: item.caminho }));
}

function auditarTravas(raiz, base, travas) {
  const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'auditoria-'));
  const novas = travas.flatMap((item, indice) => novasDaTrava(raiz, base, item, {
    ramo: path.join(temporario, `ramo-${indice}`),
    base: path.join(temporario, `base-${indice}`),
  }));
  fs.rmSync(temporario, { recursive: true, force: true });
  return novas;
}

function descreverAchado(achado) {
  const intervalo = achado.intervalo ? `, ${achado.intervalo}` : '';
  return `✗ ${achado.trava}: ${achado.nome} (${achado.severidade}${intervalo}) ${achado.titulos.join('; ')}`;
}

function relatarNovas(novas) {
  for (const achado of novas) console.log(descreverAchado(achado));
  console.log('Conserto: atualize ou troque o pacote para uma versão sem a falha (npm audit mostra qual); a mudança não pode introduzir vulnerabilidade alta ou crítica.');
  return 1;
}

function relatarSemNovas(travas) {
  console.log(`auditoria ok: ${travas.map(t => t.caminho).join(', ')} não introduz vulnerabilidade ${configuracao.auditoria.nivelMinimo.join('/')}`);
  return 0;
}

function main(argv, env = process.env) {
  const opcoes = lerArgumentos(argv);
  if (opcoes.ajuda) {
    console.log(AJUDA);
    return 0;
  }
  const base = resolverBase(opcoes.raiz, opcoes.pedida, env);
  if (!base) {
    console.log('aviso: sem base de comparação; nada foi auditado');
    return 0;
  }
  const travas = lerMudancas(opcoes.raiz, base).itens.filter(ehTravaMudada);
  if (!travas.length) {
    console.log('auditoria: nenhuma trava de pacotes mudou; nada a auditar');
    return 0;
  }
  const novas = auditarTravas(opcoes.raiz, base, travas);
  return novas.length ? relatarNovas(novas) : relatarSemNovas(travas);
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
