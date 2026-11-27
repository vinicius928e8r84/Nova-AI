const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bundle = process.argv[2] || path.join(__dirname, '..', '..', '..', '..', 'app', 'dist', 'assets', 'index-Dun7lr2S.js');
const source = fs.readFileSync(bundle, 'utf8');

assert.ok(source.includes('physical-mobile:ios-console-open'), 'bundle sem o canal do controle do iPhone');
assert.ok(/PI=async eI=>\{if\(SI\)try\{await SI\.invoke\("physical-mobile:ios-console-open",eI\)\}/.test(source), 'PI não definido');

const start = source.indexOf('eI.streaming?b.jsxs("button"');
const end = source.indexOf(',eI.type==="usb"', start);
assert.ok(start > 0 && end > start, 'não achei o botão do cartão no bundle');
const expr = source.slice(start, end);

const b = { jsx: (type, props) => props, jsxs: (type, props) => props };
const mW = () => 'stop-icon';
const bY = () => 'play-icon';
const calls = [];
const Wc = (id) => calls.push('stop:' + id);
const fG = (id) => calls.push('connect:' + id);
const PI = (id) => calls.push('console:' + id);
const montar = (device) => new Function('eI', 'b', 'mW', 'bY', 'Wc', 'fG', 'PI', 'return ' + expr)(device, b, mW, bY, Wc, fG, PI);

const iphone = montar({ id: 'ios-47F4FC', streaming: true });
iphone.onClick({ stopPropagation() {} });
assert.equal(calls.pop(), 'console:ios-47F4FC');
assert.match(JSON.stringify(iphone.children), /Abrir controle/);
assert.match(iphone.className, /bg-j-cyan/);
assert.doesNotMatch(JSON.stringify(iphone.children), /Parar transmissão/);

const iphoneLegado = montar({ id: 'algum-id', ios: true, streaming: true });
iphoneLegado.onClick({ stopPropagation() {} });
assert.equal(calls.pop(), 'console:algum-id');

const android = montar({ id: 'R58M123ABC', streaming: true });
android.onClick({ stopPropagation() {} });
assert.equal(calls.pop(), 'stop:R58M123ABC');
assert.match(JSON.stringify(android.children), /Parar transmissão/);
assert.match(android.className, /bg-red-500/);

assert.doesNotMatch(JSON.stringify(iphone.children), /Conectar/);

console.log('OK: cartão do iPhone mostra "Abrir controle" (canal ios-console-open); Android segue com "Parar transmissão".');
