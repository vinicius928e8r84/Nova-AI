'use strict';

const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');

const AGORA = Date.UTC(2026, 10, 21, 12, 0, 0);
const RODADAS_POR_PASSO = 8;
const LIMITE_DE_PASSOS = 5000;

const SINCRONOS = new Set([
  'page.url', 'page.locator', 'page.getByRole', 'page.isClosed', 'page.context', 'locator.first', 'locator.nth',
  'context.pages', 'context.browser', 'browser.isConnected', 'download.url', 'download.suggestedFilename',
  'dialog.type', 'dialog.message', 'image.resize',
]);

const LIMITE_DE_TEXTO = 4000;
const resumoDoTexto = texto => 'sha256:' + require('crypto').createHash('sha256').update(texto).digest('hex') + ':' + texto.length;
const proximaVolta = () => new Promise(resolve => setImmediate(resolve));
const textoDaFuncao = funcao => String(funcao).replace(/\s+/g, ' ');

function descreverValor(valor) {
  if (valor === undefined) return '<undefined>';
  if (valor instanceof Error) return { erro: valor.name, mensagem: valor.message };
  if (typeof valor === 'function') return 'função: ' + textoDaFuncao(valor);
  if (Buffer.isBuffer(valor)) return 'buffer:' + valor.toString('base64');
  if (valor && valor.rotulo) return 'objeto: ' + valor.rotulo;
  return valor;
}

function normalizador(trocas) {
  const trocar = texto => trocas.reduce((atual, [de, para]) => atual.split(de).join(para), texto);
  return valor => {
    const texto = JSON.stringify(valor === undefined ? null : valor, (_, v) => {
      if (v?.type === 'Buffer' && Array.isArray(v?.data)) return 'buffer:' + Buffer.from(v.data).toString('base64');
      const descrito = descreverValor(v);
      return typeof descrito === 'string' ? trocar(descrito) : descrito;
    });
    return JSON.parse(texto === undefined ? 'null' : texto);
  };
}

const ELEMENTOS_DA_PAGINA = [
  { tagName: 'A', innerText: '  Primeiro link com um texto bem comprido  ', textContent: 'não usado', href: 'https://x/1', id: 'um', className: 'link forte', type: '' },
  { tagName: 'INPUT', innerText: '', textContent: '  conteúdo do campo  ', value: 'digitado', id: '', type: 'text', placeholder: 'Busque aqui' },
  { tagName: 'DIV', value: 0, href: '', placeholder: '' },
  { tagName: 'BUTTON', innerText: 'Ok', textContent: 'Ok', value: 'v', id: 'b', className: 'btn', type: 'submit' },
];

function lojaDaPagina(nome, anotar) {
  const itens = new Map([['chave', 'valor'], ['tema', 'escuro']]);
  return {
    get length() { return itens.size; },
    key: indice => [...itens.keys()][indice] ?? null,
    getItem: chave => (itens.has(chave) ? itens.get(chave) : null),
    setItem: (chave, valor) => { anotar(nome + '.setItem', chave, String(valor)); itens.set(chave, String(valor)); },
    clear: () => { anotar(nome + '.clear'); itens.clear(); },
  };
}

class EventoDaPagina {
  constructor(tipo, opcoes) {
    this.type = tipo;
    this.bubbles = Boolean(opcoes && opcoes.bubbles);
  }
}

function criarPaginaSimulada() {
  const chamadas = [];
  const anotar = (...chamada) => { chamadas.push(chamada); };
  const elemento = { style: { outline: 'none' }, dispatchEvent: evento => anotar('el.dispatchEvent', evento.type, evento.bubbles) };
  const contexto = {
    document: {
      querySelectorAll: seletor => { anotar('querySelectorAll', seletor); return ELEMENTOS_DA_PAGINA.map(item => ({ ...item })); },
      documentElement: { outerHTML: '<html><body>página inteira</body></html>' },
      body: { innerText: 'texto da página inteira, Pronto', scrollHeight: 4321 },
    },
    window: { scrollTo: (x, y) => anotar('window.scrollTo', x, y), scrollBy: (x, y) => anotar('window.scrollBy', x, y) },
    localStorage: lojaDaPagina('localStorage', anotar),
    sessionStorage: lojaDaPagina('sessionStorage', anotar),
    Event: EventoDaPagina,
    setTimeout: (_, atraso) => anotar('setTimeout na página', atraso),
  };
  return { contexto, chamadas, elemento };
}

