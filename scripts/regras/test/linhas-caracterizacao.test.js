'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criar } = require('./auxiliar');
const { lerArquivo } = require('../git');
const { verificar, atualizarLinhaDeBase, calcularLinhaDeBase } = require('../regra-linhas');

const LINHA_DE_BASE = 'scripts/regras/linha-de-base.json';
const config = { limiteDeLinhas: 5, extensoesDoLimite: ['js', 'py'], ignorarCodigo: ['app/dist/assets/**'] };
const texto = quantas => 'x\n'.repeat(quantas);

const TETO = {
  'app/cresceu.js': 6, 'app/igual.js': 7, 'app/ajustar.js': 9, 'app/encolheu.js': 8, 'app/de-onde.js': 7, 'app/de-onde-2.js': 7,
  'app/apagado.js': 8, 'app/movido-antes.js': 6, 'app/sobe.js': 6, 'app/renomeado-velho.js': 6,
};
const DO_RAMO = {
  'app/cresceu.js': 6, 'app/igual.js': 7, 'app/ajustar.js': 9, 'app/encolheu.js': 8, 'app/de-onde-2.js': 7, 'app/novo-2.js': 7,
  'app/apagado.js': 8, 'app/movido-antes.js': 6, 'app/sobe.js': 9, 'app/entrou.js': 10, 'app/renomeado-novo.js': 7,
};

const ITENS = [
  ['app/cresceu.js', { status: 'M', linhas: 8 }],
  ['app/igual.js', { status: 'M', linhas: 7 }],
  ['app/ajustar.js', { status: 'M', linhas: 8 }],
  ['app/encolheu.js', { status: 'M', linhas: 4 }],
  ['app/pequeno.js', { status: 'A', linhas: 5 }],
  ['app/novo.js', { status: 'A', linhas: 6 }],
  ['app/novo-1.js', { status: 'R', antigo: 'app/de-onde.js', linhas: 7 }],
  ['app/novo-2.js', { status: 'R', antigo: 'app/de-onde-2.js', linhas: 8 }],
  ['app/vazio.js', { status: 'A', linhas: 0 }],
  ['app/leia.md', { status: 'A', linhas: 50 }],
  ['app/dist/assets/bundle.js', { status: 'A', linhas: 50 }],
  ['app/binario.js', { status: 'A', binario: true }],
  ['app/sumiu.js', { status: 'M', sumiu: true }],
  ['app/apagado.js', { status: 'D' }],
  ['app/outro-apagado.js', { status: 'D' }],
  ['app/movido-depois.js', { status: 'R', antigo: 'app/movido-antes.js', linhas: 3 }],
  ['app/sobe.js', { status: 'M', linhas: 9 }],
  ['app/renomeado-novo.js', { status: 'R', antigo: 'app/renomeado-velho.js', linhas: 7 }],
  ['app/script.py', { status: 'A', linhas: 6 }],
];

function ctxDe(repo, { desde = 'main', ramo = JSON.stringify({ arquivos: DO_RAMO }), itens = ITENS } = {}) {
  const lidos = [];
  const avisos = [];
  const porCaminho = new Map(itens);
  const ctx = {
    raiz: repo.raiz,
    config,
    mudancas: { base: { desde, ref: 'origin/main' }, itens: itens.map(([caminho, item]) => ({ caminho, status: item.status, antigo: item.antigo })) },
    aviso: mensagem => avisos.push(mensagem),
    ler(caminho) {
      lidos.push(caminho);
      if (caminho === LINHA_DE_BASE) return ramo === null ? null : { binario: ramo === 'binario', texto: ramo };
      const item = porCaminho.get(caminho);
      if (!item || item.sumiu) return null;
      return item.binario ? { binario: true } : { binario: false, texto: texto(item.linhas) };
    },
  };
  return { ctx, lidos, avisos };
}

const legivel = achados => achados.map(({ arquivo, detalhe }) => `${arquivo}: ${detalhe}`);

test('limite de linhas: achados na ordem, leituras e avisos iguais à versão antes da refatoração', () => {
  const repo = criar({}, TETO, null);
  try {
    const { ctx, lidos, avisos } = ctxDe(repo);
    assert.deepEqual(legivel(verificar(ctx)), [
      'app/cresceu.js: 8 linhas; a linha de base o deixa em 6: arquivo grande não pode crescer (2 linhas a mais)',
      'app/ajustar.js: tem 8 linhas e a linha de base do ramo diz 9: ajuste com --atualizar-linha-de-base (o teto é o tamanho de hoje)',
      'app/encolheu.js: tem 4 linhas, dentro do limite de 5: tire-o da linha de base (--atualizar-linha-de-base)',
      'app/novo.js: 6 linhas, 1 acima do limite de 5; arquivo novo (ou que não estava na linha de base) tem de caber no limite',
      'app/novo-1.js: 7 linhas e saiu da linha de base sem ficar abaixo de 5',
      'app/novo-2.js: 8 linhas; a linha de base o deixa em 7: arquivo grande não pode crescer (1 linhas a mais)',
      'app/sobe.js: 9 linhas; a linha de base o deixa em 6: arquivo grande não pode crescer (3 linhas a mais)',
      'app/renomeado-novo.js: 7 linhas; a linha de base o deixa em 6: arquivo grande não pode crescer (1 linhas a mais)',
      'app/script.py: 6 linhas, 1 acima do limite de 5; arquivo novo (ou que não estava na linha de base) tem de caber no limite',
      'app/de-onde-2.js: o arquivo não existe mais neste caminho: tire-o da linha de base (--atualizar-linha-de-base)',
      'app/apagado.js: o arquivo não existe mais neste caminho: tire-o da linha de base (--atualizar-linha-de-base)',
      'app/movido-antes.js: o arquivo não existe mais neste caminho: tire-o da linha de base (--atualizar-linha-de-base)',
      'app/sobe.js: a linha de base subiu de 6 para 9: ela só encolhe',
      'app/entrou.js: entrou na linha de base, que só encolhe: arquivo acima de 5 linhas tem de ser dividido, não listado',
      'app/renomeado-novo.js: a linha de base subiu de 6 para 7: ela só encolhe',
    ]);
    assert.deepEqual(avisos, []);
    assert.deepEqual(lidos, [
      LINHA_DE_BASE, 'app/cresceu.js', 'app/igual.js', 'app/ajustar.js', 'app/encolheu.js', 'app/pequeno.js', 'app/novo.js', 'app/novo-1.js',
      'app/novo-2.js', 'app/vazio.js', 'app/binario.js', 'app/sumiu.js', 'app/movido-depois.js', 'app/sobe.js', 'app/renomeado-novo.js', 'app/script.py',
    ]);
  } finally {
    repo.limpar();
  }
});

