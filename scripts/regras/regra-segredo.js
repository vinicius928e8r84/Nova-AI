'use strict';

const { bytesDaBase } = require('./git');
const { casaAlgum } = require('./globs');

const id = 'sem-segredo';
const titulo = 'Nenhum segredo, chave, token ou arquivo de credencial no diff';
const conserto = 'Este repositório é público: tire o segredo do arquivo e leia-o do ambiente ou de ~/Library/Application Support/nova_dsktp/ (fora do repositório). '
  + 'Se ele já foi publicado numa branch, considere-o vazado: revogue e troque a chave, porque apagar o commit depois não o recupera.';

const PADROES = [
  { nome: 'chave privada', regex: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { nome: 'chave de acesso da AWS', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { nome: 'chave de API do Google', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { nome: 'token do GitHub', regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/ },
  { nome: 'token do Slack', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { nome: 'chave de API (sk-)', regex: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}\b/ },
  { nome: 'JWT', regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { nome: 'token de bot do Telegram', regex: /(?:\b|(?<=bot))\d{8,10}:[A-Za-z0-9_-]{35}\b/ },
];

const URL_COM_SENHA = /[a-z][a-z0-9+.-]{1,20}:\/\/[^\s/:@'"]{1,100}:([^\s/@'"]{4,200})@[^\s'"]{1,200}/gi;
const SENHA_DE_EXEMPLO = /^(?:senha|password|passwd|pass|pwd|secret|segredo|usuario|user|username|usr|xxx+|\*+|s3nh[a0-9]*|<[^>]*>|\{[^}]*\}|\$\{?\w*\}?|%\w*|\.\.\.)$/i;

const ATRIBUICAO = /(?:secret|passwd|password|senha|api[_-]?key|apikey|token|private[_-]?key|auth[_-]?key|access[_-]?key)[\w.-]{0,60}['"]?\s{0,5}[:=]\s{0,5}['"]([^'"\s]{16,512})/i;
const TAMANHO_DA_JANELA = 2000;
const SOBRA_ENTRE_JANELAS = 200;
const PLACEHOLDER = /x{4,}|\*{3,}|example|exemplo|sample|your|seu[_-]|changeme|placeholder|dummy|fake|<[^>]*>|\$\{|%\(|\{\{|process\.env|os\.environ|\.\.\./i;

const pareceSegredo = valor => {
  if (PLACEHOLDER.test(valor)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(valor)).length;
  if (/^[0-9a-f]{32,}$/i.test(valor)) return true;
  return classes >= 3 && new Set(valor).size >= 8;
};

function acharNaJanela(texto) {
  for (const { nome, regex } of PADROES) if (regex.test(texto)) return nome;
  for (const url of texto.matchAll(URL_COM_SENHA)) {
    if (!SENHA_DE_EXEMPLO.test(url[1].split(':').pop())) return 'URL com usuário e senha';
  }
  const m = ATRIBUICAO.exec(texto);
  if (m && pareceSegredo(m[1])) return 'valor literal em campo de segredo';
  return null;
}

function acharNaLinha(texto) {
  if (texto.length <= TAMANHO_DA_JANELA) return acharNaJanela(texto);
  const passo = TAMANHO_DA_JANELA - SOBRA_ENTRE_JANELAS;
  for (let inicio = 0; inicio < texto.length; inicio += passo) {
    const nome = acharNaJanela(texto.slice(inicio, inicio + TAMANHO_DA_JANELA));
    if (nome) return nome;
  }
  return null;
}

const TAMANHO_MAXIMO_DO_BINARIO = 32 * 1024 * 1024;
const TRECHO_LEGIVEL = /[\x20-\x7e]{12,}/g;

function segredoNoBinario(buffer) {
  if (buffer.length > TAMANHO_MAXIMO_DO_BINARIO) return null;
  const tamanhoPar = tamanho => tamanho - (tamanho % 2);
  const visoes = [
    buffer.toString('latin1'),
    buffer.subarray(0, tamanhoPar(buffer.length)).toString('utf16le'),
    buffer.subarray(1, 1 + tamanhoPar(buffer.length - 1)).toString('utf16le'),
  ];
  for (const visao of visoes) {
    for (const trecho of visao.matchAll(TRECHO_LEGIVEL)) {
      const nome = acharNaLinha(trecho[0]);
      if (nome) return nome;
    }
  }
  return null;
}

function segredoNovoNoBinario(ctx, item, arquivo) {
  const nome = segredoNoBinario(arquivo.buffer);
  if (!nome) return null;
  const origem = item.status === 'M' ? item.caminho : item.status === 'R' ? item.antigo : null;
  const antes = origem ? bytesDaBase(ctx.raiz, ctx.mudancas.base.desde, origem) : null;
  return antes && segredoNoBinario(antes) ? null : nome;
}

function verificar(ctx) {
  const achados = [];
  for (const item of ctx.arquivos) {
    const { caminho } = item;
    if (casaAlgum(ctx.config.arquivosProibidos, caminho)) {
      achados.push({ arquivo: caminho, detalhe: 'arquivo de segredo, chave ou sessão não entra no repositório' });
      continue;
    }
    const arquivo = ctx.ler(caminho);
    if (arquivo && arquivo.binario) {
      const nome = ctx.mudancas.copias.has(caminho) ? null : segredoNovoNoBinario(ctx, item, arquivo);
      if (nome) achados.push({ arquivo: caminho, detalhe: `arquivo binário com texto que parece ${nome} (o valor não é mostrado)` });
      continue;
    }
    const novas = ctx.mudancas.acrescentadas.get(caminho);
    if (!novas || novas.size === 0) continue;
    if (!arquivo) continue;
    const linhas = arquivo.texto.split('\n');
    for (const numero of [...novas].sort((a, b) => a - b)) {
      const nome = acharNaLinha(linhas[numero - 1] || '');
      if (nome) achados.push({ arquivo: caminho, linha: numero, detalhe: `parece ${nome} (o valor não é mostrado)` });
    }
  }
  return achados;
}

module.exports = { id, titulo, conserto, verificar, acharNaLinha };
