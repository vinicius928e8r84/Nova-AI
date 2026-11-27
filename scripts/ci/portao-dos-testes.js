'use strict';

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { casa, casaAlgum, extensaoDe } = require('../regras/globs');

const RAIZ = path.join(__dirname, '..', '..');
const ARQUIVO_DA_LISTA = path.join(__dirname, 'portao-dos-testes.json');
const EXTENSOES_DE_CODIGO = new Set(['js', 'cjs', 'mjs', 'ts', 'py', 'sh', 'm']);
const PASTAS_DE_TESTE = new Set(['test', 'tests', 'teste', 'testes']);
const NOME_DE_TESTE = /(?:\.(?:test|spec)\.[A-Za-z0-9]+$|^teste?-|^test_|_test\.[A-Za-z0-9]+$)/;

const AJUDA = `uso: node scripts/ci/portao-dos-testes.js --job <nome> [--listar]

Roda com node --test os arquivos de cada grupo da lista scripts/ci/portao-dos-testes.json cujo job é <nome>.
Com --listar só mostra os grupos e os arquivos. Sai com 1 se um grupo falhar ou não achar arquivo nenhum.`;

function carregarLista() {
  return JSON.parse(fs.readFileSync(ARQUIVO_DA_LISTA, 'utf8'));
}

function arquivosDoRepositorio(raiz = RAIZ) {
  const saida = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return saida.split('\0').filter(caminho => caminho && fs.existsSync(path.join(raiz, caminho)));
}

function eArquivoDeTeste(caminho) {
  const partes = caminho.split('/');
  const nome = partes.pop();
  if (!EXTENSOES_DE_CODIGO.has(extensaoDe(nome)) || partes.includes('fixtures')) return false;
  return NOME_DE_TESTE.test(nome) || partes.some(pasta => PASTAS_DE_TESTE.has(pasta));
}

const arquivosDeTeste = arquivos => arquivos.filter(eArquivoDeTeste);

const globsDe = lugar => lugar.arquivos || [];
const lugaresDe = lista => [...lista.grupos.map(grupo => ({ tipo: 'grupo', nome: grupo.nome, lugar: grupo })), ...lista.fora.map(fora => ({ tipo: 'fora', nome: 'fora', lugar: fora }))];

function problemasDeGrupo(grupos) {
  const vistos = new Set();
  const problemas = [];
  for (const grupo of grupos) {
    if (!grupo.nome) problemas.push('há um grupo sem nome');
    else if (vistos.has(grupo.nome)) problemas.push(`o grupo ${grupo.nome} está repetido`);
    if (!grupo.job) problemas.push(`o grupo ${grupo.nome} está sem job`);
    vistos.add(grupo.nome);
  }
  return problemas;
}

function problemasDeFora(fora) {
  return fora.filter(entrada => !(entrada.motivo || '').trim()).map(entrada => `a entrada de fora ${globsDe(entrada).join(', ')} está sem motivo`);
}

function problemasDeGlob(lista, arquivos) {
  const problemas = [];
  for (const { lugar } of lugaresDe(lista)) {
    for (const glob of globsDe(lugar)) {
      if (!arquivos.some(arquivo => casa(glob, arquivo))) problemas.push(`o glob ${glob} não casa nenhum arquivo: apague a entrada ou corrija o caminho`);
    }
  }
  return problemas;
}

function problemasDeLugar(lista, arquivos) {
  const lugares = lugaresDe(lista);
  const problemas = [];
  for (const arquivo of arquivosDeTeste(arquivos)) {
    const onde = lugares.filter(({ lugar }) => casaAlgum(globsDe(lugar), arquivo));
    if (onde.length === 0) problemas.push(`${arquivo} não está em nenhum grupo nem na lista de fora: ponha num grupo de scripts/ci/portao-dos-testes.json ou em fora, com o motivo`);
    if (onde.length > 1) problemas.push(`${arquivo} está em mais de um lugar da lista: ${onde.map(item => item.nome).join(', ')}`);
  }
  return problemas;
}

function conferir(lista, arquivos) {
  return [...problemasDeGrupo(lista.grupos), ...problemasDeFora(lista.fora), ...problemasDeGlob(lista, arquivos), ...problemasDeLugar(lista, arquivos)];
}

const arquivosDoGrupo = (grupo, arquivos) => arquivos.filter(arquivo => casaAlgum(globsDe(grupo), arquivo)).sort();

const arquivosDoJob = (lista, job, arquivos) => lista.grupos.filter(grupo => grupo.job === job).map(grupo => [grupo.nome, arquivosDoGrupo(grupo, arquivos)]);

function rodarGrupos(grupos, rodar, escrever) {
  let falhou = false;
  for (const [nome, arquivos] of grupos) {
    escrever(`\n=== grupo ${nome}: ${arquivos.length} arquivo(s) ===\n`);
    if (arquivos.length === 0) {
      escrever(`o grupo ${nome} não achou arquivo nenhum: falha em vez de passar vazio\n`);
      falhou = true;
    } else if (rodar(arquivos) !== 0) {
      falhou = true;
    }
  }
  return falhou ? 1 : 0;
}

const rodarComNode = arquivos => spawnSync(process.execPath, ['--test', ...arquivos], { cwd: RAIZ, stdio: 'inherit' }).status;

function listar(grupos, escrever) {
  for (const [nome, arquivos] of grupos) escrever(`${nome}\n${arquivos.map(arquivo => `  ${arquivo}\n`).join('')}`);
  return 0;
}

function valorDe(args, opcao) {
  const i = args.indexOf(opcao);
  return i >= 0 ? args[i + 1] : undefined;
}

function principal(args) {
  const job = valorDe(args, '--job');
  if (!job || args.includes('--help')) {
    process.stdout.write(`${AJUDA}\n`);
    return job ? 0 : 1;
  }
  const grupos = arquivosDoJob(carregarLista(), job, arquivosDoRepositorio());
  if (grupos.length === 0) {
    process.stderr.write(`a lista não tem nenhum grupo para o job ${job}\n`);
    return 1;
  }
  const escrever = texto => process.stdout.write(texto);
  return args.includes('--listar') ? listar(grupos, escrever) : rodarGrupos(grupos, rodarComNode, escrever);
}

if (require.main === module) process.exitCode = principal(process.argv.slice(2));

module.exports = { carregarLista, arquivosDoRepositorio, arquivosDeTeste, conferir, arquivosDoGrupo, arquivosDoJob, rodarGrupos };
