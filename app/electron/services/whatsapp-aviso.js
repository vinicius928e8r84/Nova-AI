'use strict';

const PERMISSOES = {
  darwin: 'Confira em Ajustes do Sistema > Privacidade e Segurança as permissões Gerenciamento de apps e Microfone para o Nova AI.',
  win32: 'Confira se o firewall ou o antivírus está bloqueando o Nova AI e se a pasta de dados do app permite gravação.',
};

function textoDoAviso(platform, tentativas) {
  const dica = PERMISSOES[platform] || 'Reinicie o Nova AI e confira as permissões do sistema.';
  return `O WhatsApp não iniciou após ${tentativas} tentativas. ${dica}`;
}

function avisarFalhaRepetida({ platform, tentativas, mostrar }) {
  const texto = textoDoAviso(platform, tentativas);
  Promise.resolve()
    .then(() => mostrar(texto))
    .catch(erro => console.error('[WhatsApp] Aviso não exibido:', erro?.message || erro));
  return texto;
}

module.exports = { textoDoAviso, avisarFalhaRepetida };
