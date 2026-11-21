'use strict';

const PREPARAR = 'physical-mobile:iphone-prepare';
const URL_DO_CONTROLE = 'physical-mobile:ios-console-url';
const JANELA_DO_CONTROLE = 'physical-mobile:ios-console';
const ABRIR_CONECTAR = 'nova:iphone-setup-open';
const ABRIR_CONTROLE = 'nova:iphone-console-open';
const CONECTAR_DE_NOVO = 'physical-mobile:start-stream';

const FECHAR_CONECTAR = 'button.nvios-x';
const FECHAR_CONTROLE = 'button.nvios-x.nvios-console-close';
const ABRIR_O_CONTROLE = 'button.nvios-primary.nvios-console-open';
const EM_JANELA = 'button.nvios-ghost.nvios-console-window';
const REFAZER = 'button.nvios-ghost.nvios-console-retry';
const PRONTO = 'button.nvios-ghost.nvios-done';

const ok = valor => ({ valor });
const falha = mensagem => ({ lanca: mensagem });

const CENAS = [
  {
    nome: 'sem payload ou sem id nenhum dos dois abre',
    passos: [['abrir', null], ['abrir', {}], ['ipc', ABRIR_CONECTAR, { name: 'x' }], ['ipc', ABRIR_CONTROLE, null], ['ipc', ABRIR_CONTROLE, { name: 'x' }], ['estado']],
  },
  {
    nome: 'Conectar abre com nome, foca a senha, atualiza ao reabrir e fecha por Escape e por clique fora',
    focoAnterior: 'normal',
    passos: [
      ['abrir', { id: '00008101-001A2B3C4D5E', name: 'iPhone de Ana' }], ['estado'], ['avancar', 30],
      ['abrir', { id: 123, name: '' }], ['ipc', ABRIR_CONECTAR, { name: 'Outro' }], ['abrir', null], ['estado'],
      ['tecla', 'a'], ['tecla', 'Escape'], ['estado'],
      ['abrir', { id: 'ABC' }], ['estado'], ['mousedown', 'outro'], ['mousedown', 'host'], ['estado'],
    ],
  },
  {
    nome: 'rótulo do aparelho: id curto, id comprido e nome só de espaços',
    passos: [
      ['abrir', { id: '12345678' }], ['clicar', PRONTO],
      ['abrir', { id: 'abcdefghij' }], ['clicar', FECHAR_CONECTAR],
      ['abrir', { id: '1', name: '  ' }], ['clicar', FECHAR_CONECTAR], ['estado'],
    ],
  },
  {
    nome: 'senha vazia, Conectar com sucesso, controle embutido e janela que falha e depois abre',
    semHead: true,
    focoAnterior: 'lanca',
    passos: [
      ['abrir', { id: 'X1', name: 'iPhone' }], ['enviar'], ['estado'],
      ['digitar', 'segredo'], ['enviar'], ['estado'], ['enviar'], ['tecla', 'Escape'], ['mousedown', 'host'], ['clicar', FECHAR_CONECTAR], ['abrir', { id: 'X1', name: 'iPhone' }],
      ['avancar', 1500], ['saltar', 58000], ['avancar', 500], ['saltar', 600499], ['avancar', 500],
      ['responder', PREPARAR, ok({ success: true, message: 'Pronto.' })], ['estado'], ['avancar', 5000],
      ['clicar', ABRIR_O_CONTROLE], ['estado'], ['responder', URL_DO_CONTROLE, ok({ success: true, url: 'http://127.0.0.1:9/x' })], ['estado'],
      ['webview', 'did-finish-load'], ['webview', 'did-fail-load'], ['estado'],
      ['clicar', EM_JANELA], ['estado'], ['responder', JANELA_DO_CONTROLE, ok({ success: false, error: 'janela não abriu' })], ['estado'],
      ['clicar', EM_JANELA], ['responder', JANELA_DO_CONTROLE, ok({ success: true })], ['estado'],
    ],
  },
  {
    nome: 'falhas do Conectar devolvem a senha e explicam travamento do aparelho',
    passos: [
      ['abrir', { id: 'F1' }], ['digitar', 'abc'],
      ['enviar'], ['responder', PREPARAR, ok({ success: false, error: 'dpkg: error processing package' })], ['estado'],
      ['enviar'], ['responder', PREPARAR, ok({ success: false, message: 'só a mensagem' })],
      ['enviar'], ['responder', PREPARAR, ok({ success: false, error: '', message: 'mensagem quando o erro é vazio' })],
      ['enviar'], ['responder', PREPARAR, ok(null)],
      ['enviar'], ['responder', PREPARAR, falha('cabo solto')],
      ['enviar'], ['responder', PREPARAR, falha(null)],
      ['enviar'], ['responder', PREPARAR, ok({ success: false, error: 'process was killed by signal 9' })],
      ['enviar'], ['responder', PREPARAR, ok({ success: false, error: 'signal (11) no ldid' })],
      ['enviar'], ['responder', PREPARAR, ok({ success: true })], ['estado'],
    ],
  },
  {
    nome: 'controle embutido do Conectar: webview que lança, URL que falha de vários jeitos e fechar',
    webview: ['lanca'],
    passos: [
      ['abrir', { id: 'W1' }], ['digitar', 'x'], ['enviar'], ['responder', PREPARAR, ok({ success: true, message: '' })],
      ['clicar', ABRIR_O_CONTROLE], ['responder', URL_DO_CONTROLE, ok({ success: true, url: 'u' })], ['estado'],
      ['clicar', ABRIR_O_CONTROLE], ['responder', URL_DO_CONTROLE, ok({ success: false })],
      ['clicar', ABRIR_O_CONTROLE], ['responder', URL_DO_CONTROLE, falha('sem rede')],
      ['clicar', ABRIR_O_CONTROLE], ['responder', URL_DO_CONTROLE, ok({ success: true })],
      ['clicar', ABRIR_O_CONTROLE], ['responder', URL_DO_CONTROLE, falha(null)],
      ['clicar', EM_JANELA], ['responder', JANELA_DO_CONTROLE, falha(null)],
      ['clicar', EM_JANELA], ['responder', JANELA_DO_CONTROLE, falha('janela recusada')],
      ['clicar', EM_JANELA], ['responder', JANELA_DO_CONTROLE, ok(null)], ['estado'],
      ['clicar', FECHAR_CONTROLE], ['estado'],
    ],
  },
  {
    nome: 'controle direto: webview nulo, refazer conexão, webview que carrega e falha, e janela',
    focoAnterior: 'sem-focus',
    webview: ['nulo', 'normal'],
    passos: [
      ['ipc', ABRIR_CONTROLE, { id: 'C1' }], ['estado'], ['ipc', ABRIR_CONTROLE, { id: 'C9' }],
      ['responder', URL_DO_CONTROLE, ok({ success: true, url: 'u1' })], ['estado'],
      ['clicar', REFAZER], ['responder', CONECTAR_DE_NOVO, falha('main abre o modal')], ['estado'],
      ['ipc', ABRIR_CONTROLE, { id: 'C2' }], ['responder', URL_DO_CONTROLE, ok({ success: true, url: 'u2' })], ['estado'],
      ['webview', 'did-finish-load'], ['webview', 'did-fail-load'], ['estado'],
      ['clicar', EM_JANELA], ['estado'], ['responder', JANELA_DO_CONTROLE, ok({ success: false })],
      ['clicar', EM_JANELA], ['responder', JANELA_DO_CONTROLE, falha('falhou')],
      ['clicar', EM_JANELA], ['responder', JANELA_DO_CONTROLE, falha(null)],
      ['clicar', EM_JANELA], ['responder', JANELA_DO_CONTROLE, ok({ success: false, error: 'janela fechada pelo sistema' })], ['estado'],
      ['clicar', EM_JANELA], ['responder', JANELA_DO_CONTROLE, ok({ success: true })], ['estado'],
      ['ipc', ABRIR_CONTROLE, { id: 'C3' }], ['clicar', REFAZER], ['responder', CONECTAR_DE_NOVO, ok(undefined)], ['estado'],
    ],
  },
  {
    nome: 'controle direto fecha por Escape, por clique fora e pelo X; falhas ao carregar',
    focoAnterior: 'normal',
    passos: [
      ['ipc', ABRIR_CONTROLE, { id: 'D' }], ['responder', URL_DO_CONTROLE, falha(null)], ['estado'], ['tecla', 'Enter'], ['tecla', 'Escape'],
      ['ipc', ABRIR_CONTROLE, { id: 'E' }], ['responder', URL_DO_CONTROLE, ok({ success: false, error: 'sem controle' })], ['mousedown', 'outro'], ['mousedown', 'host'],
      ['ipc', ABRIR_CONTROLE, { id: 'F' }], ['responder', URL_DO_CONTROLE, ok(null)], ['clicar', FECHAR_CONTROLE],
      ['ipc', ABRIR_CONTROLE, { id: 'G' }], ['responder', URL_DO_CONTROLE, falha('caiu')], ['estado'], ['clicar', FECHAR_CONTROLE], ['estado'],
    ],
  },
  {
    nome: 'sem invoke de teste usa o ipcRenderer.invoke',
    semInvoke: true,
    passos: [
      ['ipc', ABRIR_CONTROLE, { id: 'H' }], ['responder', URL_DO_CONTROLE, ok({ success: true, url: 'z' })],
      ['ipc', ABRIR_CONECTAR, { id: 'H', name: 'iPhone H' }], ['digitar', 's'], ['enviar'], ['responder', PREPARAR, ok({ success: true })], ['estado'],
    ],
  },
];

module.exports = { CENAS };
