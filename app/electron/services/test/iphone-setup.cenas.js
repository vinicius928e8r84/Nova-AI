'use strict';
const { tentar, SENHA, ID_DO_IPHONE, UDID } = require('./iphone-setup.palco');

const OUTRO_UDID = 'b'.repeat(40);
const SEM_PACOTES = { pacotes: [], modelo: 'iPhone9,1', semHelperDeFuso: true };
const TUDO_INSTALADO = {
  cameraAtualizada: 'yes',
  versoes: { camera: '0.1-40', novamodel: '1.2', novalanguage: '0.2-3', novaproxy: '1.0' },
};

const preparar = (contexto, id = ID_DO_IPHONE, senha = SENHA) => tentar(() => contexto.setup.prepare(id, senha, contexto.servico));
const falhaDeSudo = { codigo: 1, erro: 'sudo: a password is required' };

async function preparacoesEmSerie(contexto, variacoes) {
  const resultados = {};
  for (const [nome, ambiente] of Object.entries(variacoes)) {
    Object.assign(contexto.ambiente, ambiente);
    resultados[nome] = await preparar(contexto);
  }
  return resultados;
}

const CENAS = [
  {
    nome: 'senha ou identificador inválidos são recusados antes de qualquer ferramenta',
    roteiro: async (contexto) => ({
      vazia: await preparar(contexto, ID_DO_IPHONE, ''),
      semTexto: await preparar(contexto, ID_DO_IPHONE, 12345),
      comQuebraDeLinha: await preparar(contexto, ID_DO_IPHONE, 'a\nb'),
      comNulo: await preparar(contexto, ID_DO_IPHONE, 'a\0b'),
      grandeDemais: await preparar(contexto, ID_DO_IPHONE, 'x'.repeat(1025)),
      identificadorCurto: await preparar(contexto, 'ios-curto'),
      identificadorComLetrasFora: await preparar(contexto, `ios-${'z'.repeat(40)}`),
    }),
  },
  {
    nome: 'sem o OpenSSH do Windows a preparação para antes de olhar o aparelho',
    ambiente: { abrirOpenssh: () => { throw new Error('O Cliente OpenSSH do Windows não está ativo.'); } },
    roteiro: async (contexto) => ({ semOpenssh: await preparar(contexto) }),
  },
  {
    nome: 'só pode haver um iPhone ligado e tem de ser o escolhido',
    roteiro: async (contexto) => preparacoesEmSerie(contexto, {
      dois: { aparelhos: `${ID_DO_IPHONE.slice(4)}\n${OUTRO_UDID}\n` },
      outro: { aparelhos: `${OUTRO_UDID}\n` },
      nenhum: { aparelhos: '\n' },
    }),
  },
  {
    nome: 'com a porta fechada sobe o iproxy do aparelho, espera abrir e segue com a preparação mínima',
    ambiente: { ...SEM_PACOTES, portaAberta: false, portaAbreDepoisDoProcesso: true },
    roteiro: async (contexto) => ({ preparacao: await preparar(contexto) }),
  },
  {
    nome: 'com a porta que nunca abre o túnel USB falha depois de tentar o iproxy duas vezes',
    ambiente: { ...SEM_PACOTES, portaAberta: false },
    roteiro: async (contexto) => ({ preparacao: await preparar(contexto) }),
  },
  {
    nome: 'a conexão SSH que recusa ou cai antes de ficar pronta vira erro claro',
    ambiente: SEM_PACOTES,
    roteiro: async (contexto) => preparacoesEmSerie(contexto, { recusa: { conexao: 'erro' }, queda: { conexao: 'queda' } }),
  },
  {
    nome: 'a impressão digital nova é gravada, a mesma passa e a diferente é recusada',
    ambiente: SEM_PACOTES,
    roteiro: async (contexto) => preparacoesEmSerie(contexto, {
      primeira: {},
      repetida: {},
      diferente: { impressaoDoServidor: 'f'.repeat(64) },
    }),
  },
  {
    nome: 'iPhone 8 Plus com iOS 16.7.16 e nada instalado recebe câmera, modelo, idioma, helper de fuso e proxy',
    roteiro: async (contexto) => ({ preparacao: await preparar(contexto) }),
  },
  {
    nome: 'com tudo já instalado só reenvia o helper de fuso e conta o que já estava',
    ambiente: { ...TUDO_INSTALADO, catvnc: true },
    roteiro: async (contexto) => ({ preparacao: await preparar(contexto) }),
  },
  {
    nome: 'a câmera mais antiga que a versão do Nova é reinstalada',
    ambiente: { ...TUDO_INSTALADO, cameraAtualizada: 'no', versoes: { ...TUDO_INSTALADO.versoes, camera: '0.1-30' } },
    roteiro: async (contexto) => ({ preparacao: await preparar(contexto) }),
  },
  {
    nome: 'outro modelo ou outro iOS não recebe a câmera nem reinicia a mídia',
    ambiente: { ...TUDO_INSTALADO },
    roteiro: async (contexto) => preparacoesEmSerie(contexto, { outroModelo: { modelo: 'iPhone15,2' }, outroIos: { modelo: 'iPhone10,2', versaoDoIos: '17.0' } }),
  },
  {
    nome: 'sem o pacote da câmera no Nova a preparação para depois de preparar o SSH',
    ambiente: { pacotes: ['novamodel', 'novalanguage', 'novaproxy'] },
    roteiro: async (contexto) => ({ preparacao: await preparar(contexto) }),
  },
  {
    nome: 'falhas no mediaserverd, no idioma, no helper de fuso e no proxy viram avisos no resultado',
    ambiente: {
      regras: [
        [/mediaserverd/, () => ({ codigo: 1, erro: 'mediaserverd recusou' })],
        [/novalanguage\.deb/, () => ({ codigo: 1, erro: `idioma ${'x'.repeat(200)}` })],
        [/mv \/var\/mobile\/nova-locale\.sh/, () => ({ codigo: 1, erro: 'mv recusou' })],
        [/novaproxy\.deb/, () => ({ codigo: 1, erro: 'proxy recusou' })],
      ],
    },
    roteiro: async (contexto) => ({ preparacao: await preparar(contexto) }),
  },
  {
    nome: 'falha ao instalar a câmera, o modelo ou ao enviar um arquivo interrompe a preparação',
    roteiro: async (contexto) => {
      const porComando = (regra) => ({ regras: [[regra, () => ({ codigo: 1, erro: 'recusou' })]] });
      return preparacoesEmSerie(contexto, {
        camera: porComando(/NovaAI-OBSGraphBridge\.deb/),
        modelo: porComando(/NovaAI-Novamodel\.deb/),
        envio: { regras: [], falhaNoEnvio: (remoto) => (remoto.endsWith('NovaAI-Novamodel.deb') ? 'sftp negou' : null) },
      });
    },
  },
  {
    nome: 'o helper de fuso que não confirma a versão avisa para rodar o Conectar de novo',
    ambiente: { estadoDoHelper: () => '{"ok":true,"message":"pronto"}' },
    roteiro: async (contexto) => ({ preparacao: await preparar(contexto) }),
  },
  {
    nome: 'a senha recusada pelo sudo e o comando sem texto de erro têm mensagens próprias',
    ambiente: SEM_PACOTES,
    roteiro: async (contexto) => preparacoesEmSerie(contexto, {
      senhaRecusada: { modelo: 'iPhone10,2', pacotes: [], regras: [[/NovaAI-OBSGraphBridge|dpkg-query/, () => falhaDeSudo]] },
      semTexto: { regras: [[/^test -d \/var\/jb && command -v sudo/, () => ({ codigo: 1 })]] },
      comTextoDeErro: { regras: [[/^test -d \/var\/jb && command -v sudo/, () => ({ codigo: 1, erro: '  sem sudo  ' })]] },
    }),
  },
  {
    nome: 'a chave pública do aparelho inválida ou que não bate com a impressão autenticada para a preparação',
    ambiente: SEM_PACOTES,
    roteiro: async (contexto) => preparacoesEmSerie(contexto, {
      semChave: { chaveDoServidor: 'lixo\n' },
      tipoErrado: { chaveDoServidor: 'ssh-rsa AAAA root\n' },
      naoBate: { chaveDoServidor: 'ssh-ed25519 Y2hhdmUtZGUtb3V0cm8= root\n' },
    }),
  },
  {
    nome: 'a chave local é criada se falta e reaproveitada nas outras vezes',
    ambiente: SEM_PACOTES,
    roteiro: async (contexto) => ({
      ausente: await preparar(contexto),
      completa: await preparar(contexto),
    }),
  },
  {
    nome: 'chave local sem arquivo público não é substituída',
    ambiente: { ...SEM_PACOTES, chaveLocal: 'semPublica' },
    roteiro: async (contexto) => ({ preparacao: await preparar(contexto) }),
  },
  {
    nome: 'chave local com formato público não suportado é recusada',
    ambiente: { ...SEM_PACOTES, chaveLocal: 'publicaInvalida' },
    roteiro: async (contexto) => ({ preparacao: await preparar(contexto) }),
  },
  {
    nome: 'o ssh do serviço que não valida a chave avisa do conflito de chave',
    ambiente: { ...SEM_PACOTES, iosSshOk: false },
    roteiro: async (contexto) => ({ preparacao: await preparar(contexto) }),
  },
  {
    nome: 'o known_hosts ganha uma linha só, também quando o arquivo antigo não termina em quebra de linha',
    ambiente: SEM_PACOTES,
    roteiro: async (contexto) => {
      const { writeFileSync, mkdirSync } = require('fs');
      const { join } = require('path');
      mkdirSync(contexto.ambiente.pastaDoSsh, { recursive: true });
      writeFileSync(join(contexto.ambiente.pastaDoSsh, 'known_hosts'), '[outro]:22 ssh-ed25519 AAAA');
      return preparacoesEmSerie(contexto, { primeira: {}, segunda: {} });
    },
  },
  {
    nome: 'duas preparações ao mesmo tempo: a segunda é recusada e a trava se solta no fim, também depois de falha',
    ambiente: SEM_PACOTES,
    roteiro: async (contexto) => {
      const primeira = preparar(contexto);
      const segunda = await preparar(contexto);
      const aoFim = await primeira;
      contexto.ambiente.conexao = 'erro';
      const falhou = await preparar(contexto);
      contexto.ambiente.conexao = 'pronta';
      return { segunda, primeira: aoFim, falhou, depoisDaFalha: await preparar(contexto) };
    },
  },
  {
    nome: 'prompt avisa a janela do Nova com o id e o nome, e recusa janela fechada ou aparelho sem id',
    roteiro: async ({ setup }) => {
      const enviados = [];
      const janela = { isDestroyed: () => false, webContents: { send: (canal, dados) => enviados.push([canal, dados]) } };
      return {
        completo: setup.prompt(janela, { id: ID_DO_IPHONE, name: 'iPhone 8 Plus' }),
        semNome: setup.prompt(janela, { id: 7 }),
        semId: setup.prompt(janela, { name: 'sem id' }),
        semPedido: setup.prompt(janela),
        janelaFechada: setup.prompt({ isDestroyed: () => true }, { id: ID_DO_IPHONE }),
        semJanela: setup.prompt(null, { id: ID_DO_IPHONE }),
        enviados,
      };
    },
  },
  {
    nome: 'a versão do helper de fuso sai do script, e sem versão ou sem arquivo vale nulo',
    roteiro: async ({ setup }) => {
      const { writeFileSync, mkdtempSync, rmSync } = require('fs');
      const { join } = require('path');
      const { tmpdir } = require('os');
      const pasta = mkdtempSync(join(tmpdir(), 'helper-fuso-'));
      const escrever = (nome, texto) => { writeFileSync(join(pasta, nome), texto); return join(pasta, nome); };
      const lido = {
        comVersao: setup.__test.localeHelperVersion(escrever('a.sh', '#!/bin/sh\nHELPER_VERSION=12\n')),
        comEspacoNoFim: setup.__test.localeHelperVersion(escrever('b.sh', 'HELPER_VERSION=3 \t\nx')),
        semVersao: setup.__test.localeHelperVersion(escrever('c.sh', 'HELPER_VERSION=abc\n')),
        indentada: setup.__test.localeHelperVersion(escrever('d.sh', '  HELPER_VERSION=5\n')),
        semArquivo: setup.__test.localeHelperVersion(join(pasta, 'nao-existe.sh')),
      };
      rmSync(pasta, { recursive: true, force: true });
      return lido;
    },
  },
];

module.exports = { CENAS, UDID };
