'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { criar } = require('./auxiliar');
const { contextoDoRepositorio } = require('./contexto-de-repositorio');
const regra = require('../regra-segredo');

const juntar = (...partes) => partes.join('');
const AWS = juntar('AKI', 'A', 'IOSFODNN7', 'ABCDEFG');
const AWS_TEMPORARIA = juntar('AS', 'IA', 'IOSFODNN7', 'ABCDEFG');
const GOOGLE = juntar('AI', 'za', 'SyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P67');
const GITHUB = juntar('gh', 'p_', 'a'.repeat(20), 'B'.repeat(16));
const GITHUB_FINO = juntar('github', '_pat_', 'a1B2'.repeat(13));
const SLACK = juntar('xo', 'xb-', '1234567890', 'abcdef');
const SK = juntar('s', 'k-', 'a1B2c3D4e5F6g7H8i9J0k1L2');
const SK_ANTHROPIC = juntar('s', 'k-', 'ant-', 'a1B2c3D4e5F6g7H8i9J0k1L2');
const JWT = juntar('ey', 'Jhbgcioijiuzi1ni', '.', 'ey', 'Jzdwiioixmjm0nta', '.', 'abcdefghijkl');
const CHAVE_PRIVADA = juntar('-----BEGIN ', 'RSA ', 'PRIVATE KEY-----');
const CHAVE_PGP = juntar('-----BEGIN ', 'PGP ', 'PRIVATE KEY BLOCK-----');
const TELEGRAM = juntar('123456789', ':', 'AAH', 'x'.repeat(10), 'Y'.repeat(10), 'z'.repeat(12));
const SENHA = juntar('Zx9fKq2', 'LmN8vB4');
const HASH = juntar('5f4dcc3b5aa765d6', '1d8327deb882cf99');
const VALOR_MISTO = juntar('Ab3$', 'Xy9!', 'Qw7#', 'Lm5%');

const ARROBA = String.fromCharCode(64);
const urlCom = (senha, host = 'db.interno.com') => `postgres://admin:${senha}${ARROBA}${host}/x`;
const HEX_MISTO = juntar('0123456789abcdef', '0123456789ABCDEF');
const MISTO_CURTO = juntar('Abcdefgh', '12345678');

const LINHAS = [
  [`const k = "${CHAVE_PRIVADA}";`, 'chave privada'],
  [CHAVE_PGP, 'chave privada'],
  [`x = ${AWS}`, 'chave de acesso da AWS'],
  [`x = ${AWS_TEMPORARIA}`, 'chave de acesso da AWS'],
  [`x = ${AWS}Z`, null],
  [`x = ${GOOGLE}`, 'chave de API do Google'],
  [`x = ${GITHUB}`, 'token do GitHub'],
  [`x = ${GITHUB_FINO}`, 'token do GitHub'],
  [`x = ${SLACK}`, 'token do Slack'],
  [`x = ${SK}`, 'chave de API (sk-)'],
  [`x = ${SK_ANTHROPIC}`, 'chave de API (sk-)'],
  [`x = ${JWT}`, 'JWT'],
  [`fetch("https://api.telegram.org/bot${TELEGRAM}/sendMessage")`, 'token de bot do Telegram'],
  [`x = ${TELEGRAM}`, 'token de bot do Telegram'],
  [`postgres://admin:${SENHA}@db.interno.com/x`, 'URL com usuário e senha'],
  [`postgres://admin:${SENHA}@db.exemplo.com.evil.io/x`, 'URL com usuário e senha'],
  [`postgres://admin:${SENHA}@db.example.com:5432/x`, null],
  [`postgres://admin:${SENHA}@db.exemplo.net/x`, null],
  [urlCom('senha'), null],
  ['postgres://admin:<senha>@db.interno.com/x', null],
  ['postgres://admin:${SENHA}@db.interno.com/x', null],
  [urlCom('%SENHA%'), 'URL com usuário e senha'],
  ['postgres://admin:%SENHA@db.interno.com/x', null],
  [urlCom('xxxxxx'), null],
  [urlCom('abc'), null],
  [`socks5://h.interno.com:1002${ARROBA}usr:${SENHA}`, 'URL com usuário e senha'],
  [`"http://core.interno.com:1000@aquiles77:${SENHA}"`, 'URL com usuário e senha'],
  ['socks5://h.exemplo.com:1002@usr:senha', null],
  [`socks5://h.exemplo.com:1002@usr:${SENHA}`, null],
  [`"senha": "${HASH}"`, 'valor literal em campo de segredo'],
  [`api_key = "${VALOR_MISTO}"`, 'valor literal em campo de segredo'],
  [`const TOKEN = '${VALOR_MISTO}'`, 'valor literal em campo de segredo'],
  [`password: "${VALOR_MISTO}"`, 'valor literal em campo de segredo'],
  [`password: ${VALOR_MISTO}`, null],
  ['password: "curta123"', null],
  ['password: "abcdefghijklmnopqrstuvwxyz"', null],
  ['password: "ABCDEFGHIJKLMNOPQRSTUVWXYZ"', null],
  ['password: "abcdefgh12345678abcdefgh12345678"', null],
  [`password: "${HEX_MISTO}"`, 'valor literal em campo de segredo'],
  ['password: "0123456789abcdef0123456789abcde"', null],
  ['password: "abcdefgh1234567"', null],
  [`password: "${MISTO_CURTO}"`, 'valor literal em campo de segredo'],
  ['password: "Abab1212Abab1212"', null],
  ['password: "Ab1$Ab1$Ab1$Ab1$"', null],
  [`password: "${VALOR_MISTO}example"`, null],
  [`password: "${VALOR_MISTO}xxxx"`, null],
  [`password: "${VALOR_MISTO}<x>"`, null],
  [`password: process.env.${VALOR_MISTO}`, null],
  [`password: "seu_${VALOR_MISTO}"`, null],
  [`password: "${VALOR_MISTO}fake"`, null],
  [`password: "${VALOR_MISTO}..."`, null],
  [`apikey: "${VALOR_MISTO}" // ${AWS}`, 'chave de acesso da AWS'],
  [`const url = "http://u:${SENHA}@h.interno.com"; const s = "${AWS}"`, 'chave de acesso da AWS'],
  [`const url = "http://u:${SENHA}@h.interno.com"; password = "${VALOR_MISTO}"`, 'URL com usuário e senha'],
  ['', null],
  ['const a = 1;', null],
];

