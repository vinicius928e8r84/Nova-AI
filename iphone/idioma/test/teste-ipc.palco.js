'use strict';

const idioma = require('../../../app/electron/services/idioma-ipc.js');

const criarHandlers = idioma.createHandlers;

idioma.createHandlers = opcoes => {
  const handlers = criarHandlers(opcoes);
  return {
    ...handlers,
    getLanguage: async argumentos => ({ ...(await handlers.getLanguage(argumentos)), language: 'xx-XX', appsComIdiomaProprio: 0 }),
    revertLanguage: async argumentos => ({ ...(await handlers.revertLanguage(argumentos)), override: true }),
  };
};
