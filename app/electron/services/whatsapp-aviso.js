'use strict';

const PERMISSOES = {
  darwin: 'Confira em Ajustes do Sistema > Privacidade e Segurança as permissões Gerenciamento de apps e Microfone para o Nova AI.',
  win32: 'Confira se o firewall ou o antivírus está bloqueando o Nova AI e se a pasta de dados do app permite gravação.',
};

function textoDoAviso(platform) {
  const dica = PERMISSOES[platform] || 'Reinicie o Nova AI e confira as permissões do sistema.';
  return `O WhatsApp não iniciou após 8 tentativas. ${dica}`;
}

function avisarFalhaRepetida({ platform, mostrar }) {
  const texto = textoDoAviso(platform);
  try {
    mostrar(texto);
  } catch (_) {}
  return texto;
}

module.exports = { textoDoAviso, avisarFalhaRepetida };
