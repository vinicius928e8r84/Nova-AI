'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verificar } = require('../regra-sintaxe');

const ARQUIVOS = {
  'app/cjs.js': 'module.exports = 1;\n',
  'app/modulo.js': 'import x from "y";\nexport default x;\n',
  'app/espera.mjs': 'await Promise.resolve(1);\n',
  'app/quebrado.cjs': 'const a = ;\n',
  'app/quebrado.mjs': 'export const = 1;\n',
  'app/vazio.js': '',
  'app/ok.py': 'x = 1\n',
  'app/quebrado.py': 'def f(:\n',
  'app/ok.sh': 'echo oi\n',
  'app/quebrado.bash': 'if true; then\n',
  'app/quebrado.command': 'case x in\n',
  'app/ok.json': '{"a": 1}\n',
  'app/quebrado.json': '{"a": }\n',
  'app/leia.md': 'const a = ;\n',
  'app/coisa.constructor': 'const a = ;\n',
  'app/apagado.js': 'const a = ;\n',
  'app/copia.js': 'const a = ;\n',
  'app/dist/assets/bundle.js': 'const a = ;\n',
  'app/sumiu.js': null,
  'app/imagem.json': { binario: true },
};

function ctxDe(lidos, avisos) {
  return {
    arquivos: Object.keys(ARQUIVOS).map(caminho => ({ caminho, status: caminho === 'app/apagado.js' ? 'D' : 'M' })),
    mudancas: { copias: new Set(['app/copia.js']) },
    config: { ignorarCodigo: ['app/dist/assets/**'] },
    ler(caminho) {
      lidos.push(caminho);
      const conteudo = ARQUIVOS[caminho];
      if (typeof conteudo === 'string') return { texto: conteudo, binario: false };
      return conteudo;
    },
    aviso: mensagem => avisos.push(mensagem),
  };
}

function rodarCom(path) {
  const anterior = process.env.PATH;
  process.env.PATH = path;
  const lidos = [];
  const avisos = [];
  try {
    return { achados: verificar(ctxDe(lidos, avisos)), avisos, lidos };
  } finally {
    process.env.PATH = anterior;
  }
}

function erroDoJson(texto) {
  try {
    JSON.parse(texto);
    return null;
  } catch (erro) {
    return erro.message;
  }
}

const LIDOS = Object.keys(ARQUIVOS).filter(caminho => !['app/apagado.js', 'app/copia.js', 'app/dist/assets/bundle.js'].includes(caminho));

test('sintaxe: achados em ordem, só o que muda, cada interpretador pela extensão', () => {
  const { achados, avisos, lidos } = rodarCom(process.env.PATH);
  assert.deepEqual(lidos, LIDOS);
  assert.deepEqual(avisos, []);
  assert.deepEqual(achados.map(achado => achado.arquivo), ['app/quebrado.cjs', 'app/quebrado.mjs', 'app/quebrado.py', 'app/quebrado.bash', 'app/quebrado.command', 'app/quebrado.json']);
  assert.equal(achados[0].detalhe, "SyntaxError: Unexpected token ';'");
  assert.equal(achados[1].detalhe, "SyntaxError: Unexpected token 'export'");
  assert.match(achados[2].detalhe, /SyntaxError/);
  assert.match(achados[3].detalhe, /error/);
  assert.match(achados[4].detalhe, /error/);
  assert.equal(achados[5].detalhe, erroDoJson(ARQUIVOS['app/quebrado.json']));
});

test('sintaxe: sem python3 nem bash no PATH vira aviso, e JS e JSON continuam conferidos', () => {
  const { achados, avisos } = rodarCom('');
  assert.deepEqual(avisos, ['ok.py', 'quebrado.py', 'ok.sh', 'quebrado.bash', 'quebrado.command']
    .map(nome => `app/${nome}: interpretador ausente, sintaxe não conferida`));
  assert.deepEqual(achados.map(achado => achado.arquivo), ['app/quebrado.cjs', 'app/quebrado.mjs', 'app/quebrado.json']);
});
