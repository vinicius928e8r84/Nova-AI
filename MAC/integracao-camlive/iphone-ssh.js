'use strict';
// No app os dois arquivos ficam juntos em electron/services/. No repositório o
// CAM LIVE está em outra pasta, então este shim aponta para o canônico.
module.exports = require('../integracao-iphone/iphone-ssh');
