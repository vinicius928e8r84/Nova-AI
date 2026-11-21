'use strict';

const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { DatabaseSync } = require('node:sqlite');
const { marcarCaminhos, relativoEmPosix } = require('./caminhos-do-palco');

const AGORA = Date.UTC(2026, 10, 21, 12, 0, 0);
const RELOGIO_DO_BANCO = "'2026-11-21 12:00:00'";
const TIPOS_QUE_O_SQLITE_ACEITA = new Set(['number', 'string', 'bigint']);
const RODADAS_DE_ESPERA = 60;
const SUFIXOS_DO_WAL = ['-wal', '-shm'];
const PASSOS_DE_LEITURA = new Set(['select', 'maybeSingle']);

const valorAceitoPeloSqlite = valor => valor === null || TIPOS_QUE_O_SQLITE_ACEITA.has(typeof valor) || Buffer.isBuffer(valor);
const comRelogioFixo = sql => sql.replace(/CURRENT_TIMESTAMP/g, RELOGIO_DO_BANCO);
const proximaVolta = () => new Promise(resolve => setImmediate(resolve));
const linhaSimples = linha => (linha === undefined ? undefined : { ...linha });

function conferirParametros(parametros) {
  if (!parametros.every(valorAceitoPeloSqlite)) throw new TypeError('SQLite3 can only bind numbers, strings, bigints, buffers, and null');
  return parametros;
}

function descreverValor(valor) {
  if (valor === undefined) return '<undefined>';
  if (valor instanceof Error) return { erro: valor.name, mensagem: valor.message };
  if (typeof valor === 'function') return 'função';
  if (Buffer.isBuffer(valor)) return 'buffer:' + valor.toString('base64');
  return valor;
}

