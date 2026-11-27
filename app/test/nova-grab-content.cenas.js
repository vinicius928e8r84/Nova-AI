'use strict';
const { ElementoFalso } = require('./ajuda/dom-falso');

const URL_LONGA = `https://www.youtube.com/watch?v=abc123&feature=share&pp=${'x'.repeat(70)}&list=PL1&index=3`;
const TITULO_ESTRANHO = '  Meu <vídeo>: "teste" / parte\\1 | ? * com um nome bem comprido para cortar  ';

const filhos = no => no.nos.filter(item => item instanceof ElementoFalso);
const ultimo = lista => lista[lista.length - 1];

const barra = palco => palco.porId('ng-trigger');
const faixa = palco => filhos(barra(palco))[0];
const fecharBarra = palco => filhos(barra(palco))[1];
const formato = (palco, indice) => filhos(palco.porId('ng-dropdown'))[indice];
const tituloDe = (palco, id) => filhos(palco.porId(id))[0];
const botoesDe = (palco, id) => filhos(ultimo(filhos(ultimo(filhos(palco.porId(id))))));

function criar(documento, pai, tag, marcas = {}) {
  const elemento = documento.createElement(tag);
  Object.assign(elemento, marcas);
  pai.appendChild(elemento);
  return elemento;
}

function paginaComTitulo(montar) {
  return documento => montar(documento, documento.body);
}

function abrirBarra(palco) {
  palco.avancar(2000);
}

function abrirInfo(palco, indice = 0) {
  abrirBarra(palco);
  palco.clicar(formato(palco, indice), `formato ${indice}`);
}

function abrirProgresso(palco, indice = 0) {
  abrirInfo(palco, indice);
  palco.clicar(botoesDe(palco, 'ng-fileinfo')[2], 'Start Download');
}

function cena(nome, passos, extras = {}) {
  return { nome, passos, ...extras };
}

const CENAS_DA_BARRA = [
  cena('carrega, monta a barra e reposiciona sem player', (palco) => {
    palco.foto('carregado');
    abrirBarra(palco);
    palco.foto('barra');
    palco.avancar(400);
    palco.foto('depois de 400 ms');
  }),
  cena('reposiciona perto do #movie_player', (palco) => {
    abrirBarra(palco);
    palco.avancar(400);
    palco.foto('perto do player');
  }, { pagina: documento => { criar(documento, documento.body, 'div', { id: 'movie_player', retangulo: { top: -50, right: 1000, width: 640 } }); } }),
  cena('player sem largura não reposiciona', (palco) => {
    abrirBarra(palco);
    palco.avancar(400);
    palco.foto('player sem largura');
  }, { pagina: documento => { criar(documento, documento.body, 'ytd-player', { retangulo: { top: 300, right: 900, width: 0 } }); } }),
  cena('player por classe, perto da borda', (palco) => {
    abrirBarra(palco);
    palco.avancar(400);
    palco.foto('player na borda');
  }, { pagina: documento => { criar(documento, documento.body, 'div', { className: 'html5-video-player outra', retangulo: { top: 100, right: 200, width: 200 } }); } }),
  cena('abre e fecha a lista de formatos', (palco) => {
    abrirBarra(palco);
    palco.clicar(faixa(palco), 'faixa');
    palco.foto('lista aberta');
    palco.clicar(faixa(palco), 'faixa');
    palco.foto('lista fechada');
  }),
  cena('fecha a barra no ✕ e o observador a remonta', (palco) => {
    abrirBarra(palco);
    palco.clicar(fecharBarra(palco), 'fechar barra');
    palco.foto('sem barra');
    palco.mutar();
    palco.foto('remontada pelo observador');
    palco.mutar();
    palco.avancar(35000);
    palco.foto('sumiu em 35 s');
  }),
  cena('arrasta a barra pela faixa', (palco) => {
    abrirBarra(palco);
    Object.assign(barra(palco), { offsetLeft: 120, offsetTop: 40 });
    palco.arrastar(faixa(palco), [10, 10], [55, 75]);
    palco.foto('arrastada');
    palco.documento.disparar('mousemove', palco.evento('mousemove', { clientX: 0, clientY: 0 }));
    palco.foto('solta');
  }),
  cena('CSS já injetado não duplica', (palco) => {
    abrirBarra(palco);
    palco.foto('um estilo só');
  }, { pagina: documento => { criar(documento, documento.head, 'style', { id: 'nova-grab-css' }); } }),
  cena('fora de /watch não monta', (palco) => {
    abrirBarra(palco);
    palco.mutar();
    palco.foto('nada');
  }, { url: 'https://www.youtube.com/feed/subscriptions' }),
];

