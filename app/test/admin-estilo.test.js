'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PWA = path.join(__dirname, '..', 'electron', 'pwa');
const ADMIN = path.join(PWA, 'admin.html');
const ESTILO = path.join(PWA, 'admin.css');
const LIGACAO = '<link rel="stylesheet" href="admin.css">';
const BLOCO_DE_ESTILO = /<style>([\s\S]*?)<\/style>/g;
const BLOCO_DE_SCRIPT = /\s*<script[^>]*>[\s\S]*?<\/script>/g;
const ESPERADO = { sha256: '16f27e5a6e6f2b275a9a188d69e2be3d6ae6c954ea7fac32685c4d62b565fd4d', linhasDeEstilo: 730 };

const comFimDeLinhaLf = texto => texto.replace(/\r\n/g, '\n');
const semComentarios = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const linhasDoEstilo = css => semComentarios(css).split('\n').map(linha => linha.trim()).filter(Boolean);

function documentoEfetivo() {
  const html = comFimDeLinhaLf(fs.readFileSync(ADMIN, 'utf8'));
  if (!html.includes(LIGACAO)) return html;
  return html.replace(LIGACAO, () => `<style>\n${comFimDeLinhaLf(fs.readFileSync(ESTILO, 'utf8'))}</style>`);
}

function normalizado(documento) {
  return documento.replace(BLOCO_DE_SCRIPT, '').replace(BLOCO_DE_ESTILO, (_, css) => `<style>\n${linhasDoEstilo(css).join('\n')}\n</style>`);
}

test('admin.html com o estilo no lugar e sem os scripts é o mesmo documento, regra por regra', () => {
  const documento = normalizado(documentoEfetivo());
  const estilo = [...documento.matchAll(BLOCO_DE_ESTILO)].flatMap(([, css]) => linhasDoEstilo(css));
  assert.deepStrictEqual({
    sha256: crypto.createHash('sha256').update(documento).digest('hex'),
    linhasDeEstilo: estilo.length,
  }, ESPERADO);
});

test('admin.css não tem comentário e é lido só pela página do admin', () => {
  const html = fs.readFileSync(ADMIN, 'utf8');
  if (!fs.existsSync(ESTILO)) return;
  assert.ok(html.includes(LIGACAO));
  assert.doesNotMatch(fs.readFileSync(ESTILO, 'utf8'), /\/\*/);
});
