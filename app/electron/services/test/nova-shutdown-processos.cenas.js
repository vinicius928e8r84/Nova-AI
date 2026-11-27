'use strict';
const { processo, PASTA_DOS_HELPERS } = require('./nova-shutdown-processos.palco');

const HELPER = `${PASTA_DOS_HELPERS}Nova Helper`;
const NOVA_APP = '/Apps/Nova.app/Contents/MacOS/Nova';

const coletarEEncerrar = async ({ limpeza }) => {
  limpeza.collect();
  await limpeza.terminate();
};

const CENAS = [
  {
    nome: 'filhos do Nova são sinalizados e quem não desce dele é poupado',
    tabela: nova => [
      processo(nova, 2, NOVA_APP),
      processo(200, nova, '/usr/bin/ffmpeg'),
      processo(201, 200, '/usr/bin/ssh'),
      processo(300, 2, '/usr/bin/vim'),
    ],
    roteiro: coletarEEncerrar,
  },
  {
    nome: 'helper do Electron não é sinalizado, mas o que desce dele é',
    tabela: nova => [
      processo(nova, 2, NOVA_APP),
      processo(210, nova, HELPER),
      processo(211, 210, '/usr/bin/python3'),
    ],
    roteiro: coletarEEncerrar,
  },
  {
    nome: 'órfão com a marca do dono é adotado e o órfão sem marca, de outro usuário, helper ou zumbi é poupado',
    tabela: nova => [
      processo(nova, 2, NOVA_APP),
      processo(220, 1, '/usr/bin/orfao-do-nova', { dono: true }),
      processo(221, 1, '/usr/bin/orfao-alheio'),
      processo(222, 1, '/usr/bin/orfao-de-outro', { dono: true, uid: 0 }),
      processo(223, 1, `${HELPER} orfao`, { dono: true }),
      processo(224, 1, '/usr/bin/zumbi', { dono: true, estado: 'Z+' }),
    ],
    roteiro: coletarEEncerrar,
  },
  {
    nome: 'órfão já inspecionado com a mesma identidade não é inspecionado de novo',
    tabela: nova => [
      processo(nova, 2, NOVA_APP),
      processo(230, 1, '/usr/bin/orfao-alheio'),
    ],
    roteiro: async ({ limpeza }) => {
      limpeza.collect();
      limpeza.collect();
    },
  },
  {
    nome: 'órfão que reaproveitou o pid com outra identidade é inspecionado de novo',
    tabela: nova => [
      processo(nova, 2, NOVA_APP),
      processo(240, 1, '/usr/bin/primeiro'),
    ],
    roteiro: async ({ limpeza, ambiente }) => {
      limpeza.collect();
      ambiente.tabela[1] = processo(240, 1, '/usr/bin/segundo', { dono: true });
      await coletarEEncerrar({ limpeza });
    },
  },
  {
    nome: 'sem órfão novo a varredura não chama o ps de ambiente',
    tabela: nova => [processo(nova, 2, NOVA_APP)],
    roteiro: async ({ limpeza }) => { limpeza.collect(); },
  },
  {
    nome: 'falha do ps de ambiente é registrada com o código e os filhos ainda são coletados',
    tabela: nova => [
      processo(nova, 2, NOVA_APP),
      processo(250, nova, '/usr/bin/ffmpeg'),
      processo(251, 1, '/usr/bin/orfao', { dono: true }),
    ],
    roteiro: async ({ limpeza, ambiente }) => {
      ambiente.falhaDoEnv = { code: 'ETIMEDOUT' };
      await coletarEEncerrar({ limpeza });
    },
  },
  {
    nome: 'falha do ps de ambiente sem código registra o status',
    tabela: nova => [
      processo(nova, 2, NOVA_APP),
      processo(252, 1, '/usr/bin/orfao', { dono: true }),
    ],
    roteiro: async ({ limpeza, ambiente }) => {
      ambiente.falhaDoEnv = { status: 1 };
      limpeza.collect();
    },
  },
  {
    nome: 'dono que sumiu ou trocou de identidade deixa de ser sinalizado',
    tabela: nova => [
      processo(nova, 2, NOVA_APP),
      processo(260, nova, '/usr/bin/ffmpeg'),
      processo(261, nova, '/usr/bin/adb'),
    ],
    roteiro: async ({ limpeza, ambiente }) => {
      limpeza.collect();
      ambiente.tabela.splice(1, 1);
      ambiente.tabela[1] = processo(261, 2, '/usr/bin/outro-programa');
      await limpeza.terminate();
    },
  },
  {
    nome: 'processo que ignora o SIGTERM recebe SIGKILL e, se continua, é registrado',
    tabela: nova => [
      processo(nova, 2, NOVA_APP),
      processo(270, nova, '/usr/bin/teimoso', { imortal: true }),
      processo(271, nova, '/usr/bin/educado'),
    ],
    roteiro: coletarEEncerrar,
  },
  {
    nome: 'ESRCH é ignorado e outro erro do kill é registrado sem parar os demais',
    tabela: nova => [
      processo(nova, 2, NOVA_APP),
      processo(280, nova, '/usr/bin/negado', { recusa: true, imortal: true }),
      processo(281, nova, '/usr/bin/vai-embora', { fantasma: true }),
    ],
    roteiro: coletarEEncerrar,
  },
];

module.exports = { CENAS };