function rodarNaPagina(funcao, montarArgumentos) {
  const { contexto, chamadas, elemento } = criarPaginaSimulada();
  try {
    const resultado = vm.runInNewContext(`(${String(funcao)})(...__argumentos)`, { ...contexto, __argumentos: montarArgumentos(elemento) });
    return { resultado, chamadas, contorno: elemento.style.outline };
  } catch (erro) {
    return { lancou: String(erro && erro.message), chamadas };
  }
}

const naPaginaOuTexto = (funcao, montarArgumentos) => (typeof funcao === 'function' ? { naPagina: rodarNaPagina(funcao, montarArgumentos) } : funcao);

class Relogio {
  constructor(palco) {
    this.palco = palco;
    this.agora = AGORA;
    this.pendentes = [];
    this.sequencia = 0;
  }

  agendar(funcao, atraso, argumentos) {
    const id = ++this.sequencia;
    this.palco.anotar('setTimeout', atraso);
    this.pendentes.push({ id, quando: this.agora + Math.max(0, Number(atraso) || 0), funcao, argumentos });
    return { id, unref() { return this; }, ref() { return this; } };
  }

  cancelar(marca) {
    if (!marca) return;
    const antes = this.pendentes.length;
    this.pendentes = this.pendentes.filter(item => item.id !== marca.id);
    if (this.pendentes.length !== antes) this.palco.anotar('clearTimeout');
  }

  avancar() {
    if (!this.pendentes.length) return false;
    this.pendentes.sort((a, b) => a.quando - b.quando || a.id - b.id);
    const proximo = this.pendentes.shift();
    this.agora = Math.max(this.agora, proximo.quando);
    proximo.funcao(...(proximo.argumentos || []));
    return true;
  }
}

function criarDataFixa(relogio) {
  const DataOriginal = Date;
  return class DataFixa extends DataOriginal {
    constructor(...argumentos) {
      super(...(argumentos.length ? argumentos : [relogio.agora]));
    }

    static now() {
      return relogio.agora;
    }
  };
}

class Falso {
  constructor(palco, tipo, rotulo, campos = {}) {
    this.palco = palco;
    this.tipo = tipo;
    this.rotulo = rotulo;
    Object.assign(this, campos);
  }

  chamar(metodo, argumentos, padrao) {
    return this.palco.responder(this, metodo, argumentos, padrao);
  }
}

class LocalizadorFalso extends Falso {
  constructor(palco, rotulo) {
    super(palco, 'locator', rotulo);
    const metodos = ['ariaSnapshot', 'innerHTML', 'innerText', 'click', 'dblclick', 'fill', 'pressSequentially', 'selectText', 'hover',
      'scrollIntoViewIfNeeded', 'selectOption', 'waitFor', 'setInputFiles', 'dragTo'];
    for (const metodo of metodos) this[metodo] = (...argumentos) => this.chamar(metodo, argumentos, () => this.palco.padrao('locator.' + metodo));
  }

  first() {
    return this.chamar('first', [], () => new LocalizadorFalso(this.palco, this.rotulo + '.first()'));
  }

  nth(indice) {
    return this.chamar('nth', [indice], () => new LocalizadorFalso(this.palco, `${this.rotulo}.nth(${indice})`));
  }

  elementHandle() {
    return this.chamar('elementHandle', [], () => this.palco.alca(this.rotulo));
  }

  screenshot(...argumentos) {
    return this.chamar('screenshot', argumentos, () => Buffer.from('png do ' + this.rotulo));
  }
}

const PADROES = {
  'locator.ariaSnapshot': () => '- banner:\n  - heading "Bem-vindo" [level=1]\n  - link "Entrar"\n- group:\n  - button "Dentro"\n- contentinfo:\n  - paragraph: rodapé\n- main:\n  - textbox "Busca": valor digitado\n  - button "Ok"\n  - button "Ok"\n  - list:\n    - listitem: um\n  - generic\n- paragraph: texto solto',
  'locator.innerHTML': () => '<b>conteúdo</b>',
  'locator.innerText': () => 'texto do elemento',
};

