'use strict';

const CHAMADA = '[[NOVA_TOOL_CALL: {"nome":"abrir","n":1}]]';
const SEND = 'button[aria-label="Send message"]';
const CONTENTEDITABLE = '[contenteditable="true"]';
const TEXTO_LONGO = 'uma mensagem bem comprida para conferir que o registro corta o texto injetado nos sessenta primeiros caracteres';

function pagina(construir) {
  return (fabrica) => {
    const corpo = fabrica.elemento('corpo', { tag: 'BODY' });
    const montado = { corpo, seletores: {}, botoes: [], nos: {}, campoDeTexto: null };
    construir(fabrica, montado);
    return montado;
  };
}

const textoEm = (fabrica, montado) => (nome, valor, pai) => {
  montado.nos[nome] = fabrica.texto(valor);
  pai.adicionar(montado.nos[nome]);
};

const adicionando = (...nos) => ({ type: 'childList', addedNodes: nos });

function paragrafoCom(valor) {
  return pagina((fabrica, montado) => {
    montado.nos.paragrafo = fabrica.elemento('p', { tag: 'P' });
    montado.corpo.adicionar(montado.nos.paragrafo);
    textoEm(fabrica, montado)('texto', valor, montado.nos.paragrafo);
  });
}

const relatorio = (a) => ({ texto: a.montado.nos.texto.nodeValue, escondido: a.montado.nos.paragrafo.style.display || '' });

const lerComando = (valor, mutacoes) => ({
  montar: paragrafoCom(valor),
  roteiro: (a) => {
    a.mutar(mutacoes(a.montado.nos));
    return relatorio(a);
  },
});

const comEditavel = (tag, configurar = () => {}) => pagina((fabrica, montado) => {
  const campo = fabrica.elemento('campo', { tag, classe: 'ql-editor campo-com-um-nome-de-classe-bem-comprido-para-cortar' });
  const botao = fabrica.elemento('botao-enviar', { tag: 'BUTTON' });
  montado.campoDeTexto = campo;
  montado.nos.campo = campo;
  montado.nos.botao = botao;
  montado.seletores[SEND] = botao;
  configurar(fabrica, montado, campo);
});

const noRichTextarea = (consultasDe) => (fabrica, montado, campo) => {
  const sombra = fabrica.elemento('sombra', { consultas: consultasDe(campo) });
  montado.seletores['rich-textarea'] = fabrica.elemento('rich-textarea', { sombra });
};

const enviar = (texto = 'olá, Nova', esperas = [500]) => async (a) => {
  const retorno = await a.ponte().sendFeedback(texto);
  for (const espera of esperas) a.avancar(espera);
  return retorno;
};

const cincoRetentativas = [500, 300, 300, 300, 300, 300];

