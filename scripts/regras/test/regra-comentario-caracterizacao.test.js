'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const config = require('../configuracao.json');
const regra = require('../regra-comentario');

const todas = texto => new Set(texto.split('\n').map((_, i) => i + 1));

const JS = [
  '#!/usr/bin/env node',
  '// SPDX-License-Identifier: MIT',
  '// Copyright 2024 Fulano de Tal',
  '// @ts-ignore',
  'const a = 1; // explica',
  '/* bloco',
  ' * de três',
  ' */',
  '//',
  '// um comentário bem comprido que passa de setenta caracteres para ser cortado na mensagem do achado',
  'const url = "http://x//y";',
  '// SPDX-License-Identifier: MIT',
].join('\n');

const PY = [
  '"""Docstring de módulo."""',
  'def f():',
  '    """Primeira linha.',
  '',
  '    Terceira linha.',
  '    """',
  '    return 1  # nota',
  'def g():',
  '    """uma só"""  # e um comentário na mesma linha',
  '    return 2',
  'x = 1',
].join('\n');

const ARQUIVOS = {
  'app/a.js': { texto: JS, novas: todas(JS) },
  'app/so-algumas.js': { texto: JS, novas: new Set([5, 7, 12]) },
  'app/b.py': { texto: PY, novas: todas(PY) },
  'app/so-corpo-da-docstring.py': { texto: PY, novas: new Set([5, 6, 7]) },
  'app/sem-novas.js': { texto: JS, novas: new Set() },
  'app/fora-do-mapa.js': { texto: JS },
  'app/leia.md': { texto: '<!-- nao -->\n', novas: new Set([1]) },
  'app/dist/assets/bundle.js': { texto: '// nao\n', novas: new Set([1]) },
  'app/binario.js': { binario: true, novas: new Set([1]) },
  'app/sumiu.js': { sumiu: true, novas: new Set([1]) },
  'bin/ferramenta': { texto: '#!/bin/sh\n# novo\n', novas: new Set([1, 2]) },
  'bin/sem-shebang': { texto: '# nao e codigo\n', novas: new Set([1]) },
  'Makefile': { texto: 'all: # novo\n', novas: new Set([1]) },
  'app/c.sh': { texto: '#!/bin/bash\n# novo\necho $#\n', novas: new Set([1, 2, 3]) },
  'app/d.html': { texto: '<p>oi</p>\n<!-- novo -->\n<script>\n// js\n</script>\n', novas: new Set([2, 4]) },
  'app/e.css': { texto: 'a { color: red; }\n/* novo */\n', novas: new Set([2]) },
};

function ctxDe(lidos, arquivos = ARQUIVOS) {
  return {
    arquivos: Object.keys(arquivos).map(caminho => ({ caminho, status: 'A' })),
    config,
    mudancas: { acrescentadas: new Map(Object.entries(arquivos).filter(([, a]) => a.novas).map(([caminho, a]) => [caminho, a.novas])) },
    ler(caminho) {
      lidos.push(caminho);
      const arquivo = arquivos[caminho];
      if (arquivo.sumiu) return null;
      return arquivo.binario ? { binario: true } : { texto: arquivo.texto, binario: false };
    },
  };
}

const resumo = achados => achados.map(({ arquivo, linha, detalhe }) => `${arquivo}:${linha} ${detalhe}`);

test('comentário: identidade, título e texto do conserto', () => {
  assert.equal(regra.id, 'sem-comentario-novo');
  assert.equal(regra.titulo, 'Nenhum comentário novo nas linhas acrescentadas');
  assert.equal(crypto.createHash('sha256').update(regra.conserto).digest('hex'), 'b2ae0c89c85fc00ebd5e6561d7404860b18e3d98c77e1ec09f13a1f2b079c3c3');
  assert.deepEqual(Object.keys(regra).sort(), ['conserto', 'id', 'permitida', 'titulo', 'verificar']);
});

