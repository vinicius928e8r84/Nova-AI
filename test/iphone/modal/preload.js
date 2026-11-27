const path = require('node:path');
const APP = process.env.NOVA_APP || '/Applications/Nova AI Mac.app/Contents/Resources/app';
const { attach } = require(path.join(APP, 'electron/services/iphone-setup/inapp.js'));

const STATE = process.env.TEST_STATE || 'idle';
const ESTADOS_QUE_ENVIAM_A_SENHA = new Set(['running', 'success', 'error']);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const invoke = async (channel) => {
  if (channel === 'physical-mobile:iphone-prepare') {
    await wait(STATE === 'running' ? 9000 : 1000);
    if (STATE === 'error') {
      return { success: false, error: 'Não foi possível autenticar. Confira a senha SSH, o jailbreak ativo e o OpenSSH no Sileo.' };
    }
    return {
      success: true,
      message: 'Conectado por USB. Acesso SSH configurado; a senha não foi salva.\n\nPonte de câmera 0.1-38-1+debug instalada. Pode ser necessário reiniciar o ambiente do jailbreak e reabrir a Câmera.\n\nCatVNC encontrado. A tela ao vivo usa a senha configurada em Ajustes → CatVNC.\n\nAs funções disponíveis dependem do suporte a iOS de cada aba.',
    };
  }
  if (channel === 'physical-mobile:ios-console-url') return { success: true, url: 'http://127.0.0.1:8799/' };
  return { success: true };
};

window.addEventListener('DOMContentLoaded', () => {
  const api = attach({ ipcRenderer: { on() {} }, invoke });
  console.log('[preload] abrindo modal');
  api.open({ id: 'ios-47F4FC34C3ACF770EB4E3561CAD85FCARDCAC298', name: 'iPhone 8 Plus (iOS 16.7.16)' });

  const submit = () => {
    const input = document.getElementById('nvios-pass');
    if (!input) return;
    input.value = 'senha-de-teste';
    document.querySelector('.nvios-submit').click();
  };

  if (ESTADOS_QUE_ENVIAM_A_SENHA.has(STATE)) setTimeout(submit, 350);
  if (STATE === 'console') {
    setTimeout(submit, 350);
    setTimeout(() => document.querySelector('.nvios-console-open').click(), 2200);
  }
});
