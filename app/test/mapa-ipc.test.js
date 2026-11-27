const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAIZ_DO_APP = path.join(__dirname, '..');
const ELECTRON = path.join(RAIZ_DO_APP, 'electron');
const DIST = path.join(RAIZ_DO_APP, 'dist');
const ARQUIVO_DO_MAPA = path.join(__dirname, 'mapa-ipc.json');
const REGISTRO = { objeto: 'ipcMain', metodos: new Set(['handle', 'handleOnce', 'on', 'once']) };
const CONSUMO = { objeto: null, metodos: new Set(['invoke', 'send', 'sendSync']) };
const PASTAS_IGNORADAS = new Set(['node_modules', 'pwa']);
const PONTOS = new Set(['.', '?.']);
const FECHA_EXPRESSAO = new Set([')', ']', '}']);
const TIPOS_QUE_FECHAM_EXPRESSAO = new Set(['texto', 'numero', 'regex']);
const PALAVRAS_ANTES_DE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
]);
const PROFUNDIDADE = { '{': 1, '}': -1 };
const CORPO_DE_TEMPLATE = /(?:\\[\s\S]|\$(?!\{)|[^`\\$])*(?:`|\$\{)?/y;
const PONTUACAO = /(?:>>>=|\.\.\.|===|!==|\*\*=|<<=|>>=|>>>|&&=|\|\|=|\?\?=|=>|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|\*\*|<<|>>|[\s\S])/y;

function porRegex(re, tipo, condicao = () => true) {
  return (estado) => {
    if (!condicao(estado)) return false;
    re.lastIndex = estado.i;
    const achado = re.exec(estado.fonte);
    if (!achado) return false;
    if (tipo) estado.tokens.push({ tipo, valor: achado[0], inicio: estado.i });
    estado.i += achado[0].length;
    return true;
  };
}

function fechaExpressao(token) {
  if (TIPOS_QUE_FECHAM_EXPRESSAO.has(token.tipo)) return true;
  if (token.tipo === 'nome') return !PALAVRAS_ANTES_DE_REGEX.has(token.valor);
  return FECHA_EXPRESSAO.has(token.valor);
}

function regexPodeComecar(estado) {
  const anterior = estado.tokens[estado.tokens.length - 1];
  return !anterior || !fechaExpressao(anterior);
}

function continuaTemplate(estado) {
  return estado.fonte[estado.i] === '}' && estado.templates[estado.templates.length - 1] === estado.profundidade;
}

function lerTemplate(estado) {
  const abre = estado.fonte[estado.i] === '`';
  const continua = continuaTemplate(estado);
  if (!abre && !continua) return false;
  if (continua) estado.templates.pop();
  CORPO_DE_TEMPLATE.lastIndex = estado.i + 1;
  const corpo = CORPO_DE_TEMPLATE.exec(estado.fonte)[0];
  const aberto = corpo.endsWith('${');
  if (aberto) estado.templates.push(estado.profundidade);
  const tipo = aberto ? 'template' : 'texto';
  estado.tokens.push({ tipo, valor: estado.fonte.slice(estado.i, estado.i + 1 + corpo.length), inicio: estado.i });
  estado.i += 1 + corpo.length;
  return true;
}

function lerPontuacao(estado) {
  PONTUACAO.lastIndex = estado.i;
  const valor = PONTUACAO.exec(estado.fonte)[0];
  estado.profundidade += PROFUNDIDADE[valor] || 0;
  estado.tokens.push({ tipo: 'pontuacao', valor, inicio: estado.i });
  estado.i += valor.length;
  return true;
}

const LEITORES = [
  porRegex(/#![^\n]*/y, null, (estado) => estado.i === 0),
  porRegex(/\s+/y, null),
  porRegex(/\/\/[^\n]*/y, null),
  porRegex(/\/\*[\s\S]*?(?:\*\/|$)/y, null),
  porRegex(/'(?:\\[\s\S]|[^'\\\n])*'?|"(?:\\[\s\S]|[^"\\\n])*"?/y, 'texto'),
  lerTemplate,
  porRegex(/\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])*\/?[A-Za-z]*/y, 'regex', regexPodeComecar),
  porRegex(/\.?[0-9][0-9A-Za-z_.]*/y, 'numero'),
  porRegex(/[A-Za-z_$\\\u00c0-\uffff][A-Za-z0-9_$\\\u00c0-\uffff]*/y, 'nome'),
  lerPontuacao,
];

function tokenizar(fonte) {
  const estado = { fonte, i: 0, tokens: [], templates: [], profundidade: 0 };
  while (estado.i < fonte.length) LEITORES.some((ler) => ler(estado));
  return estado.tokens;
}

function valorDoTexto(token) {
  return token.valor.slice(1, -1).replace(/\\([\s\S])/g, '$1');
}

function ehNome(token, valor) {
  return token.tipo === 'nome' && token.valor === valor;
}

const FORMA_DA_CHAMADA = [
  (janela, alvo) => alvo.objeto === null || ehNome(janela[0], alvo.objeto),
  (janela) => PONTOS.has(janela[1].valor),
  (janela, alvo) => janela[2].tipo === 'nome' && alvo.metodos.has(janela[2].valor),
  (janela) => janela[3].valor === '(',
];

function achado(janela) {
  const canal = janela[4];
  return { metodo: janela[2].valor, canal: canal.tipo === 'texto' ? valorDoTexto(canal) : null, inicio: canal.inicio };
}

function chamadas(tokens, alvo) {
  const achadas = [];
  for (let i = 0; i + 4 < tokens.length; i += 1) {
    const janela = tokens.slice(i, i + 5);
    if (FORMA_DA_CHAMADA.every((casa) => casa(janela, alvo))) achadas.push(achado(janela));
  }
  return achadas;
}

function entradaJs(pasta, entrada) {
  const caminho = path.join(pasta, entrada.name);
  if (entrada.isDirectory()) return PASTAS_IGNORADAS.has(entrada.name) ? [] : arquivosJs(caminho);
  return /\.(?:c|m)?js$/.test(entrada.name) ? [caminho] : [];
}

function arquivosJs(pasta) {
  return fs.readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => entradaJs(pasta, entrada)).sort();
}