function normalizar(valor, raiz, separador = path.sep) {
  const trocas = [[raiz, '<raiz>'], [raiz.replace(/'/g, "''"), '<raiz>']];
  const texto = JSON.stringify(valor === undefined ? null : valor, (_, v) => {
    const descrito = descreverValor(v);
    if (typeof descrito !== 'string') return descrito;
    return marcarCaminhos(descrito, trocas, separador);
  });
  return JSON.parse(texto === undefined ? 'null' : texto);
}

class DeclaracaoFalsa {
  constructor(declaracao) {
    this.declaracao = declaracao;
  }

  run(...parametros) {
    return { ...this.declaracao.run(...conferirParametros(parametros)) };
  }

  get(...parametros) {
    return linhaSimples(this.declaracao.get(...conferirParametros(parametros)));
  }

  all(...parametros) {
    return this.declaracao.all(...conferirParametros(parametros)).map(linhaSimples);
  }
}

function criarBanco(palco) {
  return class BancoFalso {
    constructor(caminho) {
      palco.anotar('db.abrir', caminho);
      if (palco.cenario.falhaAoAbrir) throw new Error('unable to open database file');
      this.banco = new DatabaseSync(caminho);
    }

    pragma(texto) {
      palco.anotar('db.pragma', texto);
      return this.banco.prepare('PRAGMA ' + texto).all().map(linhaSimples);
    }

    exec(sql) {
      this.banco.exec(comRelogioFixo(sql));
      return this;
    }

    prepare(sql) {
      return new DeclaracaoFalsa(this.banco.prepare(comRelogioFixo(sql)));
    }

    transaction(fazer) {
      return (...argumentos) => {
        this.banco.exec('BEGIN');
        try {
          const resultado = fazer(...argumentos);
          this.banco.exec('COMMIT');
          return resultado;
        } catch (erro) {
          this.banco.exec('ROLLBACK');
          throw erro;
        }
      };
    }

    close() {
      palco.anotar('db.fechar');
      this.banco.close();
    }
  };
}

class ConsultaFalsa {
  constructor(palco, tabela) {
    this.palco = palco;
    this.tabela = tabela;
    this.passos = [];
    for (const metodo of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'order', 'limit', 'maybeSingle']) {
      this[metodo] = (...argumentos) => this.passo(metodo, argumentos);
    }
  }

  passo(metodo, argumentos) {
    this.passos.push([metodo, ...argumentos]);
    return this;
  }

  resposta() {
    const nuvem = this.palco.cenario.nuvem || {};
    const lendo = this.passos.some(([metodo]) => PASSOS_DE_LEITURA.has(metodo));
    if (lendo) return (nuvem.tabelas || {})[this.tabela] || { data: null, error: { message: 'sem dados de ' + this.tabela } };
    const recusada = (nuvem.recusa || []).includes(this.tabela);
    return { data: null, error: recusada ? { message: 'recusado: ' + this.tabela } : null };
  }

  then(seCumprir, seFalhar) {
    this.palco.anotar('supabase', this.tabela, this.passos);
    return this.palco.pendente(Promise.resolve(this.resposta())).then(seCumprir, seFalhar);
  }
}

function criarAutenticacao(palco) {
  const nuvem = () => palco.cenario.nuvem || {};
  const responder = (nome, argumentos, padrao) => {
    palco.anotar('supabase.auth.' + nome, argumentos);
    const resposta = nuvem()[nome];
    if (resposta instanceof Error) return Promise.reject(resposta);
    return Promise.resolve(resposta || padrao);
  };
  return {
    getSession: () => responder('getSession', null, { data: { session: null }, error: null }),
    signInWithPassword: argumentos => responder('signInWithPassword', argumentos, { data: { user: { email: argumentos.email } }, error: null }),
    signUp: argumentos => responder('signUp', argumentos, { data: { user: { email: argumentos.email } }, error: null }),
    signOut: () => responder('signOut', null, { error: null }),
  };
}

function criarSupabase(palco) {
  return {
    createClient: (url, chave, opcoes) => {
      const { storage, ...auth } = opcoes.auth;
      palco.anotar('supabase.createClient', url, chave, auth, Object.keys(storage), opcoes.realtime.transport === palco.ws);
      if ((palco.cenario.nuvem || {}).falhaAoCriar) throw new Error('Invalid supabaseUrl');
      palco.armazenamento = storage;
      return {
        auth: criarAutenticacao(palco),
        from: tabela => {
          if ((palco.cenario.nuvem || {}).quebra === tabela) throw new Error('rede caiu em ' + tabela);
          return new ConsultaFalsa(palco, tabela);
        },
      };
    },
  };
}

function fotografarPasta(pasta, prefixo) {
  if (!fs.existsSync(pasta)) return [];
  return fs.readdirSync(pasta).sort().map(nome => ({ nome: prefixo + '/' + nome, conteudo: fs.readFileSync(path.join(pasta, nome)).toString('base64') }));
}

function criarArquivoZip(palco) {
  const zip = new EventEmitter();
  const entradas = [];
  zip.pipe = saida => {
    palco.anotar('archiver.pipe', saida.path);
    zip.saida = saida;
  };
  zip.file = (caminho, opcoes) => {
    palco.anotar('archiver.file', caminho, opcoes);
    entradas.push({ nome: opcoes.name, conteudo: fs.readFileSync(caminho).toString('base64') });
  };
  zip.directory = (pasta, nome) => {
    palco.anotar('archiver.directory', pasta, nome);
    entradas.push(...fotografarPasta(pasta, nome));
  };
  zip.finalize = () => {
    palco.anotar('archiver.finalize');
    const fechado = new Promise(resolve => {
      zip.saida.on('close', resolve);
      zip.saida.end(JSON.stringify(entradas));
    });
    if (!palco.cenario.zipFalha) return palco.pendente(fechado);
    palco.pendente(fechado);
    zip.emit('error', new Error('disco cheio'));
    return Promise.resolve();
  };
  return zip;
}

function criarArchiver(palco) {
  return (formato, opcoes) => {
    palco.anotar('archiver', formato, opcoes);
    return criarArquivoZip(palco);
  };
}

function criarNodemailer(palco) {
  return {
    createTransport: opcoes => {
      palco.anotar('nodemailer.createTransport', opcoes);
      return {
        sendMail: correio => {
          palco.anotar('nodemailer.sendMail', correio, correio.attachments.map(anexo => fs.existsSync(anexo.path)));
          const falha = palco.cenario.emailFalha;
          return palco.pendente(falha ? Promise.reject(new Error(falha)) : Promise.resolve({ messageId: 'm-1' }));
        },
      };
    },
  };
}

function extrairZip(arquivo, destino) {
  const entradas = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  for (const entrada of entradas) {
    const caminho = path.join(destino, entrada.nome);
    fs.mkdirSync(path.dirname(caminho), { recursive: true });
    fs.writeFileSync(caminho, Buffer.from(entrada.conteudo, 'base64'));
  }
}

function criarProcessos(palco) {
  const extrair = (origem, destino, aoTerminar) => {
    const falha = palco.cenario.extracaoFalha;
    const terminar = () => {
      if (falha) return aoTerminar(new Error('código 1'), '', falha === 'sem-stderr' ? '' : falha);
      extrairZip(origem, destino);
      return aoTerminar(null, 'extraído', '');
    };
    palco.pendente(new Promise(resolve => setImmediate(() => resolve(terminar()))));
  };
  return {
    exec: (comando, aoTerminar) => {
      palco.anotar('child_process.exec', comando);
      const [origem, destino] = /-Path '(.*?)' -DestinationPath '(.*?)' -Force/.exec(comando).slice(1).map(trecho => trecho.replace(/''/g, "'"));
      extrair(origem, destino, aoTerminar);
    },
    execFile: (arquivo, argumentos, aoTerminar) => {
      palco.anotar('child_process.execFile', arquivo, argumentos);
      extrair(argumentos[2], argumentos[3], aoTerminar);
    },
  };
}

function criarElectron(palco) {
  return {
    app: {
      isPackaged: Boolean(palco.cenario.empacotado),
      getAppPath: () => path.join(palco.raiz, 'app'),
      getPath: nome => path.join(palco.raiz, nome),
    },
    ipcMain: {
      handle: (canal, tratar) => {
        palco.anotar('canal', canal);
        palco.canais.set(canal, tratar);
      },
    },
    dialog: {
      showOpenDialog: async opcoes => {
        palco.anotar('dialog.showOpenDialog', opcoes);
        return palco.proximoDialogo || { canceled: true, filePaths: [] };
      },
    },
  };
}

function criarWhatsApp(palco, opcoes) {
  const enviar = (nome, argumentos) => {
    palco.anotar('whatsapp.' + nome, ...argumentos);
    return palco.pendente(opcoes.falha ? Promise.reject(new Error(opcoes.falha)) : Promise.resolve(true));
  };
  return {
    client: opcoes.semCliente ? null : {},
    isReady: opcoes.pronto !== false,
    sendToOwner: (...argumentos) => enviar('sendToOwner', argumentos),
    sendReply: (...argumentos) => enviar('sendReply', argumentos),
  };
}

function criarDataFixa() {
  const DataOriginal = Date;
  return class DataFixa extends DataOriginal {
    constructor(...argumentos) {
      super(...(argumentos.length ? argumentos : [AGORA]));
    }

    static now() {
      return AGORA;
    }

    toLocaleString() {
      return 'data-local';
    }

    toLocaleDateString() {
      return 'dia-local';
    }
  };
}

function listarArquivos(pasta, raiz) {
  return fs.readdirSync(pasta, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entrada => {
    const caminho = path.join(pasta, entrada.name);
    if (entrada.isDirectory()) return [relativoEmPosix(raiz, caminho) + '/', ...listarArquivos(caminho, raiz)];
    if (SUFIXOS_DO_WAL.some(sufixo => entrada.name.endsWith(sufixo))) return [];
    return [relativoEmPosix(raiz, caminho)];
  });
}

function despejarBanco(caminho) {
  const banco = new DatabaseSync(caminho, { readOnly: true });
  try {
    const tabelas = banco.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    return tabelas.map(({ name, sql }) => ({ tabela: name, sql, linhas: banco.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map(linhaSimples) }));
  } finally {
    banco.close();
  }
}

class Palco {
  constructor(modulo, cenario) {
    this.modulo = modulo;
    this.cenario = cenario;
    this.raiz = fs.mkdtempSync(path.join(os.tmpdir(), cenario.pastaComApostrofo ? "invent'ario-" : 'inventario-'));
    this.entradas = [];
    this.canais = new Map();
    this.pendentes = [];
    this.ws = { nome: 'ws' };
    this.proximoDialogo = null;
  }

  anotar(...entrada) {
    this.entradas.push(normalizar(entrada, this.raiz));
  }

  pendente(promessa) {
    this.pendentes.push(promessa);
    return promessa;
  }

  get pastaDoInventario() {
    return path.join(this.vault, 'inventory');
  }

  get vault() {
    const desenvolvimento = !this.cenario.empacotado && process.env.NODE_ENV !== 'production';
    const pastaDoApp = path.join(this.raiz, 'app', 'Nova_Vault');
    return desenvolvimento && fs.existsSync(pastaDoApp) ? pastaDoApp : path.join(this.raiz, 'documents', 'Nova_Vault');
  }

  falsos() {
    return {
      electron: criarElectron(this),
      'better-sqlite3': criarBanco(this),
      '@supabase/supabase-js': criarSupabase(this),
      ws: this.ws,
      archiver: criarArchiver(this),
      nodemailer: criarNodemailer(this),
      child_process: criarProcessos(this),
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
    return require(this.modulo).inventoryManager;
  }

  async esperarTudo() {
    for (let rodada = 0; rodada < RODADAS_DE_ESPERA; rodada += 1) {
      await Promise.allSettled(this.pendentes.splice(0));
      await proximaVolta();
    }
  }

  async chamar(canal, ...argumentos) {
    const tratar = this.canais.get(canal);
    if (!tratar) return this.anotar('sem canal', canal);
    try {
      this.anotar('retorno', canal, await tratar({ sender: 'janela' }, ...argumentos));
    } catch (erro) {
      this.anotar('rejeitou', canal, erro);
    }
    return this.esperarTudo();
  }

  whatsapp(opcoes) {
    if (opcoes === undefined) return undefined;
    this.trocarWhatsApp(opcoes);
    return () => this.whatsappAtual;
  }

  trocarWhatsApp(opcoes) {
    this.whatsappAtual = opcoes && criarWhatsApp(this, opcoes);
  }

  semearPasta(relativa) {
    fs.mkdirSync(path.join(this.raiz, relativa), { recursive: true });
  }

  ultimoZip() {
    const nomes = fs.readdirSync(this.pastaDoInventario).filter(nome => nome.startsWith('nova_inventory_backup_'));
    return path.join(this.pastaDoInventario, nomes.sort().pop());
  }

  zipSoComImagens() {
    const arquivo = path.join(this.raiz, 'so-imagens.zip');
    fs.writeFileSync(arquivo, JSON.stringify([{ nome: 'product_images/solta.png', conteudo: 'AAAA' }]));
    return arquivo;
  }

  semear(sql) {
    fs.mkdirSync(this.pastaDoInventario, { recursive: true });
    const banco = new DatabaseSync(path.join(this.pastaDoInventario, 'inventory.db'), { enableForeignKeyConstraints: false });
    banco.exec(sql);
    banco.close();
  }

  fotografar() {
    const caminho = path.join(this.pastaDoInventario, 'inventory.db');
    this.anotar('arquivos', listarArquivos(this.raiz, this.raiz));
    if (fs.existsSync(caminho)) this.anotar('banco', despejarBanco(caminho));
  }

  trocarAmbiente() {
    const DataOriginal = global.Date;
    const plataforma = Object.getOwnPropertyDescriptor(process, 'platform');
    const consoleOriginal = { ...console };
    global.Date = criarDataFixa();
    Object.defineProperty(process, 'platform', { ...plataforma, value: this.cenario.plataforma || 'darwin' });
    for (const [nome, saida] of [['log', 'stdout'], ['info', 'stdout'], ['warn', 'warn'], ['error', 'error']]) {
      console[nome] = (...argumentos) => this.anotar(saida, ...argumentos);
    }
    const semTratamento = motivo => this.anotar('rejeição sem tratamento', motivo);
    process.on('unhandledRejection', semTratamento);
    this.desfazer.push(() => {
      process.off('unhandledRejection', semTratamento);
      global.Date = DataOriginal;
      Object.defineProperty(process, 'platform', plataforma);
      Object.assign(console, consoleOriginal);
    });
  }

  restaurar() {
    for (const desfazer of this.desfazer.splice(0).reverse()) desfazer();
    fs.rmSync(this.raiz, { recursive: true, force: true });
  }
}

async function rodarCena(modulo, cena) {
  const palco = new Palco(modulo, cena.cenario || {});
  palco.desfazer = [];
  try {
    palco.trocarAmbiente();
    if (cena.preparar) cena.preparar(palco);
    const gerente = palco.carregar();
    await cena.rodar(palco, gerente);
    await palco.esperarTudo();
    palco.fotografar();
    return palco.entradas;
  } finally {
    palco.restaurar();
  }
}

module.exports = { rodarCena, AGORA, normalizar, relativoEmPosix };
