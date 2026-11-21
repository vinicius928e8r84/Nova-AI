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
const HOST_DE_EXEMPLO = /^(?:[\w-]+\.)*(?:exemplo|example)\.(?:com|net|org)(?::\d+)?(?:[/?#]|$)/i;
const SENHA_DE_EXEMPLO = /^(?:senha|password|passwd|pass|pwd|secret|segredo|usuario|user|username|usr|xxx+|\*+|porta|port|host|s3nh[a0-9]*|<[^>]*>|\{[^}]*\}|\$\{?\w*\}?|%\w*|\.\.\.)$/i;

const ATRIBUICAO = /(?:secret|passwd|password|senha|api[_-]?key|apikey|token|private[_-]?key|auth[_-]?key|access[_-]?key)[\w.-]{0,60}['"]?\s{0,5}[:=]\s{0,5}['"]([^'"\s]{16,512})/i;
const TAMANHO_DA_JANELA = 2000;
const SOBRA_ENTRE_JANELAS = 200;
const PLACEHOLDER = /x{4,}|\*{3,}|example|exemplo|sample|your|seu[_-]|changeme|placeholder|dummy|fake|falso|<[^>]*>|\$\{|%\(|\{\{|process\.env|os\.environ|\.\.\./i;

const pareceSegredo = valor => {
  if (PLACEHOLDER.test(valor)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(valor)).length;
  if (/^[0-9a-f]{32,}$/i.test(valor)) return true;
  return classes >= 3 && new Set(valor).size >= 8;
};

const ehFormatoInvertido = (credencial, resto) => /^\d{1,5}$/.test(credencial) && resto.includes(':');

function partesDaUrl([inteira, credencial]) {
  const resto = inteira.slice(inteira.indexOf('@') + 1).split(/[/?#]/)[0];
  if (!ehFormatoInvertido(credencial, resto)) return { host: resto, senha: credencial.split(':').pop() };
  return { host: inteira.slice(inteira.indexOf('://') + 3).split(':')[0], senha: resto.slice(resto.indexOf(':') + 1) };
}

const ehSenhaReal = ({ host, senha }) => !HOST_DE_EXEMPLO.test(host) && !SENHA_DE_EXEMPLO.test(senha);

function temUrlComSenha(texto) {
  for (const url of texto.matchAll(URL_COM_SENHA)) if (ehSenhaReal(partesDaUrl(url))) return true;
  return false;
}

function temValorEmCampoDeSegredo(texto) {
  const atribuicao = ATRIBUICAO.exec(texto);
  return Boolean(atribuicao) && pareceSegredo(atribuicao[1]);
}

function acharNaJanela(texto) {
  const padrao = PADROES.find(({ regex }) => regex.test(texto));
  if (padrao) return padrao.nome;
  if (temUrlComSenha(texto)) return 'URL com usuário e senha';
  if (temValorEmCampoDeSegredo(texto)) return 'valor literal em campo de segredo';
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

const CAMPO_DA_ORIGEM = { M: 'caminho', R: 'antigo' };

function segredoNovoNoBinario(ctx, item, arquivo) {
  const nome = segredoNoBinario(arquivo.buffer);
  if (!nome) return null;
  const campo = CAMPO_DA_ORIGEM[item.status];
  const origem = campo ? item[campo] : null;
  const antes = origem ? bytesDaBase(ctx.raiz, ctx.mudancas.base.desde, origem) : null;
  return antes && segredoNoBinario(antes) ? null : nome;
}

function achadosDoBinario(ctx, item, arquivo) {
  if (ctx.mudancas.copias.has(item.caminho)) return [];
  const nome = segredoNovoNoBinario(ctx, item, arquivo);
  return nome ? [{ arquivo: item.caminho, detalhe: `arquivo binário com texto que parece ${nome} (o valor não é mostrado)` }] : [];
}

function achadoDaLinha(caminho, numero, texto) {
  const nome = acharNaLinha(texto);
  return nome ? [{ arquivo: caminho, linha: numero, detalhe: `parece ${nome} (o valor não é mostrado)` }] : [];
}

const semLinhaNova = novas => !novas || novas.size === 0;

function achadosDoTexto(ctx, caminho, arquivo) {
  const novas = ctx.mudancas.acrescentadas.get(caminho);
  if (semLinhaNova(novas) || !arquivo) return [];
  const linhas = arquivo.texto.split('\n');
  return [...novas].sort((a, b) => a - b).flatMap(numero => achadoDaLinha(caminho, numero, linhas[numero - 1] || ''));
}

function achadosDoArquivo(ctx, item) {
  if (casaAlgum(ctx.config.arquivosProibidos, item.caminho)) {
    return [{ arquivo: item.caminho, detalhe: 'arquivo de segredo, chave ou sessão não entra no repositório' }];
  }
  const arquivo = ctx.ler(item.caminho);
  if (arquivo && arquivo.binario) return achadosDoBinario(ctx, item, arquivo);
  return achadosDoTexto(ctx, item.caminho, arquivo);
}

const verificar = ctx => ctx.arquivos.flatMap(item => achadosDoArquivo(ctx, item));

module.exports = { id, titulo, conserto, verificar, acharNaLinha };