test('limite de linhas: base sem linha de base avisa e compara com a do ramo; ramo sem ela ou com JSON ruim falha', () => {
  const repo = criar({}, TETO, null);
  try {
    const primeira = ctxDe(repo, { desde: 'nao-existe' });
    const achados = legivel(verificar(primeira.ctx));
    assert.deepEqual(primeira.avisos, ['origin/main ainda não tem scripts/regras/linha-de-base.json: esta é a primeira linha de base, nada a comparar']);
    assert.deepEqual(achados, [
      'app/cresceu.js: 8 linhas; a linha de base o deixa em 6: arquivo grande não pode crescer (2 linhas a mais)',
      'app/ajustar.js: tem 8 linhas e a linha de base do ramo diz 9: ajuste com --atualizar-linha-de-base (o teto é o tamanho de hoje)',
      'app/encolheu.js: tem 4 linhas, dentro do limite de 5: tire-o da linha de base (--atualizar-linha-de-base)',
      'app/novo.js: 6 linhas, 1 acima do limite de 5; arquivo novo (ou que não estava na linha de base) tem de caber no limite',
      'app/novo-1.js: 7 linhas, 2 acima do limite de 5; arquivo novo (ou que não estava na linha de base) tem de caber no limite',
      'app/novo-2.js: 8 linhas; a linha de base o deixa em 7: arquivo grande não pode crescer (1 linhas a mais)',
      'app/script.py: 6 linhas, 1 acima do limite de 5; arquivo novo (ou que não estava na linha de base) tem de caber no limite',
      'app/de-onde-2.js: o arquivo não existe mais neste caminho: tire-o da linha de base (--atualizar-linha-de-base)',
      'app/apagado.js: o arquivo não existe mais neste caminho: tire-o da linha de base (--atualizar-linha-de-base)',
      'app/movido-antes.js: o arquivo não existe mais neste caminho: tire-o da linha de base (--atualizar-linha-de-base)',
    ]);
    for (const ramo of [null, 'binario']) {
      const semNoRamo = ctxDe(repo, { ramo });
      assert.deepEqual(legivel(verificar(semNoRamo.ctx)), ['scripts/regras/linha-de-base.json: a linha de base não existe neste ramo; ela é versionada junto com as regras']);
      assert.deepEqual(semNoRamo.lidos, [LINHA_DE_BASE]);
    }
    assert.throws(() => verificar(ctxDe(repo, { ramo: '{' }).ctx), /^Error: scripts\/regras\/linha-de-base\.json não é um JSON válido \(/);
    assert.throws(() => verificar(ctxDe(repo, { ramo: '{"outra":1}' }).ctx), { message: 'scripts/regras/linha-de-base.json precisa ter o objeto "arquivos"' });
    assert.throws(() => verificar(ctxDe(repo, { ramo: 'null' }).ctx), { message: 'scripts/regras/linha-de-base.json precisa ter o objeto "arquivos"' });
  } finally {
    repo.limpar();
  }
});

test('limite de linhas: calcular e atualizar a linha de base seguem iguais', () => {
  const repo = criar({ 'app/grande.js': texto(7), 'app/pequeno.js': texto(2), 'app/leia.md': texto(9), 'app/velho.js': texto(8), 'app/cresceu.js': texto(6) }, {
    'app/grande.js': 9, 'app/velho.js': 8, 'app/cresceu.js': 6, 'app/sumido.js': 7, 'app/pequeno.js': 6,
  }, null);
  try {
    repo.git('mv', 'app/velho.js', 'app/novo.js');
    repo.escrever({ 'app/cresceu.js': texto(7), 'app/solto.js': texto(6) });
    const ler = caminho => lerArquivo(repo.raiz, caminho);
    const mudancas = { itens: [{ status: 'R', antigo: 'app/velho.js', caminho: 'app/novo.js' }] };
    const ctx = { raiz: repo.raiz, config, mudancas, ler };
    assert.deepEqual(calcularLinhaDeBase(ctx), { 'app/cresceu.js': 7, 'app/grande.js': 7, 'app/novo.js': 8, 'app/solto.js': 6 });
    assert.deepEqual(atualizarLinhaDeBase(ctx), {
      nova: { 'app/grande.js': 7, 'app/novo.js': 8 },
      erros: ['app/cresceu.js: 7 linhas, mais que as 6 da linha de base; divida o arquivo'],
    });
  } finally {
    repo.limpar();
  }
});