function relativo(caminho) {
  return path.relative(path.join(RAIZ_DO_APP, '..'), caminho).split(path.sep).join('/');
}

function linhaDe(fonte, inicio) {
  return fonte.slice(0, inicio).split('\n').length;
}

function jsDaPasta(pasta, filtro) {
  if (!fs.existsSync(pasta)) return [];
  return fs.readdirSync(pasta).filter((nome) => filtro.test(nome)).map((nome) => path.join(pasta, nome));
}

function usaIpcDaJanela(arquivo) {
  return /\bipcRenderer\b|electronAPI/.test(fs.readFileSync(arquivo, 'utf8'));
}

function arquivosDaJanela() {
  return [
    ...arquivosJs(ELECTRON).filter(usaIpcDaJanela),
    ...jsDaPasta(DIST, /\.js$/),
    ...jsDaPasta(path.join(DIST, 'assets'), /^index-.*\.js$/),
  ].sort();
}

function registrosDoArquivo(arquivo) {
  const fonte = fs.readFileSync(arquivo, 'utf8');
  const nome = relativo(arquivo);
  const achadas = chamadas(tokenizar(fonte), REGISTRO);
  return {
    nome,
    canais: achadas.filter((a) => a.canal !== null).map((a) => `${a.metodo} ${a.canal}`).sort(),
    dinamicos: achadas.filter((a) => a.canal === null).map((a) => `${nome}:${linhaDe(fonte, a.inicio)}`),
  };
}

function consumosDoArquivo(arquivo, canaisRegistrados) {
  const canais = chamadas(tokenizar(fs.readFileSync(arquivo, 'utf8')), CONSUMO)
    .map((a) => a.canal)
    .filter((canal) => canaisRegistrados.has(canal));
  return { nome: relativo(arquivo), canais: [...new Set(canais)].sort() };
}