const CENAS_DE_TITULO = [
  ['título do yt-formatted-string', paginaComTitulo((documento, corpo) => {
    const h1 = criar(documento, corpo, 'h1', { className: 'style-scope ytd-watch-metadata' });
    criar(documento, h1, 'yt-formatted-string', { textContent: TITULO_ESTRANHO });
  })],
  ['título de #above-the-fold #title h1', paginaComTitulo((documento, corpo) => {
    const dobra = criar(documento, corpo, 'div', { id: 'above-the-fold' });
    criar(documento, criar(documento, dobra, 'div', { id: 'title' }), 'h1', { textContent: ' Dobra ' });
  })],
  ['título de #title h1 quando o primeiro é só espaço', paginaComTitulo((documento, corpo) => {
    const h1 = criar(documento, corpo, 'h1', { className: 'ytd-watch-metadata' });
    criar(documento, h1, 'yt-formatted-string', { textContent: '   ' });
    criar(documento, criar(documento, corpo, 'div', { id: 'title' }), 'h1', { textContent: 'Só title' });
  })],
  ['título do document.title sem " - YouTube"', (documento) => { documento.title = 'Aula 1 - YouTube'; }],
  ['título padrão', (documento) => { documento.title = ' - YouTube'; }],
  ['título com 45 caracteres não corta', (documento) => { documento.title = `${'a'.repeat(45)} - YouTube`; }],
  ['título com 46 caracteres corta', (documento) => { documento.title = `${'b'.repeat(46)} - YouTube`; }],
].map(([nome, pagina]) => cena(nome, (palco) => {
  abrirProgresso(palco, 3);
  palco.foto('progresso com o título');
}, { pagina }));

const CENAS_DA_INFO = [0, 1, 2, 3].map(indice => cena(`formato ${indice} abre a Info do Arquivo`, (palco) => {
  abrirInfo(palco, indice);
  palco.foto('info');
}, { pagina: paginaComTitulo((documento, corpo) => {
  criar(documento, criar(documento, corpo, 'div', { id: 'title' }), 'h1', { textContent: TITULO_ESTRANHO });
}) })).concat([
  cena('URL longa, &list= e &index= cortados', (palco) => {
    abrirInfo(palco, 1);
    palco.foto('info com URL longa');
    palco.clicar(botoesDe(palco, 'ng-fileinfo')[2], 'Start Download');
    palco.foto('progresso com URL longa');
  }, { url: URL_LONGA }),
  cena('só &index= cortado', (palco) => {
    abrirInfo(palco, 0);
    palco.foto('info');
  }, { url: 'https://www.youtube.com/watch?v=k&index=4&t=9' }),
  ...['Cancel', 'Download Later'].map((rotulo, indice) => cena(`Info: ${rotulo} cancela e fecha`, (palco) => {
    abrirInfo(palco);
    palco.clicar(botoesDe(palco, 'ng-fileinfo')[indice], rotulo);
    palco.foto('fechada');
  })),
  cena('Info: ✕ cancela e fecha', (palco) => {
    abrirInfo(palco);
    palco.clicar(palco.porId('ng-fileinfo-close'), 'fechar info');
    palco.foto('fechada');
  }),
  cena('Info: arrastar pelo título', (palco) => {
    abrirInfo(palco);
    palco.arrastar(tituloDe(palco, 'ng-fileinfo'), [100, 100], [80, 140]);
    palco.foto('arrastada');
  }),
]);

