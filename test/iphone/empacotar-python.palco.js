'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { copiarFontes, normalizar, ultimaLinha, rodarPython, sha256 } = require('./script-python.palco');

const RAIZ_DO_REPOSITORIO = path.join(__dirname, '..', '..');
const PASTA_DA_DISTRIBUICAO = path.join(RAIZ_DO_REPOSITORIO, 'distribuicao');
const SUBPASTAS_DO_CORTE = ['python_portatil'];
const MAGIA_DO_MACH_O = Buffer.from([0xcf, 0xfa, 0xed, 0xfe]);
const VERSAO = '3.15';

const FERRAMENTA_DE_DEPENDENCIAS = [
  '#!/bin/sh',
  '[ "$FALHAR" = otool ] && exit 1',
  'echo "$2:"',
  'arquivo="$NOVA_TESTE_DEPENDENCIAS/$(basename "$2")"',
  '[ -f "$arquivo" ] || exit 0',
  'while IFS= read -r dependencia; do',
  "  printf '\\t%s (compatibility version 1.0.0, current version 1.0.0)\\n' \"$dependencia\"",
  'done < "$arquivo"',
  '',
].join('\n');

const FERRAMENTA_QUE_MARCA = [
  '#!/bin/sh',
  'nome=$(basename "$0")',
  '[ "$FALHAR" = "$nome" ] && exit 1',
  'for ultimo; do :; done',
  'printf \'%s %s\\n\' "$nome" "$*" >> "$NOVA_TESTE_CHAMADAS"',
  'printf \'\\n#%s %s\' "$nome" "$*" | sed -e "s#$NOVA_TESTE_RAIZ#<raiz>#g" -e "s#$NOVA_TESTE_RAIZ_REAL#<raiz>#g" >> "$ultimo"',
  '',
].join('\n');

function caminhosDaCena(raiz) {
  const homebrew = path.join(raiz, 'homebrew');
  return {
    raiz,
    recursos: path.join(raiz, 'recursos'),
    homebrew,
    ferramentas: path.join(raiz, 'ferramentas'),
    dependencias: path.join(raiz, 'dependencias'),
    chamadas: path.join(raiz, 'chamadas.txt'),
    framework: path.join(homebrew, 'Cellar', 'python@3.15', '3.15.2', 'Frameworks', 'Python.framework', 'Versions', VERSAO),
    pacotesDoApp: path.join(raiz, 'recursos', 'python-env', 'lib', `python${VERSAO}`, 'site-packages'),
    runtime: path.join(raiz, 'recursos', 'python-runtime-portable'),
  };
}

function escrever(caminho, conteudo, modo = 0o644) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, conteudo);
  fs.chmodSync(caminho, modo);
}

function escreverMachO(caminho, identidade, dependencias, caminhos) {
  escrever(caminho, Buffer.concat([MAGIA_DO_MACH_O, Buffer.from(`\nmach-o ${identidade}\n`)]));
  escrever(path.join(caminhos.dependencias, path.basename(caminho)), dependencias.map(dependencia => `${dependencia}\n`).join(''));
}

function montarFerramentas(caminhos) {
  escrever(path.join(caminhos.ferramentas, 'otool'), FERRAMENTA_DE_DEPENDENCIAS, 0o755);
  for (const nome of ['install_name_tool', 'codesign']) escrever(path.join(caminhos.ferramentas, nome), FERRAMENTA_QUE_MARCA, 0o755);
}

function montarBibliotecas(caminhos) {
  const lib = nome => path.join(caminhos.homebrew, 'opt', nome);
  const ssl = lib('openssl@3/lib/libssl.3.dylib');
  const crypto = lib('openssl@3/lib/libcrypto.3.dylib');
  const portaudio = lib('portaudio/lib/libportaudio.2.dylib');
  escreverMachO(portaudio, 'portaudio', [portaudio, '/System/Library/Frameworks/CoreAudio.framework/Versions/A/CoreAudio'], caminhos);
  escreverMachO(ssl, 'ssl', [ssl, crypto, '/usr/lib/libSystem.B.dylib'], caminhos);
  escreverMachO(crypto, 'crypto', [crypto], caminhos);
  return { ssl, crypto, portaudio };
}

function montarFramework(caminhos, bibliotecas) {
  const { framework } = caminhos;
  escreverMachO(path.join(framework, 'Python'), 'python', [bibliotecas.ssl, '/usr/lib/libSystem.B.dylib', '@loader_path/../x'], caminhos);
  escrever(path.join(framework, 'lib', 'python3.15', 'os.py'), 'import sys\n');
  escrever(path.join(framework, 'lib', 'python3.15', 'site-packages', 'ignorado.py'), 'ignorado\n');
  escrever(path.join(framework, 'lib', 'python3.15', '__pycache__', 'os.pyc'), 'ignorado\n');
  escrever(path.join(framework, 'Headers', 'ignorado.h'), 'ignorado\n');
  escrever(path.join(framework, 'Resources', 'Info.plist'), '<plist/>\n');
}

function montarPacotesDoApp(caminhos) {
  const { pacotesDoApp } = caminhos;
  escrever(path.join(pacotesDoApp, 'sounddevice.py'), 'import os as _os\nfrom ctypes.util import find_library as _find_library\n');
  escrever(path.join(pacotesDoApp, 'certifi', 'cacert.pem'), 'certificados\n');
  escrever(path.join(pacotesDoApp, 'pacote', '__pycache__', 'x.pyc'), 'ignorado\n');
}