function comoObjeto(lista) {
  return Object.fromEntries(lista.filter((item) => item.canais.length).map((item) => [item.nome, item.canais]));
}

function montarMapa() {
  const registros = arquivosJs(ELECTRON).map(registrosDoArquivo).filter((r) => r.canais.length || r.dinamicos.length);
  const canaisRegistrados = new Set(registros.flatMap((r) => r.canais.map((c) => c.split(' ')[1])));
  const consumos = arquivosDaJanela().map((arquivo) => consumosDoArquivo(arquivo, canaisRegistrados));
  const canaisConsumidos = new Set(consumos.flatMap((c) => c.canais));
  const registrados = comoObjeto(registros);
  const totais = Object.fromEntries(registros.map((r) => [r.nome, r.canais.length]));
  totais.total = registros.reduce((soma, r) => soma + r.canais.length, 0);
  return {
    totais,
    canais: registros.flatMap((r) => r.canais).sort(),
    registrados,
    dinamicos: registros.flatMap((r) => r.dinamicos),
    consumidos: comoObjeto(consumos),
    semConsumidorLiteral: [...canaisRegistrados].filter((c) => !canaisConsumidos.has(c)).sort(),
  };
}

function diferencaDaChave(chave, antes, depois) {
  const sobra = [...antes];
  const novos = depois.filter((item) => {
    const k = sobra.indexOf(item);
    if (k < 0) return true;
    sobra.splice(k, 1);
    return false;
  });
  return [...novos.map((item) => `+ ${chave}: ${item}`), ...sobra.map((item) => `- ${chave}: ${item}`)];
}

function diferenca(antes, depois) {
  const chaves = [...new Set([...Object.keys(antes), ...Object.keys(depois)])];
  return chaves.flatMap((chave) => diferencaDaChave(chave, antes[chave] || [], depois[chave] || []));
}

test('tokenizar ignora comentário, texto, template e regex que imitam um registro', () => {
  const fonte = [
    '#!/usr/bin/env node',
    '// reg.handle(\'falso-1\')',
    '/* reg.on("falso-2") */',
    'const a = "reg.handle(\'falso-3\')";',
    'const b = `x ${reg.handle(\'dentro-do-template\', f)} reg.on(\'falso-4\')`;',
    'const c = /reg.on\\(\'falso-5\'\\)/g;',
    'const d = x / 2; reg.on(\'depois-da-divisao\', f);',
    'reg.handle(`template-fixo`, f); reg.once(nome, f); reg.on(`com-${x}`, f);',
    'reg.on("escapado-\\"x\\"", f);',
  ].join('\n');
  const achadas = chamadas(tokenizar(fonte), { objeto: 'reg', metodos: REGISTRO.metodos });
  assert.deepStrictEqual(achadas.map((a) => `${a.metodo} ${a.canal}`), [
    'handle dentro-do-template', 'on depois-da-divisao', 'handle template-fixo', 'once null', 'on null',
    'on escapado-"x"',
  ]);
});

test('mapa de canais IPC do processo principal não muda sem querer', () => {
  const atual = montarMapa();
  if (process.env.ATUALIZAR_MAPA_IPC === '1') {
    fs.writeFileSync(ARQUIVO_DO_MAPA, `${JSON.stringify(atual, null, 2)}\n`);
  }
  const gravado = JSON.parse(fs.readFileSync(ARQUIVO_DO_MAPA, 'utf8'));
  const mudancas = [
    ...diferenca(gravado.registrados, atual.registrados),
    ...diferenca({ dinamicos: gravado.dinamicos }, { dinamicos: atual.dinamicos }),
    ...diferenca(gravado.consumidos, atual.consumidos),
  ];
  assert.deepStrictEqual(mudancas, [], [
    'Os canais IPC mudaram. Refatoração não muda esta lista; uma PR de subtração muda e mostra o que tirou.',
    'Para gravar a lista nova: ATUALIZAR_MAPA_IPC=1 node --test app/test/mapa-ipc.test.js',
    ...mudancas,
  ].join('\n'));
  assert.deepStrictEqual(atual, gravado);
});