test('comentário: achados por linha nova, na ordem dos arquivos, e só em arquivo lido com linha nova', () => {
  const lidos = [];
  const achados = regra.verificar(ctxDe(lidos));
  assert.deepEqual(lidos, ['app/a.js', 'app/so-algumas.js', 'app/b.py', 'app/so-corpo-da-docstring.py', 'app/leia.md', 'app/dist/assets/bundle.js', 'app/binario.js', 'app/sumiu.js', 'bin/ferramenta', 'bin/sem-shebang', 'Makefile', 'app/c.sh', 'app/d.html', 'app/e.css']);
  assert.deepEqual(resumo(achados), [
    'app/a.js:5 comentário novo: “explica”',
    'app/a.js:6 comentário novo: “bloco”',
    'app/a.js:7 comentário novo: “de três”',
    'app/a.js:10 comentário novo: “um comentário bem comprido que passa de setenta caracteres para ser…”',
    'app/a.js:12 comentário novo: “SPDX-License-Identifier: MIT”',
    'app/so-algumas.js:5 comentário novo: “explica”',
    'app/so-algumas.js:7 comentário novo: “de três”',
    'app/so-algumas.js:12 comentário novo: “SPDX-License-Identifier: MIT”',
    'app/b.py:7 comentário novo: “nota”',
    'app/b.py:9 comentário novo: “e um comentário na mesma linha”',
    'app/b.py:1 docstring nova (é um comentário com outro nome)',
    'app/b.py:3 docstring nova (é um comentário com outro nome)',
    'app/so-corpo-da-docstring.py:7 comentário novo: “nota”',
    'app/so-corpo-da-docstring.py:5 docstring nova (é um comentário com outro nome)',
    'bin/ferramenta:2 comentário novo: “novo”',
    'Makefile:1 comentário novo: “novo”',
    'app/c.sh:2 comentário novo: “novo”',
    'app/d.html:2 comentário novo: “novo”',
    'app/d.html:4 comentário novo: “js”',
    'app/e.css:2 comentário novo: “novo”',
  ]);
  assert.ok(achados.every(achado => Object.keys(achado).join() === 'arquivo,linha,detalhe'));
});

test('comentário: sem python3 a docstring nova passa e o comentário de linha continua barrado', () => {
  const programas = process.env.PATH;
  process.env.PATH = '';
  try {
    const achados = regra.verificar(ctxDe([], { 'app/b.py': ARQUIVOS['app/b.py'] }));
    assert.deepEqual(resumo(achados), ['app/b.py:7 comentário novo: “nota”', 'app/b.py:9 comentário novo: “e um comentário na mesma linha”']);
  } finally {
    process.env.PATH = programas;
  }
});

test('comentário: permitida aceita shebang na linha 1, diretiva em qualquer linha e licença até a linha 5', () => {
  const tabela = [
    [1, '!/usr/bin/env node', '#!/usr/bin/env node', true],
    [1, '!/bin/bash', '#!/bin/bash   ', true],
    [1, '!/usr/bin/env python3 -u', '#!/usr/bin/env python3 -u', true],
    [1, '!/usr/bin/env VAR=x cmd', '#!/usr/bin/env VAR=x cmd', false],
    [2, '!/usr/bin/env node', '#!/usr/bin/env node', false],
    [1, 'explica', '// explica', false],
    [9, '@ts-ignore', '// @ts-ignore', true],
    [9, '@ts-expect-error', '// @ts-expect-error', true],
    [9, '@ts-ignore porque sim', '// @ts-ignore porque sim', false],
    [9, 'noqa', '# noqa', true],
    [9, 'noqa: E501, W291', '# noqa: E501, W291', true],
    [9, 'type: ignore[attr-defined]', '# type: ignore[attr-defined]', true],
    [9, 'istanbul ignore next', '// istanbul ignore next', true],
    [9, 'c8 ignore start 3', '// c8 ignore start 3', true],
    [9, 'prettier-ignore-start', '// prettier-ignore-start', true],
    [9, '-*- coding: utf-8 -*-', '# -*- coding: utf-8 -*-', true],
    [9, 'coding=latin-1', '# coding=latin-1', true],
    [5, 'SPDX-License-Identifier: MIT OR Apache-2.0', '// x', true],
    [6, 'SPDX-License-Identifier: MIT', '// x', false],
    [3, 'Copyright (c) 2020-2024 Fulano de Tal', '// x', true],
    [3, 'Copyright © 2020, 2024 Fulano', '// x', true],
    [3, 'SPDX-FileCopyrightText: Copyright 2024 Fulano', '// x', true],
    [3, 'Copyright 2024', '// x', false],
    [3, 'Copyright 2024 um dois três quatro cinco', '// x', false],
  ];
  for (const [linha, corpo, bruto, esperado] of tabela) {
    assert.equal(regra.permitida(linha, corpo, bruto), esperado, `${linha} ${corpo}`);
  }
});
