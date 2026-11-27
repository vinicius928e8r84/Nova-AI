'use strict';

const vm = require('vm');

const INICIO_DO_RELOGIO = 1700000000000;

function descrever(valor) {
  if (typeof valor === 'function') return 'função';
  if (valor && typeof valor === 'object') return 'objeto';
  return valor === undefined ? 'undefined' : valor;
}

function criarRegistro(cenario) {
  const entradas = [];
  return {
    cenario,
    entradas,
    agora: INICIO_DO_RELOGIO,
    elementos: {},
    temporizadores: [],
    sockets: [],
    anotar: (...entrada) => entradas.push(entrada.map(descrever)),
  };
}

function criarEstilo(registro, nome) {
  return new Proxy({}, {
    set: (alvo, propriedade, valor) => {
      registro.anotar(nome + '.style.' + String(propriedade), valor);
      alvo[propriedade] = valor;
      return true;
    },
  });
}

function criarClasses(registro, nome) {
  return {
    toggle: (classe, forcar) => registro.anotar(nome + '.classList.toggle', classe, forcar),
  };
}

function promessaDoCenario(registro, falha) {
  return registro.cenario[falha] ? Promise.reject(new Error(falha)) : Promise.resolve();
}

function metodosDoElemento(registro, nome) {
  const ouvintes = registro.elementos[nome].ouvintes;
  return {
    addEventListener: (evento, ouvinte, opcoes) => {
      registro.anotar(nome + '.addEventListener', evento, opcoes ? JSON.stringify(opcoes) : 'sem-opcoes');
      ouvintes[evento] = ouvinte;
    },
    play: () => {
      registro.anotar(nome + '.play');
      return promessaDoCenario(registro, 'playFalha');
    },
    pause: () => registro.anotar(nome + '.pause'),
    load: () => registro.anotar(nome + '.load'),
    getContext: tipo => {
      registro.anotar(nome + '.getContext', tipo);
      return criarElemento(registro, nome + '.ctx');
    },
    drawImage: (origem, x, y, largura, altura) => registro.anotar(nome + '.drawImage', x, y, largura, altura),
    toDataURL: (tipo, qualidade) => {
      registro.anotar(nome + '.toDataURL', tipo, qualidade);
      return 'data:' + tipo + ';' + qualidade;
    },
    requestFullscreen: () => {
      registro.anotar(nome + '.requestFullscreen');
      return promessaDoCenario(registro, 'telaCheiaFalha');
    },
  };
}

function criarElemento(registro, nome) {
  registro.elementos[nome] = { valores: { paused: true, currentTime: 0, videoWidth: 0 }, ouvintes: {} };
  const { valores } = registro.elementos[nome];
  valores.style = criarEstilo(registro, nome);
  valores.classList = criarClasses(registro, nome);
  const metodos = metodosDoElemento(registro, nome);
  return new Proxy(valores, {
    get: (alvo, propriedade) => (Object.hasOwn(metodos, propriedade) ? metodos[propriedade] : alvo[propriedade]),
    set: (alvo, propriedade, valor) => {
      registro.anotar(nome + '.' + String(propriedade), descrever(valor));
      alvo[propriedade] = valor;
      return true;
    },
  });
}

function criarWebSocket(registro) {
  class WebSocketFalso {
    constructor(url) {
      registro.anotar('new WebSocket', url);
      this.readyState = registro.cenario.wsEstado ?? 1;
      registro.sockets.push(this);
    }

    send(dado) {
      registro.anotar('ws.send', String(dado));
    }
  }
  WebSocketFalso.OPEN = 1;
  return WebSocketFalso;
}

function criarTemporizadores(registro) {
  const agendar = tipo => (funcao, atraso) => {
    registro.anotar(tipo, atraso);
    registro.temporizadores.push({ tipo, funcao, atraso });
    return registro.temporizadores.length;
  };
  return {
    setInterval: agendar('setInterval'),
    setTimeout: agendar('setTimeout'),
    clearInterval: id => registro.anotar('clearInterval', id),
  };
}

function criarMidia(registro) {
  const faixa = { stop: () => registro.anotar('track.stop') };
  return {
    mediaDevices: {
      getUserMedia: async pedido => {
        registro.anotar('getUserMedia', JSON.stringify(pedido));
        if (registro.cenario.cameraNegada) throw new Error('Permission denied');
        return { getTracks: () => [faixa, faixa] };
      },
    },
  };
}

function criarDocumento(registro) {
  const elementos = {};
  const pegar = id => {
    elementos[id] = elementos[id] || criarElemento(registro, id);
    return elementos[id];
  };
  return {
    getElementById: pegar,
    body: pegar('body'),
    documentElement: pegar('html'),
    fullscreenElement: null,
    exitFullscreen: () => {
      registro.anotar('document.exitFullscreen');
      return Promise.resolve();
    },
  };
}

function criarContexto(registro) {
  return vm.createContext({
    document: criarDocumento(registro),
    location: { protocol: registro.cenario.protocolo ?? 'https:', host: '192.0.2.10:8899' },
    navigator: criarMidia(registro),
    WebSocket: criarWebSocket(registro),
    Date: { now: () => registro.agora },
    alert: texto => registro.anotar('alert', texto),
    ...criarTemporizadores(registro),
  });
}

function scriptDaPagina(html) {
  const inicio = html.indexOf('<script>') + '<script>'.length;
  return html.slice(inicio, html.indexOf('</script>', inicio));
}

const esperarPromessas = () => new Promise(resolver => setImmediate(resolver));

function controlesDaPagina(registro, documento) {
  return {
    elemento: id => documento.getElementById(id),
    valores: id => registro.elementos[id].valores,
    disparar: async (id, evento, argumento) => {
      registro.anotar('>> ' + id + ' ' + evento);
      await registro.elementos[id].ouvintes[evento](argumento);
      await esperarPromessas();
    },
    socket: () => registro.sockets[registro.sockets.length - 1],
    rodarTemporizador: async tipo => {
      const temporizador = registro.temporizadores.filter(agendado => agendado.tipo === tipo).pop();
      registro.anotar('>> ' + tipo, temporizador ? temporizador.atraso : 'nenhum');
      if (temporizador) await temporizador.funcao();
      await esperarPromessas();
    },
    avancarRelogio: ms => {
      registro.agora += ms;
    },
    esperarPromessas,
    anotar: registro.anotar,
    documento,
  };
}

async function rodarPagina(html, roteiro, cenario = {}) {
  const registro = criarRegistro(cenario);
  const contexto = criarContexto(registro);
  const pagina = controlesDaPagina(registro, contexto.document);
  try {
    vm.runInContext(scriptDaPagina(html), contexto);
    await esperarPromessas();
    await roteiro(pagina);
  } catch (erro) {
    registro.anotar('erro', erro.message);
  }
  return registro.entradas;
}

module.exports = { rodarPagina, scriptDaPagina };