const CENAS_DO_PROGRESSO = [
  cena('progresso: abre, anima os segmentos, minimiza e fecha no ✕', (palco) => {
    abrirProgresso(palco);
    palco.foto('aberto');
    palco.avancar(150);
    palco.progresso({ progress: 37.25 });
    palco.avancar(300);
    palco.foto('segmentos em 37%');
    palco.clicar(palco.porId('ng-minimize-btn'), 'minimizar');
    palco.foto('minimizado');
    palco.clicar(palco.porId('ng-minimize-btn'), 'minimizar');
    palco.foto('restaurado');
    palco.arrastar(tituloDe(palco, 'ng-progress-dlg'), [0, 0], [-30, 20]);
    palco.clicar(palco.porId('ng-close-prog-btn'), 'fechar progresso');
    palco.avancar(150);
    palco.foto('fechado e sem timer');
  }),
  cena('progresso: Cancel cancela e fecha', (palco) => {
    abrirProgresso(palco, 3);
    palco.clicar(botoesDe(palco, 'ng-progress-dlg')[1], 'Cancel');
    palco.avancar(300);
    palco.foto('cancelado');
  }),
  cena('progresso: estado guardado antes de abrir', (palco) => {
    abrirInfo(palco, 2);
    palco.progresso({ progress: 12.5, speed: '1.2 MiB/s', downloaded: '50 MiB', eta: '00:41', status: 'Downloading' });
    palco.foto('info com estado');
    palco.clicar(botoesDe(palco, 'ng-fileinfo')[2], 'Start Download');
    palco.foto('progresso já preenchido');
  }),
  cena('progresso: escolher formato zera o estado de antes', (palco) => {
    palco.progresso({ progress: 80, downloaded: '9 MiB', status: 'Downloading' });
    abrirProgresso(palco, 1);
    palco.foto('progresso sem o estado antigo');
  }),
  cena('progresso: atualizações em sequência e ERROR', (palco) => {
    abrirProgresso(palco);
    palco.progresso({ progress: 33.333, speed: '2 MiB/s', downloaded: '120.5 MiB', eta: '01:10', status: 'Downloading' });
    palco.foto('33%');
    palco.progresso({ progress: 50 });
    palco.foto('50% com o tamanho guardado');
    palco.progresso({ downloaded: 'desconhecido' });
    palco.foto('tamanho sem número');
    palco.progresso({ progress: 0, speed: '', eta: 0, status: '' });
    palco.foto('zeros e vazios');
    palco.progresso({ status: 'ERROR' });
    palco.foto('erro');
  }),
  cena('progresso: tamanho sem progresso', (palco) => {
    abrirProgresso(palco);
    palco.progresso({ downloaded: '12 MB' });
    palco.foto('só tamanho');
  }),
  cena('progresso: COMPLETE com caminho, abrir pasta e fechar', (palco) => {
    abrirProgresso(palco);
    palco.progresso({ progress: 99.9, downloaded: '10 MiB' });
    palco.progresso({ status: 'COMPLETE', filePath: '/Users/usuario/Downloads/Nova Downloads/a.mp4' });
    palco.foto('completo');
    palco.clicar(botoesDe(palco, 'ng-progress-dlg')[0], 'Open Folder');
    palco.progresso({ status: 'COMPLETE' });
    palco.foto('completo de novo');
    palco.clicar(botoesDe(palco, 'ng-progress-dlg')[1], 'Close');
    palco.avancar(150);
    palco.foto('fechado');
  }),
  cena('progresso: COMPLETE sem caminho usa a pasta padrão', (palco) => {
    abrirProgresso(palco);
    palco.progresso({ status: 'COMPLETE' });
    palco.clicar(botoesDe(palco, 'ng-progress-dlg')[0], 'Open Folder');
    palco.foto('completo');
  }),
  cena('progresso: sem diálogo só guarda o estado', (palco) => {
    palco.progresso({ progress: 5, status: 'COMPLETE', downloaded: '3 GiB', speed: 's', eta: 'e' });
    palco.progresso({ status: 'ERROR' });
    palco.foto('estado sem diálogo');
  }),
  cena('progresso: valores de tipo errado lançam no meio', (palco) => {
    abrirProgresso(palco);
    palco.progresso({ progress: '50' });
    palco.foto('progresso em texto');
    palco.progresso({ progress: 10, downloaded: 1024 });
    palco.foto('tamanho em número');
    palco.progresso(null);
    palco.progresso(undefined);
    palco.foto('sem dados');
  }),
];

const CENAS_DE_NAVEGACAO = [
  cena('yt-navigate-finish para outro vídeo remonta em 1,5 s', (palco) => {
    abrirProgresso(palco);
    palco.navegar('https://www.youtube.com/watch?v=outro&list=PL9', true);
    palco.foto('limpo');
    palco.avancar(1500);
    palco.foto('remontado');
  }),
  cena('yt-navigate-finish para fora de /watch só limpa', (palco) => {
    abrirInfo(palco);
    palco.navegar('https://www.youtube.com/', true);
    palco.avancar(5000);
    palco.foto('limpo');
  }),
  cena('mudança de URL vista pelo intervalo', (palco) => {
    abrirBarra(palco);
    palco.clicar(faixa(palco), 'faixa');
    palco.navegar('https://www.youtube.com/watch?v=terceiro', false);
    palco.avancar(1000);
    palco.foto('limpo pelo intervalo');
    palco.avancar(1500);
    palco.foto('remontado');
    palco.navegar('https://www.youtube.com/shorts/x', false);
    palco.avancar(3000);
    palco.foto('fora de /watch');
  }),
];

module.exports = { CENAS: [...CENAS_DA_BARRA, ...CENAS_DE_TITULO, ...CENAS_DA_INFO, ...CENAS_DO_PROGRESSO, ...CENAS_DE_NAVEGACAO] };
