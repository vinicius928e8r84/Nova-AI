'use strict';
const crypto = require('crypto');

const APPS_DA_INJECAO = ['*', 'com.apple.camera', 'com.apple.WebKit.GPU', 'com.apple.mobilesafari', 'com.apple.facetime'];

function configuracaoDaPrevia(estado, url) {
  return {
    mode: 'inject',
    appID: 'com.apple.camera',
    appIDs: [...APPS_DA_INJECAO],
    expiresAt: estado.state.timestamp + 60,
    continuous: false,
    previewOnly: true,
    directRecording: false,
    photoPrepareBypass: false,
    videoInjection: false,
    frameRate: 15,
    url,
  };
}

function configuracaoDaInjecao(estado, endpoint) {
  const configuracao = {
    mode: 'inject',
    appID: 'com.apple.camera',
    appIDs: [...APPS_DA_INJECAO],
    expiresAt: estado.state.timestamp + 60,
    continuous: true,
    previewOnly: false,
    directRecording: false,
    photoPrepareBypass: true,
    videoInjection: true,
    audioInjection: true,
    frameRate: 30,
    url: endpoint.url,
    novaSequestroSession: crypto.randomBytes(8).toString('hex'),
  };
  if (endpoint.socket) configuracao.socket = endpoint.socket;
  return configuracao;
}

module.exports = { configuracaoDaPrevia, configuracaoDaInjecao };
