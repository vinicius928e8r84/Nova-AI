'use strict';

const SENHA = ['senha', 'Falsa', '_country-US_mode-quality_session-AAAABBBB_lifetime-1440'].join('');
const ARROBA = '@';

const ENTRADAS = [
  null, 42, '', '   ', 'localhost:8080', ' proxy.exemplo.com:1080 ', 'proxy.exemplo.com', 'proxy.exemplo.com:0', 'proxy.exemplo.com:65535',
  'proxy.exemplo.com:65536', 'proxy.exemplo.com:123456', 'proxy.exemplo.com:-1', 'proxy.exemplo.com:80a', '1.2.3.4:80', '1234:80', 'ab:80',
  '.exemplo.com:80', 'pro xy.exemplo.com:80', '[::1].x:80', 'proxy_1.exemplo.com:3128',
  `proxy.exemplo.com:1002${ARROBA}usuario:${SENHA}`, `usuario:${SENHA}${ARROBA}proxy.exemplo.com:1002`, `usuario${ARROBA}proxy.exemplo.com:1002`,
  `:${SENHA}${ARROBA}proxy.exemplo.com:1002`, `${ARROBA}proxy.exemplo.com:1002`, `proxy.exemplo.com:1002${ARROBA}`, `usuario${ARROBA}a${ARROBA}proxy.exemplo.com:1002`,
  `proxy.exemplo.com:1002${ARROBA}usuario:${SENHA}${ARROBA}extra`, `usuario:senha${ARROBA}nada`, `nada${ARROBA}tambem`,
  `proxy.exemplo.com:1002${ARROBA}proxy2.exemplo.com:2002`, `proxy.exemplo.com${ARROBA}proxy2.exemplo.com:2002:x`,
  'proxy.exemplo.com:1001:usuario:senha', `proxy.exemplo.com:1001:usuario:${SENHA}`, 'proxy.exemplo.com:1001::senha', 'proxy.exemplo.com:1001:usuario',
  'proxy.exemplo.com:1001:usuario:senha:mais:coisa', 'proxy.exemplo.com:1001::senha:mais', `usuario:${SENHA}:proxy.exemplo.com:1002`,
  'usuario:a:b:proxy.exemplo.com:1002', ':senha:proxy.exemplo.com:1002', 'usuario:senha:host:1002', 'a:b:c', 'a:b:c:d:e',
  'socks5://proxy.exemplo.com:1080', 'SOCKS5h://proxy.exemplo.com:1080', 'http://proxy.exemplo.com:8080:usuario:senha',
  `https://usuario:senha${ARROBA}proxy.exemplo.com:443`, 'socks4a+x.y-z://proxy.exemplo.com:1080', '1http://proxy.exemplo.com:80',
  'proxy.exemplo.com:1001:proxy2.exemplo.com:2002', 'http://', 'http://   ', 'ftp://nada', `socks5://proxy.exemplo.com:1002${ARROBA}usuario:${SENHA}`, 'http:/proxy.exemplo.com:80',
];

const ESQUEMAS = [undefined, '', 'http', 'HTTPS://', 'socks5h'];

module.exports = { ENTRADAS, ESQUEMAS };