class PaginaFalsa extends Falso {
  constructor(palco, rotulo) {
    super(palco, 'page', rotulo, { endereco: 'about:blank', fechada: false, ouvintes: new EventEmitter() });
    this.keyboard = { press: (...argumentos) => this.chamar('keyboard.press', argumentos, () => undefined) };
    const metodos = ['waitForLoadState', 'waitForURL', 'waitForSelector', 'waitForTimeout', 'pdf', 'setViewportSize',
      'setExtraHTTPHeaders', 'emulateMedia', 'bringToFront', 'goBack', 'goForward', 'reload'];
    for (const metodo of metodos) this[metodo] = (...argumentos) => this.chamar(metodo, argumentos, () => undefined);
  }

  goto(url, opcoes) {
    return this.chamar('goto', [url, opcoes], () => { this.endereco = url; });
  }

  url() {
    return this.chamar('url', [], () => this.endereco);
  }

  title() {
    return this.chamar('title', [], () => 'Título de ' + this.endereco);
  }

  isClosed() {
    return this.chamar('isClosed', [], () => this.fechada);
  }

  close() {
    return this.chamar('close', [], () => {
      this.fechada = true;
      this.palco.contexto.paginas = this.palco.contexto.paginas.filter(pagina => pagina !== this);
    });
  }

  locator(seletor) {
    return this.chamar('locator', [seletor], () => new LocalizadorFalso(this.palco, `${this.rotulo}>locator(${seletor})`));
  }

  getByRole(papel, opcoes) {
    return this.chamar('getByRole', [papel, opcoes], () => new LocalizadorFalso(this.palco, `${this.rotulo}>role(${papel}${opcoes ? ' ' + JSON.stringify(opcoes) : ''})`));
  }

  context() {
    return this.chamar('context', [], () => this.palco.contexto);
  }

  evaluate(funcao, argumento) {
    const descrita = naPaginaOuTexto(funcao, () => [argumento]);
    return this.chamar('evaluate', [descrita, argumento], () => (descrita && descrita.naPagina ? descrita.naPagina.resultado : this.palco.avaliar(funcao)));
  }

  waitForFunction(funcao, ...resto) {
    return this.chamar('waitForFunction', [naPaginaOuTexto(funcao, () => [resto[0]]), ...resto], () => undefined);
  }

  screenshot(opcoes) {
    return this.chamar('screenshot', [opcoes], () => Buffer.from('png da página'));
  }

  waitForEvent(evento, opcoes) {
    return this.chamar('waitForEvent', [evento, opcoes], () => this.palco.esperarEvento(evento, opcoes));
  }

  on(evento, ouvinte) {
    this.palco.anotar(this.rotulo + '.on', evento);
    this.ouvintes.on(evento, ouvinte);
  }
}

class ContextoFalso extends Falso {
  constructor(palco, rotulo) {
    super(palco, 'context', rotulo, { paginas: [], ouvintes: new EventEmitter(), conectado: true });
    for (let i = 0; i < (palco.cenario.paginasIniciais ?? 1); i += 1) this.paginas.push(palco.novaPagina());
    const metodos = ['cookies', 'addCookies', 'clearCookies', 'setOffline', 'setHTTPCredentials', 'setGeolocation', 'grantPermissions'];
    for (const metodo of metodos) this[metodo] = (...argumentos) => this.chamar(metodo, argumentos, () => (metodo === 'cookies' ? [{ name: 'sessao', value: 'abc' }] : undefined));
  }

  pages() {
    return this.chamar('pages', [], () => this.paginas.slice());
  }

  newPage() {
    return this.chamar('newPage', [], () => {
      const pagina = this.palco.novaPagina();
      this.paginas.push(pagina);
      return pagina;
    });
  }

  close() {
    return this.chamar('close', [], () => {
      this.conectado = false;
      this.ouvintes.emit('close');
    });
  }

  browser() {
    return this.chamar('browser', [], () => this.palco.navegador(this));
  }

