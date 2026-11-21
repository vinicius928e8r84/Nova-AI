'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { verificar } = require('../regra-comentario');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'configuracao.json'), 'utf8'));
const B = '#';
const BB = '//';

const JS = [
  '#!/usr/bin/env node',
  `${BB} SPDX-License-Identifier: MIT`,
  `const a = 1; ${BB} @ts-ignore`,
  `${BB} prettier-ignore`,
  `${BB} Copyright 2024 Fulano`,
  `${BB} Copyright 2024 Fulano`,
  `const b = 2; ${BB} comentário curto`,
  `${BB} ${'x'.repeat(70)}`,
  `${BB} ${'y'.repeat(71)}`,
  `${BB}`,
  `/* bloco ${'z'.repeat(80)} */`,
  `${BB} antigo, linha não tocada`,
].join('\n');

const PY = [
  '"""Docstring do módulo."""',
  `import os  ${B} comentário`,
  'def f():',
  '    """',
  '    linha da doc',
  '    """',
  '    return os',
  'class C:',
  `    """Doc da classe."""  ${B} e comentário`,
  'def g():',
  '    """doc de g"""',
  `x = 1  ${B} noqa: E501`,
  `${B} -*- coding: utf-8 -*-`,
].join('\n');

const SH = `#!/bin/bash\necho oi ${B} comentário\n${B}!/bin/sh no meio\n`;

const ARQUIVOS = {
  'app/a.js': { texto: JS, novas: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  'app/b.py': { texto: PY, novas: [1, 2, 5, 6, 9, 12, 13] },
  'app/c.py': { texto: PY, novas: [4] },
  'app/parece-python.js': { texto: '"""doc"""\n', novas: [1] },
  'app/quebrado.py': { texto: `def (:\n    """doc"""  ${B} nota\n`, novas: [2] },
  'scripts/roda': { texto: SH, novas: [1, 2, 3] },
  'scripts/sem-shebang': { texto: `echo ${B} nada\n`, novas: [1] },
  'app/dist/assets/bundle.js': { texto: `${BB} isento\n`, novas: [1] },
  'app/leia.md': { texto: `${BB} markdown\n`, novas: [1] },
  'app/estilo.css': { texto: 'a { color: red; } /* cor */\n', novas: [1] },
  'app/sem-novas.js': { texto: `${BB} x\n`, novas: [] },
  'app/fora-do-mapa.js': { texto: `${BB} x\n` },
  'app/binario.js': { binario: true, novas: [1] },
  'app/sumiu.js': { sumiu: true, novas: [1] },
};

function ctxDe(lidos) {
  return {
    config,
    arquivos: Object.keys(ARQUIVOS).map(caminho => ({ caminho, status: 'M' })),
    mudancas: { acrescentadas: new Map(Object.entries(ARQUIVOS).filter(([, a]) => a.novas).map(([caminho, a]) => [caminho, new Set(a.novas)])) },
    ler(caminho) {
      lidos.push(caminho);
      const arquivo = ARQUIVOS[caminho];
      if (arquivo.sumiu) return null;
      return arquivo.binario ? { binario: true } : { binario: false, texto: arquivo.texto };
    },
  };
}

test('comentário: achados por linha nova, permitidas de fora, texto cortado em 70 e docstring nova do Python', () => {
  const lidos = [];
  const achados = verificar(ctxDe(lidos)).map(({ arquivo, linha, detalhe }) => `${arquivo}:${linha} ${detalhe}`);
  assert.deepEqual(lidos, Object.keys(ARQUIVOS).filter(caminho => !['app/sem-novas.js', 'app/fora-do-mapa.js'].includes(caminho)));
  assert.deepEqual(achados, [
    'app/a.js:6 comentário novo: “Copyright 2024 Fulano”',
    'app/a.js:7 comentário novo: “comentário curto”',
    `app/a.js:8 comentário novo: “${'x'.repeat(70)}”`,
    `app/a.js:9 comentário novo: “${'y'.repeat(67)}…”`,
    `app/a.js:11 comentário novo: “bloco ${'z'.repeat(61)}…”`,
    'app/b.py:2 comentário novo: “comentário”',
    'app/b.py:9 comentário novo: “e comentário”',
    'app/b.py:1 docstring nova (é um comentário com outro nome)',
    'app/b.py:5 docstring nova (é um comentário com outro nome)',
    'app/c.py:4 docstring nova (é um comentário com outro nome)',
    'app/quebrado.py:2 comentário novo: “nota”',
    'scripts/roda:2 comentário novo: “comentário”',
    'scripts/roda:3 comentário novo: “!/bin/sh no meio”',
    'app/estilo.css:1 comentário novo: “cor”',
  ]);
});
