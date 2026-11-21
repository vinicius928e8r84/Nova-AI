'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criar } = require('./auxiliar');
const { verificar, acharNaLinha } = require('../regra-segredo');

const AWS = `AKI${'A'}${'IOSFODNN7ABCDEFG'}`;
const GOOGLE = `AI${'za'}${'B'.repeat(35)}`;
const SENHA = ['Zx9fKq2', 'LmN8vB4'].join('');
const ARROBA = '@';
const HASH = ['5f4dcc3b5aa765d6', '1d8327deb882cf99'].join('');
const binarioCom = texto => Buffer.concat([Buffer.from([0, 7, 0, 3]), Buffer.from(texto), Buffer.from([0])]);

const LINHAS = [
  `const k = "${AWS}";`,
  `const g = "${GOOGLE}";`,
  `postgres://admin:${SENHA}@db.interno.com/x`,
  `postgres://admin:${SENHA}@db.exemplo.com/x`,
  'esquema://usuario:senha@host:porta',
  `socks5://proxy.interno.com:1002:usr:${SENHA}@x`,
  `socks5://proxy.interno.com:1002${ARROBA}usr:${SENHA}`,
  `socks5://proxy.exemplo.com:1002${ARROBA}usr:${SENHA}`,
  `socks5://proxy.interno.com:1002${ARROBA}usr:senha`,
  'socks5://h:1002:usr:s3nh@x',
  `"senha": "${HASH}"`,
  `apiKey: "${SENHA}${SENHA}"`,
  'apiKey: "abcdefghijklmnopqrst"',
  'token = "xxxxxxxxxxxxxxxxxxxxxxxx"',
  'apiKey: process.env.API_KEY',
  `${' '.repeat(1900)}apiKey: "${SENHA}${SENHA}"`,
  `${'a'.repeat(5000)} ${AWS}`,
  'const nada = 1;',
  `socks5://proxy.exemplo.com:1002${ARROBA}x`,
];

test('segredo: acharNaLinha nomeia cada caso igual à versão antes da refatoração', () => {
  assert.deepEqual(LINHAS.map(acharNaLinha), [
    'chave de acesso da AWS',
    'chave de API do Google',
    'URL com usuário e senha',
    null,
    null,
    'URL com usuário e senha',
    'URL com usuário e senha',
    null,
    null,
    null,
    'valor literal em campo de segredo',
    'valor literal em campo de segredo',
    null,
    null,
    null,
    'valor literal em campo de segredo',
    'chave de acesso da AWS',
    null,
    'URL com usuário e senha',
  ]);
});

function ctxDe(repo, arquivos, lidos) {
  const acrescentadas = new Map(Object.entries(arquivos).filter(([, a]) => a.novas).map(([caminho, a]) => [caminho, a.novas]));
  return {
    raiz: repo.raiz,
    arquivos: Object.entries(arquivos).map(([caminho, a]) => ({ caminho, status: a.status || 'M', antigo: a.antigo })),
    config: { arquivosProibidos: ['**/secret_key.json', '**/.env'] },
    mudancas: { base: { desde: 'main' }, copias: new Set(['app/copia.dat']), acrescentadas },
    ler(caminho) {
      lidos.push(caminho);
      const arquivo = arquivos[caminho];
      if (arquivo.sumiu) return null;
      return arquivo.buffer ? { binario: true, buffer: arquivo.buffer } : { binario: false, texto: arquivo.texto };
    },
  };
}

test('segredo: verificar acha na ordem dos arquivos e das linhas, sem reler o proibido e sem cobrar segredo que a base já tinha', () => {
  const repo = criar({
    'app/antigo.dat': binarioCom(`k=${AWS}`),
    'app/limpo-antes.dat': binarioCom('nada aqui'),
    'app/de-onde.dat': binarioCom(`k=${AWS}`),
  });
  const lidos = [];
  const texto = LINHAS.join('\n');
  const arquivos = {
    'app/secret_key.json': { texto: '{}', novas: new Set([1]) },
    'app/.env': { sumiu: true },
    'app/antigo.dat': { buffer: binarioCom(`k=${AWS} mais`) },
    'app/limpo-antes.dat': { buffer: binarioCom(`k=${AWS}`) },
    'app/novo.dat': { buffer: binarioCom(`k=${GOOGLE}`), status: 'A' },
    'app/movido.dat': { buffer: binarioCom(`k=${AWS}`), status: 'R', antigo: 'app/de-onde.dat' },
    'app/movido-de-limpo.dat': { buffer: binarioCom(`k=${AWS}`), status: 'R', antigo: 'app/nao-existe.dat' },
    'app/copia.dat': { buffer: binarioCom(`k=${AWS}`), status: 'C' },
    'app/limpo.dat': { buffer: binarioCom('so texto comum'), status: 'A' },
    'app/texto.js': { texto, novas: new Set([18, 3, 1, 7, 11, 40, 2, 9]) },
    'app/sem-novas.js': { texto, novas: new Set() },
    'app/fora-do-mapa.js': { texto },
    'app/sumiu.js': { sumiu: true, novas: new Set([1]) },
  };
  try {
    const achados = verificar(ctxDe(repo, arquivos, lidos)).map(({ arquivo, linha, detalhe }) => `${arquivo}:${linha || '-'} ${detalhe}`);
    assert.deepEqual(lidos, Object.keys(arquivos).filter(caminho => !['app/secret_key.json', 'app/.env'].includes(caminho)));
    assert.deepEqual(achados, [
      'app/secret_key.json:- arquivo de segredo, chave ou sessão não entra no repositório',
      'app/.env:- arquivo de segredo, chave ou sessão não entra no repositório',
      'app/limpo-antes.dat:- arquivo binário com texto que parece chave de acesso da AWS (o valor não é mostrado)',
      'app/novo.dat:- arquivo binário com texto que parece chave de API do Google (o valor não é mostrado)',
      'app/movido-de-limpo.dat:- arquivo binário com texto que parece chave de acesso da AWS (o valor não é mostrado)',
      'app/texto.js:1 parece chave de acesso da AWS (o valor não é mostrado)',
      'app/texto.js:2 parece chave de API do Google (o valor não é mostrado)',
      'app/texto.js:3 parece URL com usuário e senha (o valor não é mostrado)',
      'app/texto.js:7 parece URL com usuário e senha (o valor não é mostrado)',
      'app/texto.js:11 parece valor literal em campo de segredo (o valor não é mostrado)',
    ]);
  } finally {
    repo.limpar();
  }
});
