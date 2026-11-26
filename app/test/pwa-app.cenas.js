'use strict';

async function conectarEAutenticar(palco) {
  palco.ajustar('token-input', { value: '  tk-1  ' });
  palco.disparar('connect-btn', 'click');
  await palco.esperar();
  palco.socket('connect');
  palco.socket('authenticated', { success: true });
}

async function gravarEParar(palco) {
  palco.disparar('mic-btn', 'click');
  await palco.esperar();
  palco.gravador.ondataavailable({ data: { size: 0, nome: 'vazio' } });
  palco.gravador.ondataavailable({ data: { size: 3, nome: 'pedaco' } });
  palco.disparar('mic-btn', 'click');
  await palco.esperar();
  const parada = palco.gravador.onstop();
  await palco.esperar();
  await palco.avancar();
  await parada;
}

const CENAS = [
  {
    nome: 'sem nenhum elemento na página',
    sem: ['message-input', 'model-select', 'token-input', 'ai-thinking', 'active-model-name', 'messages', 'mic-btn', 'connect-btn',
      'disconnect-btn', 'send-btn', 'auth-error', 'connection-status'],
    acao: async (palco) => {
      await palco.app.connect();
      palco.app.sendMessage();
      palco.app.addMessage('ai', 'oi');
      palco.app.setThinking(true);
      palco.app.clearMessages();
      palco.app.scrollToBottom();
      palco.app.updateConnectionStatus(true);
      palco.app.setConnecting(true);
      palco.app.disconnect();
      palco.app.onAuthenticated();
    },
  },
  {
    nome: 'token salvo, token na URL e a conversa inteira',
    salvo: JSON.stringify({ token: 'tk-salvo', savedAt: 1 }),
    busca: '?token=tk-url&x=1',
    acao: async (palco) => {
      await palco.avancar(800);
      palco.socket('connect');
      palco.socket('authenticated', { success: true });
      palco.socket('ai-thinking');
      palco.socket('ai-response', { message: 'oi\nmundo', timestamp: 5 });
      palco.socket('ai-response', { message: '', timestamp: 6 });
      palco.socket('groq-key', { apiKey: 'gk-1' });
      palco.socket('disconnect', 'transport close');
      palco.socket('reconnect');
      palco.socket('connect');
      palco.socket('server-shutdown');
      palco.socket('disconnect', 'de novo');
      palco.socket('token-revoked');
      palco.socket('reconnect');
    },
  },
  {
    nome: 'token salvo inválido, recusa, erro de conexão e tempo esgotado',
    salvo: '{quebrado',
    acao: async (palco) => {
      palco.disparar('connect-btn', 'click');
      palco.ajustar('token-input', { value: 'tk-2' });
      palco.tecla('token-input', 'a');
      palco.tecla('token-input', 'Enter');
      await palco.esperar();
      palco.socket('authenticated', { success: false });
      palco.socket('connect_error', { message: 'xhr poll error' });
      await palco.avancar();
    },
  },
  {
    nome: 'teclado, caixa de mensagem, envio e troca de modelo',
    acao: async (palco) => {
      palco.disparar('send-btn', 'click');
      await conectarEAutenticar(palco);
      palco.ajustar('message-input', { value: '  <b>olá</b> & cia  ' });
      palco.tecla('message-input', 'Enter', true);
      palco.tecla('message-input', 'x');
      palco.tecla('message-input', 'Enter');
      palco.disparar('message-input', 'input', { target: palco.app.messageInput });
      palco.ajustar('message-input', { value: '   ' });
      palco.disparar('send-btn', 'click');
      palco.ajustar('model-select', { selectedIndex: 1, value: 'gpt' });
      palco.disparar('model-select', 'change');
      palco.disparar('disconnect-btn', 'click');
      palco.disparar('model-select', 'change');
      await palco.avancar();
    },
  },
  {
    nome: 'microfone: sem conexão, grava, sem chave do Groq e com chave',
    respostaDoGroq: { text: 'texto falado' },
    acao: async (palco) => {
      await palco.app.handleMicClick();
      await conectarEAutenticar(palco);
      await gravarEParar(palco);
      palco.socket('groq-key', { apiKey: 'gk-2' });
      await gravarEParar(palco);
    },
  },
  {
    nome: 'microfone: resposta sem texto, Groq fora e gravador já parado',
    respostaDoGroq: {},
    acao: async (palco) => {
      await conectarEAutenticar(palco);
      palco.socket('groq-key', { apiKey: 'gk-3' });
      await gravarEParar(palco);
      palco.cena.groqFalha = true;
      await gravarEParar(palco);
      palco.disparar('mic-btn', 'click');
      await palco.esperar();
      palco.gravador.state = 'inactive';
      palco.disparar('mic-btn', 'click');
    },
  },
  {
    nome: 'microfone negado e navegador sem mediaDevices',
    microfoneNegado: true,
    acao: async (palco) => {
      await conectarEAutenticar(palco);
      await palco.app.handleMicClick();
      palco.cena.microfoneNegado = false;
      palco.app.isRecording = true;
      await palco.app.handleMicClick();
    },
  },
  {
    nome: 'sem mediaDevices',
    semMicrofone: true,
    acao: async (palco) => {
      await conectarEAutenticar(palco);
      await palco.app.handleMicClick();
    },
  },
  {
    nome: 'mediaDevices sem getUserMedia',
    semGetUserMedia: true,
    acao: async (palco) => {
      await conectarEAutenticar(palco);
      await palco.app.handleMicClick();
    },
  },
  {
    nome: 'página carregando, service worker que falha e marked que lança',
    carregando: true,
    swFalha: true,
    marked: { parse: () => { throw new Error('markdown quebrado'); } },
    acao: async (palco) => {
      await conectarEAutenticar(palco);
      palco.socket('ai-response', { message: '<i>x</i>', timestamp: 1 });
    },
  },
  {
    nome: 'marked de verdade, socket desconectado, io que lança e botão sem filhos',
    marked: { parse: texto => `<md>${texto}</md>` },
    socketConectado: false,
    botaoSemFilhos: true,
    sem: ['messages'],
    acao: async (palco) => {
      await conectarEAutenticar(palco);
      palco.socket('ai-response', { message: '*x*', timestamp: 1 });
      palco.ajustar('token-input', { value: 'tk-3' });
      await palco.app.connect();
      palco.cena.ioFalha = 'io indisponível';
      await palco.app.connect();
    },
  },
  {
    nome: 'sem nome do modelo ativo nem tela de erro',
    sem: ['active-model-name', 'auth-error', 'connection-status', 'ai-thinking'],
    acao: async (palco) => {
      await conectarEAutenticar(palco);
      palco.disparar('model-select', 'change');
      palco.socket('ai-thinking');
      palco.socket('server-shutdown');
      const transcricao = palco.app.processTranscription({ nome: 'blob' });
      await palco.avancar();
      await transcricao;
    },
  },
];

module.exports = { CENAS };
