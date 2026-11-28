'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { casa, casaAlgum, extensaoDe } = require('../globs');
const { criar } = require('./auxiliar');

const RAIZ = path.join(__dirname, '..', '..', '..');
const LISTA = 'docs/codescene-exclusoes.md';
const PREFIXO = 'Nova-AI/';
const ANALISADAS = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'c', 'cc', 'cpp', 'h', 'hpp', 'm', 'mm', 'swift', 'java', 'kt', 'go', 'rs', 'rb']);

const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'scripts/regras/configuracao.json'), 'utf8'));
const isentoNasRegras = caminho => casaAlgum(config.ignorarCodigo, caminho);

function exclusoesDoCodeScene() {
  const texto = fs.readFileSync(path.join(RAIZ, LISTA), 'utf8');
  const bloco = /```text\n([\s\S]*?)```/.exec(texto);
  assert.ok(bloco, `${LISTA} precisa de um bloco \`\`\`text com a lista`);
  return bloco[1].split('\n').map(linha => linha.trim()).filter(Boolean).map(linha => {
    assert.ok(linha.startsWith(PREFIXO), `${LISTA}: "${linha}" precisa começar com ${PREFIXO}`);
    return linha.slice(PREFIXO.length);
  });
}

function filtroPorExtensao() {
  const texto = fs.readFileSync(path.join(RAIZ, LISTA), 'utf8');
  const secao = /## Filtro por extensão[\s\S]*?```text\n([\s\S]*?)```/.exec(texto);
  assert.ok(secao, `${LISTA} precisa de um bloco \`\`\`text na seção "Filtro por extensão"`);
  return secao[1].split('\n').map(linha => linha.trim()).filter(Boolean);
}

const exclusoes = exclusoesDoCodeScene();
const excluidoNoCodeScene = caminho => exclusoes.some(glob => casa(glob, caminho));
const versionados = execFileSync('git', ['ls-files', '-z'], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(Boolean);

test('o que o CodeScene não analisa as regras também isentam', () => {
  const soNoCodeScene = versionados.filter(caminho => excluidoNoCodeScene(caminho) && !isentoNasRegras(caminho));
  assert.deepEqual(soNoCodeScene, [], `fora da análise do CodeScene mas cobrados pelas regras: ponha em ignorarCodigo ou tire de ${LISTA}`);
});

test('o código que as regras isentam o CodeScene também não analisa', () => {
  const soNasRegras = versionados.filter(caminho => ANALISADAS.has(extensaoDe(caminho)) && isentoNasRegras(caminho) && !excluidoNoCodeScene(caminho));
  assert.deepEqual(soNasRegras, [], `isentos nas regras mas analisados pelo CodeScene: ponha em ${LISTA} ou tire de ignorarCodigo`);
});

test('toda linha da lista do CodeScene casa com algum arquivo', () => {
  const vazias = exclusoes.filter(glob => !versionados.some(caminho => casa(glob, caminho)));
  assert.deepEqual(vazias, [], `linhas de ${LISTA} que não casam com nada: tire-as`);
});

test('o filtro por extensão do painel não esconde código que o painel analisa', () => {
  const filtro = filtroPorExtensao();
  assert.ok(filtro.length > 0, 'o filtro por extensão não pode ficar vazio sem decisão');
  const escondidas = filtro.filter(padrao => /^\*\.[^.*/]+$/.test(padrao) && ANALISADAS.has(padrao.slice(2)));
  assert.deepEqual(escondidas, [], `extensões de código no filtro do painel de ${LISTA}: tire-as`);
  assert.equal(filtro.includes('*.h'), false, 'o *.h saiu do filtro para o painel dar nota aos .h (#231)');
});

test('app/dist/ fora de assets/ é cobrado; o bundle e os terceiros de assets/ não', () => {
  for (const caminho of ['app/dist/cam-live.js', 'app/dist/cam-live-audio.js', 'app/dist/index.html']) {
    assert.equal(isentoNasRegras(caminho), false, caminho);
    assert.equal(excluidoNoCodeScene(caminho), false, caminho);
  }
  for (const caminho of ['app/dist/assets/index-Dun7lr2S.js', 'app/dist/assets/face-api.esm-DMaQY5kn.js', 'app/dist/assets/face_mesh-Bk5gcn-i.js']) {
    assert.equal(isentoNasRegras(caminho), true, caminho);
    assert.equal(excluidoNoCodeScene(caminho), true, caminho);
  }
});

test('comentário novo em app/dist/cam-live.js falha; em app/dist/assets/ passa', () => {
  const repo = criar();
  repo.escrever({ 'app/dist/cam-live.js': '// por que\n', 'app/dist/assets/a.js': '// por que\n' });
  const r = repo.rodar('--regra', 'sem-comentario-novo');
  repo.limpar();
  assert.equal(r.codigo, 1, r.saida);
  assert.ok(r.saida.includes('app/dist/cam-live.js'), r.saida);
  assert.ok(!r.saida.includes('app/dist/assets/a.js'), r.saida);
});
