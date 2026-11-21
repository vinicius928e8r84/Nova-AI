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

const RAIZ_DO_REPOSITORIO = path.resolve(__dirname, '..', '..');

const vulnerabilidadesAltas = (auditoria, niveis) => Object.entries((auditoria && auditoria.vulnerabilities) || {})
  .filter(([, v]) => niveis.includes(v.severity));

const titulosDe = vulnerabilidade => (vulnerabilidade.via || []).filter(x => typeof x === 'object').map(x => x.title).filter(Boolean).slice(0, 3);

function novasAltas(base, ramo, niveis = configuracao.auditoria.nivelMinimo) {
  const antes = new Map(vulnerabilidadesAltas(base, niveis));
  return vulnerabilidadesAltas(ramo, niveis).filter(([nome]) => !antes.has(nome)).map(([nome, v]) => ({
    nome,
    severidade: v.severity,
    intervalo: v.range,
    titulos: titulosDe(v),
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

class AuditoriaDasTravas {
  constructor(raiz, desde, temporario) {
    this.raiz = raiz;
    this.desde = desde;
    this.temporario = temporario;
  }

  novasDaTrava(item, indice) {
    const doRamo = this.gravarRamo(item, indice);
    const daBase = this.auditarBase(item, indice);
    return novasAltas(daBase, auditar(doRamo)).map(achado => ({ ...achado, trava: item.caminho }));
  }

  gravarRamo(item, indice) {
    const destino = path.join(this.temporario, `ramo-${indice}`);
    const packageJson = fs.readFileSync(path.join(this.raiz, path.dirname(item.caminho), 'package.json'), 'utf8');
    gravarProjeto(destino, packageJson, fs.readFileSync(path.join(this.raiz, item.caminho), 'utf8'));
    return destino;
  }

  auditarBase(item, indice) {
    const origem = item.antigo || item.caminho;
    const lock = arquivoNaBase(this.raiz, this.desde, origem);
    const packageJson = arquivoNaBase(this.raiz, this.desde, path.posix.join(path.dirname(origem), 'package.json'));
    if (!lock || !packageJson) return null;
    const destino = path.join(this.temporario, `base-${indice}`);
    gravarProjeto(destino, packageJson, lock);
    return auditar(destino);
  }
}

function auditarTravas(raiz, base, travas) {
  const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'auditoria-'));
  const auditoria = new AuditoriaDasTravas(raiz, base.desde, temporario);
  const novas = travas.flatMap((item, indice) => auditoria.novasDaTrava(item, indice));
  fs.rmSync(temporario, { recursive: true, force: true });
  return novas;
}

const BANDEIRAS = new Map([
  ['--base', (pedido, valor) => ({ ...pedido, pedida: valor })],
  ['--raiz', (pedido, valor) => ({ ...pedido, raiz: path.resolve(valor) })],
]);

function lerArgumentos(argv) {
  let pedido = { ajuda: false, pedida: null, raiz: RAIZ_DO_REPOSITORIO };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') return { ...pedido, ajuda: true };
    if (!BANDEIRAS.has(argv[i])) throw new ErroDeUso(`bandeira desconhecida: ${argv[i]}`);
    pedido = BANDEIRAS.get(argv[i])(pedido, argv[++i]);
  }
  return pedido;
}

const ehTravaQueFicou = item => item.status !== 'D' && path.basename(item.caminho) === 'package-lock.json';

const linhaDoAchado = achado => `✗ ${achado.trava}: ${achado.nome} (${achado.severidade}${achado.intervalo ? `, ${achado.intervalo}` : ''}) ${achado.titulos.join('; ')}`;

function relatar(travas, novas) {
  if (!novas.length) {
    console.log(`auditoria ok: ${travas.map(t => t.caminho).join(', ')} não introduz vulnerabilidade ${configuracao.auditoria.nivelMinimo.join('/')}`);
    return 0;
  }
  for (const achado of novas) console.log(linhaDoAchado(achado));
  console.log('Conserto: atualize ou troque o pacote para uma versão sem a falha (npm audit mostra qual); a mudança não pode introduzir vulnerabilidade alta ou crítica.');
  return 1;
}

function main(argv, env = process.env) {
  const { ajuda, pedida, raiz } = lerArgumentos(argv);
  if (ajuda) {
    console.log(AJUDA);
    return 0;
  }
  const base = resolverBase(raiz, pedida, env);
  if (!base) {
    console.log('aviso: sem base de comparação; nada foi auditado');
    return 0;
  }
  const travas = lerMudancas(raiz, base).itens.filter(ehTravaQueFicou);
  if (!travas.length) {
    console.log('auditoria: nenhuma trava de pacotes mudou; nada a auditar');
    return 0;
  }
  return relatar(travas, auditarTravas(raiz, base, travas));
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