const JANELA = 2000;
const SOBRA = 200;

test('segredo: identidade, título e texto do conserto', () => {
  assert.equal(regra.id, 'sem-segredo');
  assert.equal(regra.titulo, 'Nenhum segredo, chave, token ou arquivo de credencial no diff');
  assert.equal(crypto.createHash('sha256').update(regra.conserto).digest('hex'), '26b8b287ee70630ae66e6e46da1107a12ee23991edc9f984a920b0b6aea5ade7');
  assert.deepEqual(Object.keys(regra).sort(), ['acharNaLinha', 'conserto', 'id', 'titulo', 'verificar']);
});

test('segredo: acharNaLinha dá o nome do padrão que casa, e só ele', () => {
  const lidas = LINHAS.map(([linha]) => regra.acharNaLinha(linha));
  assert.deepEqual(lidas, LINHAS.map(([, nome]) => nome));
});

test('segredo: linha enorme é varrida em janelas de 2000 com sobra de 200', () => {
  const passo = JANELA - SOBRA;
  const comSegredoNa = (posicao, achado = AWS) => `${' '.repeat(posicao)}"${achado}"${' '.repeat(5000)}`;
  const posicoes = [0, 1000, JANELA - AWS.length - 1, JANELA - AWS.length, JANELA - 10, JANELA - 1, JANELA, JANELA + 1, passo - 3, passo, passo + 1, passo * 2 - 5, passo * 2 + 7, passo * 3 + 50, passo * 3 + JANELA - AWS.length - 3];
  for (const posicao of posicoes) assert.equal(regra.acharNaLinha(comSegredoNa(posicao)), 'chave de acesso da AWS', `posição ${posicao}`);
  assert.equal(regra.acharNaLinha(comSegredoNa(5000, 'nada')), null);
  assert.equal(regra.acharNaLinha(' '.repeat(JANELA + 1)), null);
  assert.equal(regra.acharNaLinha(`${' '.repeat(JANELA - 1 - AWS.length)}"${AWS}"`), 'chave de acesso da AWS');
  assert.equal(regra.acharNaLinha(`"${AWS}"${' '.repeat(JANELA)}`), 'chave de acesso da AWS');
});

const MEGA = 1024 * 1024;
const comNulos = (...partes) => Buffer.concat([Buffer.from([0, 9, 0, 2]), ...partes.map(parte => Buffer.from(parte, 'latin1')), Buffer.from([0])]);
const utf16 = texto => Buffer.from(texto, 'utf16le');
const comSegredoEmUtf16 = (prefixo, texto) => Buffer.concat([Buffer.from(prefixo), utf16(texto), Buffer.from([0, 9, 0, 2, 0, 0, 1])]);
const gigante = Buffer.concat([Buffer.from([0, 9, 0, 2]), Buffer.from(AWS), Buffer.alloc(33 * MEGA)]);
const SEGREDO_VELHO = `const velho = "${AWS}";\n`;

const BASE = {
  'app/estavel.dat': comNulos(AWS),
  'app/limpo-antes.dat': comNulos('nada de mais'),
  'app/velho.dat': comNulos(AWS, 'x'.repeat(300)),
  'app/velho-limpo.dat': comNulos('y'.repeat(300)),
  'app/velho.js': `${SEGREDO_VELHO}const a = 1;\nconst b = 2;\n`,
  'app/outro.js': 'a\nb\nc\nd\ne\n',
  'app/so-apaga.js': `${SEGREDO_VELHO}const a = 1;\nconst b = 2;\n`,
  'app/texto-com-segredo.txt': SEGREDO_VELHO,
};