  newCDPSession(pagina) {
    return this.chamar('newCDPSession', [pagina], () => new Falso(this.palco, 'cdp', 'sessão cdp', {
      send: (...argumentos) => this.palco.responder({ tipo: 'cdp', rotulo: 'sessão cdp' }, 'send', argumentos, () => ({ nodes: [] })),
      detach: () => this.palco.responder({ tipo: 'cdp', rotulo: 'sessão cdp' }, 'detach', [], () => undefined),
    }));
  }

  on(evento, ouvinte) {
    this.palco.anotar(this.rotulo + '.on', evento);
    this.ouvintes.on(evento, ouvinte);
  }
}

function criarPlaywright(palco) {
  return {
    chromium: {
      launchPersistentContext: (pasta, opcoes) => palco.responder({ tipo: 'chromium', rotulo: 'chromium' }, 'launchPersistentContext', [pasta, opcoes], () => {
        palco.contexto = new ContextoFalso(palco, 'contexto' + (++palco.contextos));
        return palco.contexto;
      }),
    },
  };
}

function criarElectron(palco) {
  return {
    app: {
      getPath: nome => path.join(palco.raiz, nome),
      emit: (...argumentos) => palco.anotar('app.emit', ...argumentos),
    },
    ipcMain: {
      handle: (canal, tratar) => {
        palco.anotar('canal', canal);
        palco.canais.set(canal, tratar);
      },
    },
  };
}

function criarRede(palco) {
  const servidor = () => {
    const falso = new EventEmitter();
    falso.listen = (porta, host, aoEscutar) => {
      palco.anotar('net.listen', porta, host);
      const livre = (palco.cenario.portas || {})[porta] === undefined || palco.cenario.portas[porta] === 'livre';
      palco.relogio.agendar(() => (livre ? aoEscutar() : falso.emit('error', new Error('EADDRINUSE'))), 0);
    };
    falso.close = () => palco.anotar('net.close');
    return falso;
  };
  return { createServer: servidor };
}

const RESPOSTAS_DA_PORTA = {
  chrome: '{"Browser":"Chrome/131.0.6778.86"}',
  edge: '{"Browser":"Edg/120.0"}',
  adobe: '{"Browser":"Adobe UXP"}',
  vazio: '{}',
  html: '<html>não é cdp</html>',
};

function criarHttp(palco) {
  return {
    get: (opcoes, aoResponder) => {
      palco.anotar('http.get', opcoes);
      const pedido = new EventEmitter();
      pedido.destroy = () => palco.anotar('http.destroy', opcoes.port);
      const tipo = (palco.cenario.portas || {})[opcoes.port] || 'erro';
      const responder = () => {
        if (tipo === 'erro' || tipo === 'livre') return pedido.emit('error', new Error('ECONNREFUSED'));
        if (tipo === 'mudo') return pedido.emit('timeout');
        const resposta = new EventEmitter();
        aoResponder(resposta);
        resposta.emit('data', RESPOSTAS_DA_PORTA[tipo]);
        return resposta.emit('end');
      };
      palco.relogio.agendar(responder, tipo === 'mudo' ? opcoes.timeout : 0);
      return pedido;
    },
  };
}

function criarJimp(palco) {
  return {
    Jimp: {
      read: buffer => palco.responder({ tipo: 'jimp', rotulo: 'jimp' }, 'read', [buffer], () => {
        const largura = palco.cenario.larguraDaImagem || 800;
        const imagem = new Falso(palco, 'image', 'imagem', { bitmap: { width: largura, height: 600 } });
        imagem.resize = opcoes => palco.responder(imagem, 'resize', [opcoes], () => { imagem.bitmap = { width: opcoes.w, height: 450 }; });
        imagem.getBuffer = (...argumentos) => palco.responder(imagem, 'getBuffer', argumentos, () => Buffer.from('jpeg comprimido'));
        return imagem;
      }),
    },
  };
}

function proximoPasso(roteiro) {
  if (!roteiro || !roteiro.sequencia) return roteiro;
  return roteiro.sequencia.length > 1 ? roteiro.sequencia.shift() : roteiro.sequencia[0];
}

function executarPasso(palco, passo, argumentos, padrao) {
  if (passo === undefined) return padrao();
  if (passo && passo.falha) throw new Error(passo.falha);
  if (typeof passo === 'function') return passo(palco, ...argumentos);
  return passo;
}

