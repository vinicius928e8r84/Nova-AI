const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAIZ_DO_APP = path.join(__dirname, '..');
const ELECTRON = path.join(RAIZ_DO_APP, 'electron');
const ARQUIVO_DO_MAPA = path.join(__dirname, 'mapa-ipc.json');
const METODOS_DE_REGISTRO = new Set(['handle', 'handleOnce', 'on', 'once']);
const METODOS_DE_CONSUMO = new Set(['invoke', 'send', 'sendSync']);
const PASTAS_IGNORADAS = new Set(['node_modules', 'pwa']);
const PALAVRAS_ANTES_DE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
]);
const PONTUACAO = /^(?:>>>=|\.\.\.|===|!==|\*\*=|<<=|>>=|>>>|=>|==|!=|<=|>=|&&|\|\||\?\?=|\?\?|\?\.|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|&&=|\|\|=|\*\*|<<|>>|[{}()[\];,<>+\-*/%&|^!~?:=.@#])/;
const COMECO_DE_IDENTIFICADOR = /[A-Za-z_$\u00c0-\uffff]/;
const RESTO_DE_IDENTIFICADOR = /[A-Za-z0-9_$\u00c0-\uffff]/;

function lerString(fonte, inicio) {
  const aspa = fonte[inicio];
  let i = inicio + 1;
  let valor = '';
  while (i < fonte.length && fonte[i] !== aspa) {
    if (fonte[i] === '\\') { valor += fonte[i + 1]; i += 2; continue; }
    if (fonte[i] === '\n') break;
    valor += fonte[i];
    i += 1;
  }
  return { valor, fim: i + 1 };
}

function lerRegex(fonte, inicio) {
  let i = inicio + 1;
  let emClasse = false;
  while (i < fonte.length) {
    const c = fonte[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '\n') break;
    if (c === '[') emClasse = true;
    else if (c === ']') emClasse = false;
    else if (c === '/' && !emClasse) { i += 1; break; }
    i += 1;
  }
  while (i < fonte.length && RESTO_DE_IDENTIFICADOR.test(fonte[i])) i += 1;
  return i;
}

function regexPodeComecar(anterior) {
  if (!anterior) return true;
  if (anterior.tipo === 'texto' || anterior.tipo === 'numero' || anterior.tipo === 'regex') return false;
  if (anterior.tipo === 'nome') return PALAVRAS_ANTES_DE_REGEX.has(anterior.valor);
  return ![')', ']', '}'].includes(anterior.valor);
}

function tokenizar(fonte) {
  const tokens = [];
  const pilhaDeTemplates = [];
  let profundidade = 0;
  let i = 0;
  if (fonte.startsWith('#!')) i = fonte.indexOf('\n');
  const empurrar = (tipo, valor, inicio) => tokens.push({ tipo, valor, inicio });
  const lerTemplate = (inicio) => {
    let j = inicio;
    let valor = '';
    while (j < fonte.length) {
      const c = fonte[j];
      if (c === '\\') { valor += fonte[j + 1]; j += 2; continue; }
      if (c === '`') return { valor, fim: j + 1, aberto: false };
      if (c === '$' && fonte[j + 1] === '{') return { valor, fim: j + 2, aberto: true };
      valor += c;
      j += 1;
    }
    return { valor, fim: j, aberto: false };
  };
  while (i < fonte.length && i >= 0) {
    const c = fonte[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\ufeff' || c === '\u00a0' || c === '\u2028' || c === '\u2029') { i += 1; continue; }
    if (c === '/' && fonte[i + 1] === '/') { const fim = fonte.indexOf('\n', i); i = fim < 0 ? fonte.length : fim; continue; }
    if (c === '/' && fonte[i + 1] === '*') { const fim = fonte.indexOf('*/', i + 2); i = fim < 0 ? fonte.length : fim + 2; continue; }
    if (c === '\'' || c === '"') { const s = lerString(fonte, i); empurrar('texto', s.valor, i); i = s.fim; continue; }
    if (c === '`' || (c === '}' && pilhaDeTemplates.length && pilhaDeTemplates[pilhaDeTemplates.length - 1] === profundidade)) {
      if (c === '}') pilhaDeTemplates.pop();
      const t = lerTemplate(i + 1);
      const completo = c === '`' && !t.aberto;
      empurrar(completo ? 'texto' : 'template', t.valor, i);
      if (t.aberto) pilhaDeTemplates.push(profundidade);
      i = t.fim;
      continue;
    }
    if (c === '/' && regexPodeComecar(tokens[tokens.length - 1])) { const fim = lerRegex(fonte, i); empurrar('regex', fonte.slice(i, fim), i); i = fim; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(fonte[i + 1]))) {
      let j = i + 1;
      while (j < fonte.length && /[0-9A-Za-z_.]/.test(fonte[j])) j += 1;
      empurrar('numero', fonte.slice(i, j), i);
      i = j;
      continue;
    }
    if (COMECO_DE_IDENTIFICADOR.test(c) || c === '\\') {
      let j = i + 1;
      while (j < fonte.length && RESTO_DE_IDENTIFICADOR.test(fonte[j])) j += 1;
      empurrar('nome', fonte.slice(i, j), i);
      i = j;
      continue;
    }
    const p = PONTUACAO.exec(fonte.slice(i, i + 4));
    const valor = p ? p[0] : c;
    if (valor === '{') profundidade += 1;
    if (valor === '}') profundidade -= 1;
    empurrar('pontuacao', valor, i);
    i += valor.length;
  }
  return tokens;
}

function chamadas(tokens, objeto, metodos) {
  const achadas = [];
  for (let i = 0; i + 4 < tokens.length; i += 1) {
    const [o, ponto, metodo, parentese, canal] = tokens.slice(i, i + 5);
    if (objeto && (o.tipo !== 'nome' || o.valor !== objeto)) continue;
    if (ponto.valor !== '.' && ponto.valor !== '?.') continue;
    if (metodo.tipo !== 'nome' || !metodos.has(metodo.valor) || parentese.valor !== '(') continue;
    const literal = canal.tipo === 'texto';
    achadas.push({ metodo: metodo.valor, canal: literal ? canal.valor : null, inicio: canal.inicio });
  }
  return achadas;
}

function arquivosJs(pasta) {
  const lista = [];
  for (const entrada of fs.readdirSync(pasta, { withFileTypes: true })) {
    const caminho = path.join(pasta, entrada.name);
    if (entrada.isDirectory()) {
      if (!PASTAS_IGNORADAS.has(entrada.name)) lista.push(...arquivosJs(caminho));
    } else if (/\.(?:c|m)?js$/.test(entrada.name)) {
      lista.push(caminho);
    }
  }
  return lista.sort();
}

function relativo(caminho) {
  return path.relative(path.join(RAIZ_DO_APP, '..'), caminho).split(path.sep).join('/');
}

function linhaDe(fonte, inicio) {
  return fonte.slice(0, inicio).split('\n').length;
}

function consumidoresDoRenderizador() {
  const assets = path.join(RAIZ_DO_APP, 'dist', 'assets');
  const doBundle = fs.existsSync(assets)
    ? fs.readdirSync(assets).filter((nome) => /^index-.*\.js$/.test(nome)).map((nome) => path.join(assets, nome))
    : [];
  const daPastaDist = fs.readdirSync(path.join(RAIZ_DO_APP, 'dist'))
    .filter((nome) => nome.endsWith('.js')).map((nome) => path.join(RAIZ_DO_APP, 'dist', nome));
  const doElectron = arquivosJs(ELECTRON).filter((arquivo) => /\bipcRenderer\b|electronAPI/.test(fs.readFileSync(arquivo, 'utf8')));
  return [...doElectron, ...daPastaDist, ...doBundle].sort();
}

function montarMapa() {
  const registrados = {};
  const canaisRegistrados = new Set();
  const dinamicos = [];
  for (const arquivo of arquivosJs(ELECTRON)) {
    const fonte = fs.readFileSync(arquivo, 'utf8');
    const achadas = chamadas(tokenizar(fonte), 'ipcMain', METODOS_DE_REGISTRO);
    if (!achadas.length) continue;
    const nome = relativo(arquivo);
    for (const a of achadas) {
      if (a.canal === null) { dinamicos.push(`${nome}:${linhaDe(fonte, a.inicio)}`); continue; }
      canaisRegistrados.add(a.canal);
    }
    registrados[nome] = achadas.filter((a) => a.canal !== null).map((a) => `${a.metodo} ${a.canal}`).sort();
  }
  const consumidos = {};
  const canaisConsumidos = new Set();
  for (const arquivo of consumidoresDoRenderizador()) {
    const fonte = fs.readFileSync(arquivo, 'utf8');
    const canais = [...new Set(chamadas(tokenizar(fonte), null, METODOS_DE_CONSUMO)
      .filter((a) => a.canal !== null && canaisRegistrados.has(a.canal))
      .map((a) => a.canal))].sort();
    if (!canais.length) continue;
    consumidos[relativo(arquivo)] = canais;
    canais.forEach((c) => canaisConsumidos.add(c));
  }
  const semConsumidorLiteral = [...canaisRegistrados].filter((c) => !canaisConsumidos.has(c)).sort();
  const totais = Object.fromEntries(Object.entries(registrados).map(([nome, lista]) => [nome, lista.length]));
  totais.total = Object.values(totais).reduce((a, b) => a + b, 0);
  return { totais, registrados, dinamicos, consumidos, semConsumidorLiteral };
}

function diferenca(antes, depois) {
  const linhas = [];
  for (const chave of new Set([...Object.keys(antes), ...Object.keys(depois)])) {
    const a = antes[chave] || [];
    const d = depois[chave] || [];
    const sobra = [...a];
    const novos = [];
    for (const item of d) {
      const k = sobra.indexOf(item);
      if (k >= 0) sobra.splice(k, 1); else novos.push(item);
    }
    novos.forEach((item) => linhas.push(`+ ${chave}: ${item}`));
    sobra.forEach((item) => linhas.push(`- ${chave}: ${item}`));
  }
  return linhas;
}

test('tokenizar ignora comentário, texto, template e regex que imitam um registro', () => {
  const fonte = [
    '// reg.handle(\'falso-1\')',
    '/* reg.on("falso-2") */',
    'const a = "reg.handle(\'falso-3\')";',
    'const b = `x ${reg.handle(\'dentro-do-template\', f)} reg.on(\'falso-4\')`;',
    'const c = /reg.on\\(\'falso-5\'\\)/g;',
    'const d = x / 2; reg.on(\'depois-da-divisao\', f);',
    'reg.handle(`template-fixo`, f); reg.once(nome, f);',
  ].join('\n');
  const achadas = chamadas(tokenizar(fonte), 'reg', METODOS_DE_REGISTRO);
  assert.deepStrictEqual(achadas.map((a) => `${a.metodo} ${a.canal}`), [
    'handle dentro-do-template', 'on depois-da-divisao', 'handle template-fixo', 'once null',
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