const MUDANCAS = {
  '.env': '',
  'app/secret_key.json': `{"k": "${AWS}"}\n`,
  'iphone/id_rsa': 'x\n',
  '.wwebjs_auth/sessao.txt': 'x\n',
  'app/estavel.dat': comNulos(AWS, ' e mais um pouco'),
  'app/limpo-antes.dat': comNulos('nada de mais', ' ', AWS),
  'app/velho.dat': null,
  'app/renomeado.dat': comNulos(AWS, 'x'.repeat(300)),
  'app/velho-limpo.dat': null,
  'app/renomeado-sujo.dat': comNulos('y'.repeat(300), ' ', AWS),
  'app/velho.js': `${SEGREDO_VELHO}const a = 1;\nconst b = 2;\nconst c = "${AWS}";\n`,
  'app/outro.js': `a\nconst k = "${AWS}";\nc\nd\nconst token = "${HASH}";\ne\n`,
  'app/so-apaga.js': 'const a = 1;\nconst b = 2;\n',
  'app/desordenado.js': `a\nconst k = "${AWS}";\nc\nd\nconst token = "${HASH}";\n`,
  'app/novo.js': `const a = 1;\nconst b = "${GITHUB}";\nconst c = 3;\nconst u = "http://u:${SENHA}@h.interno.com";\nconst d = 4;\n`,
  'app/copia-de-texto.txt': SEGREDO_VELHO,
  'app/copia.dat': comNulos(AWS),
  'app/novo.dat': comNulos('x ', JWT, ' y'),
  'app/limpo.dat': comNulos('nada que pareça segredo aqui'),
  'app/utf16-par.dat': comSegredoEmUtf16([0, 9, 0, 2], SK),
  'app/utf16-impar.dat': comSegredoEmUtf16([0, 9, 0], SK_ANTHROPIC),
  'app/gigante.dat': gigante,
  'app/texto-com-segredo.txt': `${SEGREDO_VELHO}${TELEGRAM}\n`,
};

const EXTRAS = [
  { caminho: 'app/fantasma.js', status: 'A' },
  { caminho: '.env.local', status: 'A' },
];

const resumo = achados => achados.map(({ arquivo, linha, detalhe }) => `${arquivo}${linha ? `:${linha}` : ''} | ${detalhe}`);

test('segredo: verificar julga cada tipo de arquivo num repositório de verdade', () => {
  const repo = criar(BASE);
  try {
    repo.escrever(MUDANCAS);
    repo.git('add', '-A');
    const ctx = contextoDoRepositorio(repo);
    ctx.arquivos.push(...EXTRAS);
    ctx.mudancas.acrescentadas.set('app/desordenado.js', new Set([5, 2]));
    assert.deepEqual([...ctx.mudancas.copias].sort(), ['app/copia-de-texto.txt', 'app/copia.dat']);
    assert.deepEqual(ctx.arquivos.map(item => `${item.status} ${item.caminho}`).filter(item => !item.startsWith('A ')), [
      'M app/estavel.dat', 'M app/limpo-antes.dat', 'M app/outro.js', 'R app/renomeado-sujo.dat', 'R app/renomeado.dat', 'M app/so-apaga.js', 'M app/texto-com-segredo.txt', 'M app/velho.js',
    ]);
    const achados = regra.verificar(ctx);
    assert.deepEqual(resumo(achados), [
      '.env | arquivo de segredo, chave ou sessão não entra no repositório',
      '.wwebjs_auth/sessao.txt | arquivo de segredo, chave ou sessão não entra no repositório',
      'app/desordenado.js:2 | parece chave de acesso da AWS (o valor não é mostrado)',
      'app/desordenado.js:5 | parece valor literal em campo de segredo (o valor não é mostrado)',
      'app/limpo-antes.dat | arquivo binário com texto que parece chave de acesso da AWS (o valor não é mostrado)',
      'app/novo.dat | arquivo binário com texto que parece JWT (o valor não é mostrado)',
      'app/novo.js:2 | parece token do GitHub (o valor não é mostrado)',
      'app/novo.js:4 | parece URL com usuário e senha (o valor não é mostrado)',
      'app/outro.js:2 | parece chave de acesso da AWS (o valor não é mostrado)',
      'app/outro.js:5 | parece valor literal em campo de segredo (o valor não é mostrado)',
      'app/renomeado-sujo.dat | arquivo binário com texto que parece chave de acesso da AWS (o valor não é mostrado)',
      'app/secret_key.json | arquivo de segredo, chave ou sessão não entra no repositório',
      'app/texto-com-segredo.txt:2 | parece token de bot do Telegram (o valor não é mostrado)',
      'app/utf16-impar.dat | arquivo binário com texto que parece chave de API (sk-) (o valor não é mostrado)',
      'app/utf16-par.dat | arquivo binário com texto que parece chave de API (sk-) (o valor não é mostrado)',
      'app/velho.js:4 | parece chave de acesso da AWS (o valor não é mostrado)',
      'iphone/id_rsa | arquivo de segredo, chave ou sessão não entra no repositório',
      '.env.local | arquivo de segredo, chave ou sessão não entra no repositório',
    ]);
    assert.ok(achados.every(achado => !JSON.stringify(achado).includes(AWS)));
  } finally {
    repo.limpar();
  }
});