function montarExtensoesNativas(caminhos, bibliotecas) {
  const { framework, pacotesDoApp } = caminhos;
  const dependencias = [bibliotecas.portaudio, '@rpath/libx.dylib', '/usr/lib/libc++.1.dylib', bibliotecas.crypto];
  escreverMachO(path.join(pacotesDoApp, 'pacote', 'nativo.so'), 'nativo', dependencias, caminhos);
  escreverMachO(path.join(framework, 'bin', 'python3.15'), 'executavel', ['@executable_path/../Python'], caminhos);
  escreverMachO(path.join(framework, 'lib', 'python3.15', 'lib-dynload', '_ssl.so'), 'ssl-ext', [bibliotecas.ssl, bibliotecas.crypto], caminhos);
  fs.symlinkSync('python3.15', path.join(framework, 'bin', 'python3'));
}

function montarArvore(caminhos, { completa }) {
  montarFerramentas(caminhos);
  const bibliotecas = montarBibliotecas(caminhos);
  montarFramework(caminhos, bibliotecas);
  montarPacotesDoApp(caminhos);
  if (completa) montarExtensoesNativas(caminhos, bibliotecas);
  return bibliotecas;
}

function trocasDoScript(caminhos) {
  return [
    ['/Applications/Nova AI Mac.app/Contents/Resources', caminhos.recursos],
    ['/usr/bin/', `${caminhos.ferramentas}/`],
    ['/opt/homebrew', caminhos.homebrew],
  ];
}

function impressaoDoConteudo(conteudo, raiz) {
  const texto = normalizar(conteudo.toString('latin1'), [raiz]);
  return { bytes: texto.length, sha256: sha256(Buffer.from(texto, 'latin1')) };
}

function descreverEntrada(caminho, relativo, raiz) {
  const estado = fs.lstatSync(caminho);
  if (estado.isSymbolicLink()) return { caminho: relativo, tipo: 'link', alvo: fs.readlinkSync(caminho) };
  if (estado.isDirectory()) return { caminho: relativo, tipo: 'diretorio' };
  const impressao = impressaoDoConteudo(fs.readFileSync(caminho), raiz);
  return { caminho: relativo, tipo: 'arquivo', executavel: (estado.mode & 0o111) !== 0, ...impressao };
}

function fotografar(pasta, relativo, raiz) {
  if (!fs.existsSync(pasta)) return [];
  return fs.readdirSync(pasta).sort().flatMap(nome => {
    const caminho = path.join(pasta, nome);
    const filho = path.posix.join(relativo, nome);
    const entrada = descreverEntrada(caminho, filho, raiz);
    return entrada.tipo === 'diretorio' ? [entrada, ...fotografar(caminho, filho, raiz)] : [entrada];
  });
}

function lerTexto(caminho, raiz) {
  return fs.existsSync(caminho) ? normalizar(fs.readFileSync(caminho, 'utf8'), [raiz]) : null;
}

function linhasDasChamadas(caminhos, cena) {
  const linhas = (lerTexto(caminhos.chamadas, caminhos.raiz) || '').split('\n').filter(Boolean);
  return cena.ordenar ? linhas.sort() : linhas;
}

function ordenarManifesto(texto, cena) {
  if (!texto) return null;
  const entradas = JSON.parse(texto);
  return cena.ordenar ? entradas.sort((a, b) => a.file.localeCompare(b.file)) : entradas;
}

function diarioDaExecucao(caminhos, cena, resposta) {
  const { raiz, runtime } = caminhos;
  const manifesto = lerTexto(path.join(runtime, 'manifest.json'), raiz);
  return {
    codigo: resposta.codigo,
    stdout: normalizar(resposta.stdout, [raiz]),
    erro: normalizar(ultimaLinha(resposta.stderr), [raiz]),
    arvore: fotografar(runtime, '', raiz),
    manifesto: ordenarManifesto(manifesto, cena),
    runPython: lerTexto(path.join(runtime, 'run-python'), raiz),
    sounddevice: lerTexto(path.join(runtime, 'Python.framework', 'Versions', VERSAO, 'lib', `python${VERSAO}`, 'site-packages', 'sounddevice.py'), raiz),
    chamadas: linhasDasChamadas(caminhos, cena),
  };
}

function rodarCena(python, cena) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'empacotar-python-'));
  try {
    const caminhos = caminhosDaCena(raiz);
    const bibliotecas = montarArvore(caminhos, { completa: !cena.minima });
    if (cena.ajustar) cena.ajustar(caminhos, bibliotecas);
    const scripts = path.join(raiz, 'scripts');
    copiarFontes(PASTA_DA_DISTRIBUICAO, scripts, { trocas: trocasDoScript(caminhos), subpastas: SUBPASTAS_DO_CORTE });
    const env = {
      NOVA_TESTE_DEPENDENCIAS: caminhos.dependencias,
      NOVA_TESTE_CHAMADAS: caminhos.chamadas,
      NOVA_TESTE_RAIZ: raiz,
      NOVA_TESTE_RAIZ_REAL: fs.realpathSync(raiz),
      ...cena.env,
    };
    const resposta = rodarPython(python, { cwd: raiz, script: path.join(scripts, 'empacotar-python.py'), env });
    return diarioDaExecucao(caminhos, cena, resposta);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
}

module.exports = { rodarCena, escrever, escreverMachO, VERSAO };