function comoPromessa(executar) {
  try {
    return Promise.resolve(executar());
  } catch (erro) {
    return Promise.reject(erro);
  }
}

async function variasVoltas() {
  for (let rodada = 0; rodada < RODADAS_POR_PASSO; rodada += 1) await proximaVolta();
}

class Palco {
  constructor(modulo, cenario) {
    this.modulo = modulo;
    this.cenario = cenario;
    this.raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'navegador-'));
    this.entradas = [];
    this.canais = new Map();
    this.relogio = new Relogio(this);
    this.roteiro = { ...(cenario.roteiro || {}) };
    this.paginasCriadas = 0;
    this.contextos = 0;
    this.contexto = null;
    this.desfazer = [];
    this.normalizar = normalizador([[path.resolve(path.dirname(modulo), '..', '..'), '<app>'], [this.raiz, '<raiz>']]);
  }

  anotar(...entrada) {
    this.entradas.push(this.normalizar(entrada));
  }

  responder(alvo, metodo, argumentos, padrao) {
    const chave = `${alvo.tipo}.${metodo}`;
    this.anotar(`${alvo.rotulo}.${metodo}`, ...argumentos);
    const passo = proximoPasso(this.roteiro[chave]);
    const executar = () => executarPasso(this, passo, argumentos, padrao);
    return SINCRONOS.has(chave) ? executar() : comoPromessa(executar);
  }

  padrao(chave) {
    return PADROES[chave] ? PADROES[chave]() : undefined;
  }

  novaPagina() {
    return new PaginaFalsa(this, 'p' + (++this.paginasCriadas));
  }

  navegador(contexto) {
    const falso = new Falso(this, 'browser', 'navegador de ' + contexto.rotulo);
    falso.isConnected = () => this.responder(falso, 'isConnected', [], () => contexto.conectado);
    return falso;
  }

  alca(rotulo) {
    const alca = new Falso(this, 'handle', 'alça de ' + rotulo);
    alca.evaluate = funcao => this.responder(alca, 'evaluate', [naPaginaOuTexto(funcao, elemento => [elemento])], () => undefined);
    return alca;
  }

  avaliar(funcao) {
    const texto = String(funcao);
    if (texto.includes('outerHTML')) return '<html><body>página inteira</body></html>';
    if (texto.includes('querySelectorAll')) return [{ index: 0, tag: 'a', text: 'link', value: '', href: 'https://x', id: '', className: 'c', type: '', placeholder: '' }];
    if (texto.includes('innerText.substring')) return 'texto da página inteira';
    if (texto.includes('getItem')) return { chave: 'valor' };
    return undefined;
  }

  esperarEvento(evento, opcoes) {
    const fabrica = (this.cenario.eventos || {})[evento];
    if (fabrica) return fabrica(this);
    return new Promise((_, rejeitar) => {
      this.relogio.agendar(() => rejeitar(new Error(`Timeout ${opcoes.timeout}ms exceeded while waiting for event "${evento}"`)), opcoes.timeout);
    });
  }

  emitirNaPagina(indice, evento, carga) {
    this.contexto.paginas[indice].ouvintes.emit(evento, carga);
  }

  falsos() {
    return {
      playwright: criarPlaywright(this),
      electron: criarElectron(this),
      net: criarRede(this),
      http: criarHttp(this),
      jimp: criarJimp(this),
      './platform-utils': {
        findBundledChromiumExecutable: pastas => {
          this.anotar('findBundledChromiumExecutable', pastas);
          return this.cenario.binarioEscaneado || null;
        },
        getDefaultUserAgent: () => 'UA de teste',
      },
      './mac-native': { browser: tipo => { this.anotar('mac-native.browser', tipo); return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; } },
    };
  }

  carregar() {
    const pastaDoModulo = path.dirname(this.modulo);
    for (const chave of Object.keys(require.cache)) {
      if (path.dirname(chave) === pastaDoModulo) delete require.cache[chave];
    }
    const falsos = this.falsos();
    const carregadorOriginal = Module._load;
    Module._load = function carregar(pedido, pai, ...resto) {
      const doModulo = pai && pai.filename && path.dirname(pai.filename) === pastaDoModulo;
      if (doModulo && pedido in falsos) return falsos[pedido];
      return carregadorOriginal.call(this, pedido, pai, ...resto);
    };
    this.desfazer.push(() => { Module._load = carregadorOriginal; });
    return require(this.modulo);
  }

  async avancarAte(estado) {
    for (let passo = 0; passo < LIMITE_DE_PASSOS; passo += 1) {
      await variasVoltas();
      if (estado.terminou) return;
      if (!this.relogio.avancar()) throw new Error('a operação travou sem temporizador pendente');
    }
    throw new Error('a operação não terminou');
  }

  async ate(promessa) {
    const estado = { terminou: false };
    promessa.then(valor => Object.assign(estado, { terminou: true, valor }), erro => Object.assign(estado, { terminou: true, erro, falhou: true }));
    await this.avancarAte(estado);
    if (estado.falhou) throw estado.erro;
    return estado.valor;
  }

  async rodar(rotulo, fazer) {
    try {
      this.anotar('retorno', rotulo, await this.ate(Promise.resolve().then(fazer)));
    } catch (erro) {
      this.anotar('lançou', rotulo, erro);
    }
  }

  chamarCanal(canal, ...argumentos) {
    const tratar = this.canais.get(canal);
    if (!tratar) return this.anotar('sem canal', canal);
    return this.rodar(canal, () => tratar({ sender: 'janela' }, ...argumentos));
  }

  async esgotar() {
    while (this.relogio.avancar()) await variasVoltas();
  }

  criarArquivo(relativo, conteudo = 'x', mtime) {
    const caminho = path.join(this.raiz, relativo);
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
    fs.writeFileSync(caminho, conteudo);
    if (mtime !== undefined) fs.utimesSync(caminho, mtime / 1000, mtime / 1000);
    return caminho;
  }

  fotografar() {
    const listar = pasta => fs.readdirSync(pasta, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entrada => {
      const caminho = path.join(pasta, entrada.name);
      if (entrada.isDirectory()) return [{ caminho: path.relative(this.raiz, caminho) + '/' }, ...listar(caminho)];
      const conteudo = this.normalizar(fs.readFileSync(caminho, 'utf8'));
      return [{ caminho: path.relative(this.raiz, caminho), conteudo: conteudo.length > LIMITE_DE_TEXTO ? resumoDoTexto(conteudo) : conteudo }];
    });
    this.anotar('arquivos', listar(this.raiz));
  }

  trocarAmbiente() {
    const original = { Date: global.Date, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout, console: { ...console } };
    const plataforma = Object.getOwnPropertyDescriptor(process, 'platform');
    const recursos = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
    global.Date = criarDataFixa(this.relogio);
    global.setTimeout = (funcao, atraso, ...argumentos) => this.relogio.agendar(funcao, atraso, argumentos);
    global.clearTimeout = marca => this.relogio.cancelar(marca);
    Object.defineProperty(process, 'platform', { ...plataforma, value: this.cenario.plataforma || 'win32' });
    process.resourcesPath = this.cenario.semRecursos ? undefined : path.join(this.raiz, 'resources');
    for (const [nome, saida] of [['log', 'stdout'], ['info', 'stdout'], ['warn', 'warn'], ['error', 'error']]) {
      console[nome] = (...argumentos) => this.anotar(saida, ...argumentos);
    }
    this.desfazer.push(() => {
      Object.assign(global, { Date: original.Date, setTimeout: original.setTimeout, clearTimeout: original.clearTimeout });
      Object.assign(console, original.console);
      Object.defineProperty(process, 'platform', plataforma);
      if (recursos) Object.defineProperty(process, 'resourcesPath', recursos);
      else delete process.resourcesPath;
    });
  }

  restaurar() {
    for (const desfazer of this.desfazer.splice(0).reverse()) desfazer();
    fs.rmSync(this.raiz, { recursive: true, force: true });
  }
}

async function rodarCena(modulo, cena) {
  const palco = new Palco(modulo, cena.cenario || {});
  try {
    palco.trocarAmbiente();
    if (cena.preparar) cena.preparar(palco);
    const exportado = palco.carregar();
    await cena.rodar(palco, exportado);
    await palco.esgotar();
    palco.fotografar();
    return palco.entradas;
  } finally {
    palco.restaurar();
  }
}

module.exports = { rodarCena, AGORA };
