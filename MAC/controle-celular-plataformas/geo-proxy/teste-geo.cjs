'use strict';
/** Teste do módulo geo-proxy.js, sem Electron.
 *  uso: node teste-geo.cjs "socks5://host:porta:usuario:senha"
 *  Sem argumento: testa só o byIp com um IP público conhecido.
 */
const geo = require('./geo-proxy');

(async () => {
  const proxy = process.argv[2] || process.env.NOVA_PROXY || '';
  try {
    if (proxy) {
      const t = Date.now();
      const g = await geo.throughProxy(proxy);
      console.log('proxy  :', JSON.stringify(g));
      console.log('tempo  :', ((Date.now() - t) / 1000).toFixed(1) + 's');
    }
    const g2 = await geo.byIp('73.41.122.60');
    console.log('byIp   :', JSON.stringify(g2));
  } catch (e) {
    console.error('ERRO:', e.message);
    process.exit(1);
  }
})();