module.exports = [
  { nome: 'ao carregar a ponte avisa, escuta o convite do hospedeiro e expõe o NovaBridge', montar: pagina(() => {}), roteiro: (a) => { a.ouvirIpc('nova-bridge-init', {}, { id: 7 }); return Object.keys(a.ponte()); } },
  { nome: 'com o documento pronto observa o corpo na hora', montar: pagina(() => {}), roteiro: (a) => a.observadorCriado() },
  { nome: 'com o documento carregando espera o DOMContentLoaded', estadoDoDocumento: 'loading', montar: pagina(() => {}), roteiro: (a) => { const antes = a.observadorCriado(); a.ouvirDocumento('DOMContentLoaded'); return [antes, a.observadorCriado()]; } },
  { nome: 'com o documento interativo observa na hora', estadoDoDocumento: 'interactive', montar: pagina(() => {}), roteiro: (a) => a.observadorCriado() },
  { nome: 'a chamada num elemento adicionado vai ao hospedeiro e some do texto', ...lerComando(CHAMADA, (nos) => [adicionando(nos.paragrafo)]) },
  { nome: 'a chamada num nó de texto adicionado é lida direto', ...lerComando(CHAMADA, (nos) => [adicionando(nos.texto)]) },
  { nome: 'o alvo da mutação em nó de texto também é lido', ...lerComando(CHAMADA, (nos) => [{ type: 'characterData', target: nos.texto }]) },
  { nome: 'o alvo da mutação em elemento é varrido', ...lerComando(CHAMADA, (nos) => [{ type: 'childList', addedNodes: [], target: nos.paragrafo }]) },
  { nome: 'mutações de outro tipo são ignoradas', ...lerComando(CHAMADA, (nos) => [{ type: 'attributes', target: nos.texto, addedNodes: [nos.texto] }]) },
  { nome: 'duas chamadas no mesmo texto mandam dois comandos e o resto fica', ...lerComando(`antes ${CHAMADA} meio [[NOVA_TOOL_CALL:{"nome":"fechar","a":{"b":2}}]] depois`, (nos) => [adicionando(nos.texto)]) },
  { nome: 'a chamada com JSON quebrado registra o erro e some do texto', ...lerComando('[[NOVA_TOOL_CALL: {nao e json} ]]', (nos) => [adicionando(nos.texto)]) },
  { nome: 'o texto sem chamada fica como está', ...lerComando('só conversa, sem ferramenta', (nos) => [adicionando(nos.texto)]) },
  { nome: 'o texto vazio é ignorado', ...lerComando('', (nos) => [adicionando(nos.texto)]) },
  { nome: 'sobrando texto o pai não é escondido', ...lerComando(`resto ${CHAMADA}`, (nos) => [adicionando(nos.texto)]) },
  {
    nome: 'o pai com outro texto dentro não é escondido',
    montar: pagina((fabrica, montado) => {
      montado.nos.paragrafo = fabrica.elemento('p', { tag: 'P' });
      montado.corpo.adicionar(montado.nos.paragrafo);
      textoEm(fabrica, montado)('texto', CHAMADA, montado.nos.paragrafo);
      textoEm(fabrica, montado)('outro', 'texto que fica', montado.nos.paragrafo);
    }),
    roteiro: (a) => { a.mutar([adicionando(a.montado.nos.paragrafo)]); return relatorio(a); },
  },
  {
    nome: 'um nó de texto sem pai é limpo sem quebrar',
    montar: pagina((fabrica, montado) => { montado.nos.texto = fabrica.texto(CHAMADA); montado.nos.paragrafo = fabrica.elemento('p'); }),
    roteiro: (a) => { a.mutar([adicionando(a.montado.nos.texto)]); return relatorio(a); },
  },
  {
    nome: 'duas chamadas em nós de texto vizinhos mandam um comando cada',
    montar: pagina((fabrica, montado) => {
      montado.nos.paragrafo = fabrica.elemento('p');
      montado.corpo.adicionar(montado.nos.paragrafo);
      textoEm(fabrica, montado)('texto', CHAMADA, montado.nos.paragrafo);
      textoEm(fabrica, montado)('outro', '[[NOVA_TOOL_CALL: {"nome":"segundo"}]]', montado.nos.paragrafo);
    }),
    roteiro: (a) => { a.mutar([adicionando(a.montado.nos.paragrafo)]); return [a.montado.nos.texto.nodeValue, a.montado.nos.outro.nodeValue]; },
  },
  { nome: 'a mutação sem lista de nós adicionados não quebra', ...lerComando(CHAMADA, () => [{ type: 'characterData' }]) },
  { nome: 'o campo de texto dentro da sombra do rich-textarea recebe o texto, os eventos e o clique', montar: comEditavel('DIV', noRichTextarea((campo) => ({ [CONTENTEDITABLE]: campo }))), execCommandEscreve: true, roteiro: enviar('olá, Nova', [500]) },
  { nome: 'a sombra só com textarea usa o setter nativo do valor', montar: comEditavel('TEXTAREA', noRichTextarea((campo) => ({ textarea: campo }))), roteiro: enviar() },
  { nome: 'o rich-textarea sem sombra procura o campo dentro dele', montar: comEditavel('DIV', (fabrica, montado, campo) => { montado.seletores['rich-textarea'] = fabrica.elemento('rich-textarea', { consultas: { [CONTENTEDITABLE]: campo } }); }), roteiro: enviar() },
  { nome: 'o rich-textarea sem campo cai para o textarea de dentro', montar: comEditavel('TEXTAREA', (fabrica, montado, campo) => { montado.seletores['rich-textarea'] = fabrica.elemento('rich-textarea', { consultas: { textarea: campo } }); }), roteiro: enviar() },
  { nome: 'sem rich-textarea cai para o .ql-editor', montar: comEditavel('DIV', (fabrica, montado, campo) => { montado.seletores['.ql-editor[contenteditable="true"]'] = campo; }), roteiro: enviar() },
  { nome: 'sem .ql-editor cai para o div editável', montar: comEditavel('DIV', (fabrica, montado, campo) => { montado.seletores['div[contenteditable="true"]'] = campo; }), roteiro: enviar() },
  { nome: 'sem div editável cai para o textarea com aria-label', montar: comEditavel('TEXTAREA', (fabrica, montado, campo) => { montado.seletores['textarea[aria-label]'] = campo; }), roteiro: enviar() },
  { nome: 'sem nenhum campo registra o erro e não faz mais nada', montar: comEditavel('DIV'), roteiro: enviar() },
  { nome: 'o execCommand que não escreve deixa o texto no textContent', montar: comEditavel('DIV', (fabrica, montado, campo) => { montado.seletores['div[contenteditable="true"]'] = campo; }), roteiro: enviar() },
  { nome: 'o texto injetado aparece cortado em sessenta caracteres no registro', montar: comEditavel('DIV', (fabrica, montado, campo) => { montado.seletores['div[contenteditable="true"]'] = campo; }), execCommandEscreve: true, roteiro: enviar(TEXTO_LONGO) },
  { nome: 'o seletor de envio que lança é pulado e o botão é achado pelo aria-label', montar: comEditavel('DIV', (fabrica, montado, campo) => { montado.seletores['div[contenteditable="true"]'] = campo; delete montado.seletores[SEND]; montado.seletores['button:has(svg path)'] = 'lanca'; montado.botoes = [fabrica.elemento('cancelar', { atributos: { 'aria-label': 'Cancel' } }), fabrica.elemento('enviar-por-titulo', { atributos: { title: 'Send it' } })]; }), execCommandEscreve: true, roteiro: enviar() },
  { nome: 'o botão desabilitado é tentado de novo cinco vezes e cai para a tecla Enter', montar: comEditavel('DIV', (fabrica, montado, campo) => { montado.seletores['div[contenteditable="true"]'] = campo; montado.nos.botao.disabled = true; }), roteiro: enviar('olá', cincoRetentativas) },
  { nome: 'o botão que aparece na segunda tentativa é clicado', montar: comEditavel('DIV', (fabrica, montado, campo) => { montado.seletores['div[contenteditable="true"]'] = campo; delete montado.seletores[SEND]; }), roteiro: async (a) => { await a.ponte().sendFeedback('olá'); a.avancar(500); a.montado.seletores['.send-button'] = a.montado.nos.botao; a.avancar(300); return null; } },
  { nome: 'o erro dentro do sendFeedback é registrado e engolido', montar: pagina((fabrica, montado) => { montado.seletores['rich-textarea'] = 'lanca'; }), roteiro: enviar() },
];
