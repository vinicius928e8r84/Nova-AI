'use strict';

const ipv4 = (address, internal = false) => ({ family: 'IPv4', internal, address });

const REDES_VARIADAS = {
  'Wi-Fi': [ipv4('192.168.0.10'), { family: 'IPv6', internal: false, address: 'fe80::1' }],
  Ethernet: [ipv4('10.0.0.5')],
  eth0: [ipv4('10.2.0.1')],
  'vEthernet (WSL)': [ipv4('172.20.0.1')],
  'VirtualBox Host-Only Network': [ipv4('192.168.56.1')],
  'Radmin VPN': [ipv4('10.5.0.2')],
  utun3: [ipv4('10.8.0.2')],
  en0: [ipv4('172.16.5.4'), ipv4('172.32.0.1'), ipv4('169.254.3.3'), ipv4('127.0.0.2')],
  lo: [ipv4('127.0.0.1', true)],
  docker0: [ipv4('172.17.0.1')],
  'Conexão estranha': [ipv4('8.8.8.8'), ipv4('10.5.1.1'), ipv4('172.')],
  wlan0: [ipv4('192.168.1.20')],
  'Ethernet (Hyper-V)': [ipv4('192.168.7.7'), ipv4('172.31.255.1'), ipv4('172.15.0.1')],
  'Familia numerica': [{ family: 4, internal: false, address: '192.168.9.9' }],
  'Nome Neutro': [ipv4('10.1.2.3'), ipv4('192.168.56.20'), ipv4('172.24.0.9')],
};

const REDE_DE_CASA = { 'Wi-Fi': [ipv4('192.168.0.10')] };

const devolveu = async (palco, rotulo, valor) => palco.anotar('retorno', rotulo, await valor);

const ligar = async (palco, servico, porta) => devolveu(palco, 'startServer', servico.startServer(porta));

function conectar(palco, nome, url, readyState) {
  const cliente = palco.cliente(nome, readyState);
  palco.wss.emit('connection', cliente, { url });
  return cliente;
}

const pedir = (palco, servico, req) => devolveu(palco, 'handleHttpRequest ' + req.url, servico.handleHttpRequest(req, palco.resposta()));

const CENAS_DE_REDE = [
  {
    nome: 'redes variadas: pontuação e ordem',
    cenario: { interfaces: REDES_VARIADAS },
    rodar: async palco => {
      const servico = palco.servico();
      await devolveu(palco, 'getAllIps', servico.getAllIps());
      await devolveu(palco, 'getLocalIp', servico.getLocalIp());
    },
  },
  {
    nome: 'sem rede: 127.0.0.1',
    cenario: { interfaces: { lo: [ipv4('127.0.0.1', true)], 'Wi-Fi': [ipv4('169.254.1.1')] } },
    rodar: async palco => {
      const servico = palco.servico();
      await devolveu(palco, 'getAllIps', servico.getAllIps());
      await devolveu(palco, 'getLocalIp', servico.getLocalIp());
    },
  },
  {
    nome: 'ip escolhido à mão',
    cenario: { interfaces: REDE_DE_CASA },
    rodar: async palco => {
      const servico = palco.servico();
      await devolveu(palco, 'setSelectedIp', servico.setSelectedIp('10.9.9.9'));
      await devolveu(palco, 'getLocalIp', servico.getLocalIp());
    },
  },
];

const CENAS_DE_SERVIDOR = [
  {
    nome: 'servidor https com redirecionamento http',
    cenario: { interfaces: REDE_DE_CASA },
    rodar: async palco => {
      const servico = palco.servico();
      await ligar(palco, servico);
      const redirecionador = palco.servidores.find(servidor => servidor.tipo === 'http');
      redirecionador.handler({ url: '/phone-cam?x=1' }, palco.resposta('redirecionado'));
      await ligar(palco, servico, 7000);
      await devolveu(palco, 'stopServer', servico.stopServer());
      await devolveu(palco, 'getStatus', servico.getStatus());
    },
  },
  {
    nome: 'servidor https em outra porta',
    cenario: { interfaces: REDE_DE_CASA },
    rodar: async palco => ligar(palco, palco.servico(), 9100),
  },
  {
    nome: 'sem selfsigned instalado: http',
    cenario: { interfaces: REDE_DE_CASA, selfsigned: 'ausente' },
    rodar: async palco => ligar(palco, palco.servico()),
  },
  {
    nome: 'selfsigned falha: http',
    cenario: { interfaces: REDE_DE_CASA, selfsigned: 'falha' },
    rodar: async palco => ligar(palco, palco.servico()),
  },
  {
    nome: 'selfsigned sem cert: http',
    cenario: { interfaces: REDE_DE_CASA, selfsigned: 'sem-cert' },
    rodar: async palco => ligar(palco, palco.servico()),
  },
  {
    nome: 'selfsigned devolve undefined: http',
    cenario: { interfaces: REDE_DE_CASA, selfsigned: 'vazio' },
    rodar: async palco => ligar(palco, palco.servico()),
  },
  {
    nome: 'porta ocupada',
    cenario: { interfaces: REDE_DE_CASA, falhaAoEscutar: 'https' },
    rodar: async palco => {
      const servico = palco.servico();
      await ligar(palco, servico).catch(erro => palco.anotar('rejeitou', erro.message));
      palco.anotar('isRunning', servico.isRunning);
      await ligar(palco, servico, 8899).catch(erro => palco.anotar('rejeitou de novo', erro.message));
    },
  },
  {
    nome: 'erro depois de ligar',
    cenario: { interfaces: REDE_DE_CASA },
    rodar: async palco => {
      const servico = palco.servico();
      await ligar(palco, servico);
      palco.servidores.find(servidor => servidor.tipo === 'https').emit('error', new Error('ECONNRESET'));
      palco.anotar('isRunning', servico.isRunning);
    },
  },
  {
    nome: 'parar servidor com clientes e falhas',
    cenario: { interfaces: REDE_DE_CASA },
    rodar: async palco => {
      const servico = palco.servico();
      await devolveu(palco, 'stopServer antes de ligar', servico.stopServer());
      await ligar(palco, servico);
      palco.wss.clients.add(palco.cliente('a'));
      palco.wss.clients.add(palco.cliente('b'));
      conectar(palco, 'r', '/?role=sender');
      await devolveu(palco, 'stopServer', servico.stopServer());
      await devolveu(palco, 'getStatus', servico.getStatus());
    },
  },
];

const CENAS_DE_CONEXAO = [
  {
    nome: 'celular manda a câmera',
    cenario: { interfaces: REDE_DE_CASA },
    rodar: async palco => {
      const servico = palco.servico();
      await ligar(palco, servico);
      const remetente = conectar(palco, 'remetente', '/?role=sender&x=1');
      remetente.emit('message', Buffer.from('data:image/jpeg;base64,AAAA'));
      palco.anotar('lastPhoneFrame', String(servico.lastPhoneFrame));
      palco.cenario.janelaDestruida = true;
      remetente.emit('message', Buffer.from('quadro2'));
      remetente.emit('close');
      palco.anotar('remetentes', servico.mobileStreamClients.size);
      palco.anotar('lastPhoneFrame', String(servico.lastPhoneFrame));
    },
  },
  {
    nome: 'celular assiste ao pc',
    cenario: { interfaces: REDE_DE_CASA },
    rodar: async palco => {
      const servico = palco.servico();
      await ligar(palco, servico);
      conectar(palco, 'sem-quadro', '/?role=viewer');
      servico.pushPcFrame('quadro-pc');
      conectar(palco, 'aberto', '/?role=viewer');
      const fechado = conectar(palco, 'fechado', '/?role=viewer', 3);
      fechado.emit('close');
      palco.anotar('espectadores', servico.mobileViewerClients.size);
    },
  },
  {
    nome: 'celular toca o vídeo spoof',
    cenario: { interfaces: REDE_DE_CASA },
    rodar: async palco => {
      const servico = palco.servico();
      await ligar(palco, servico);
      const spoof = conectar(palco, 'spoof', '/?role=spoof-viewer');
      for (const mensagem of ['{"type":"spoof-status-update","playing":true}', '{"type":"outro"}', '{"playing":false}', 'não é json', 'null']) {
        spoof.emit('message', Buffer.from(mensagem));
      }
      servico.setSpoofVideo('/videos/a.mp4', { nome: 'a' });
      conectar(palco, 'spoof-depois', '/?role=spoof-viewer');
      conectar(palco, 'spoof-fechado', '/?role=spoof-viewer', 0);
      spoof.emit('close');
      palco.anotar('spoof', servico.mobileSpoofClients.size);
    },
  },
  {
    nome: 'papéis desconhecidos e ordem dos papéis',
    cenario: { interfaces: REDE_DE_CASA, janelaDestruida: true },
    rodar: async palco => {
      const servico = palco.servico();
      await ligar(palco, servico);
      conectar(palco, 'nada', '/?role=outro');
      conectar(palco, 'sem-url', undefined);
      conectar(palco, 'dois', '/?role=viewer&role=sender');
      conectar(palco, 'spoof-e-viewer', '/?role=spoof-viewer&role=viewer');
      await devolveu(palco, 'getStatus', servico.getStatus());
    },
  },
];

const ROTAS_DE_PAGINA = ['/phone-cam', '/phone', '/pc-cam', '/pc', '/spoof-cam', '/spoof', '/mobile-spoof', '/', '/qualquer', '/phone-cam?x', '/constructor'];

const CENAS_HTTP = [
  {
    nome: 'páginas',
    rodar: async palco => {
      const servico = palco.servico();
      for (const url of ROTAS_DE_PAGINA) await pedir(palco, servico, { url });
      await devolveu(palco, 'sem url', servico.handleHttpRequest({}, palco.resposta()));
    },
  },
  {
    nome: 'vídeo sem spoof ativo',
    rodar: async palco => {
      const servico = palco.servico();
      await pedir(palco, servico, { url: '/api/spoof-video', headers: {} });
      servico.setSpoofVideo('/videos/sumiu.mp4');
      await pedir(palco, servico, { url: '/video/stream', headers: {} });
    },
  },
  {
    nome: 'vídeo inteiro e por trechos',
    cenario: { existentes: ['/videos/a.mp4'], tamanho: 1000 },
    rodar: async palco => {
      const servico = palco.servico();
      servico.setSpoofVideo('/videos/a.mp4', { nome: 'a' });
      const pedidos = [undefined, 'bytes=0-99', 'bytes=100-', 'bytes=abc-', 'bytes=5-0'];
      for (const range of pedidos) await pedir(palco, servico, { url: '/spoof-stream', headers: { range } });
      await pedir(palco, servico, { url: '/api/spoof-video?t=1', headers: { range: '' } });
    },
  },
  {
    nome: 'vídeo com erro ao ler',
    cenario: { existentes: ['/videos/a.mp4'], falhaNoStat: true },
    rodar: async palco => {
      const servico = palco.servico();
      servico.setSpoofVideo('/videos/a.mp4');
      await pedir(palco, servico, { url: '/api/spoof-video', headers: {} });
    },
  },
  {
    nome: 'vídeo sem cabeçalhos',
    cenario: { existentes: ['/videos/a.mp4'] },
    rodar: async palco => {
      const servico = palco.servico();
      servico.setSpoofVideo('/videos/a.mp4');
      await pedir(palco, servico, { url: '/api/spoof-video' });
    },
  },
];

const CENAS_ADB = [
  {
    nome: 'câmera do android pelo scrcpy do serviço',
    cenario: { existentes: ['/opt/scrcpy'] },
    rodar: async palco => {
      const servico = palco.servico({ scrcpyPath: '/opt/scrcpy' });
      await devolveu(palco, 'start padrão', servico.startAdbCameraStream('SER1'));
      await devolveu(palco, 'start repetido', servico.startAdbCameraStream('SER1'));
      await devolveu(palco, 'start frontal', servico.startAdbCameraStream('SER1', 'front', '1280x720', '30'));
      palco.processos[0].emit('close', 0);
      await devolveu(palco, 'stop frontal', servico.stopAdbCameraStream('SER1', 'front'));
      await devolveu(palco, 'stop inexistente', servico.stopAdbCameraStream('SER2'));
      palco.anotar('processos', [...servico.adbCameraProcesses.keys()]);
    },
  },
  {
    nome: 'kill que falha',
    cenario: { existentes: ['/opt/scrcpy'], falhaAoMatar: true },
    rodar: async palco => {
      const servico = palco.servico({ scrcpyPath: '/opt/scrcpy' });
      await servico.startAdbCameraStream('SER1');
      await devolveu(palco, 'stop', servico.stopAdbCameraStream('SER1'));
      palco.anotar('processos', servico.adbCameraProcesses.size);
    },
  },
  ...[
    ['darwin', '<app>/resources/bin/scrcpy'],
    ['win32', '<app>/resources/scrcpy/scrcpy.exe'],
    ['linux', '<app>/resources/scrcpy/scrcpy.exe'],
    ['darwin', '<app>/resources/scrcpy/scrcpy.exe'],
    ['win32', '<app>/resources/bin/scrcpy'],
  ].map(([plataforma, existente]) => ({
    nome: 'scrcpy embutido em ' + plataforma + ' com ' + existente,
    cenario: { plataforma, existentes: [existente] },
    rodar: async palco => {
      await devolveu(palco, 'sem serviço', palco.servico().startAdbCameraStream('A'));
      await devolveu(palco, 'serviço sem caminho', palco.servico({ scrcpyPath: '' }).startAdbCameraStream('B', 'front'));
    },
  })),
];

const CENAS_DE_SPOOF = [
  {
    nome: 'comandos para os celulares do spoof',
    cenario: { interfaces: REDE_DE_CASA },
    rodar: async palco => {
      const servico = palco.servico();
      servico.broadcastSpoofCommand({ type: 'play' });
      await ligar(palco, servico);
      conectar(palco, 'aberto', '/?role=spoof-viewer');
      conectar(palco, 'fechado', '/?role=spoof-viewer', 2);
      conectar(palco, 'quebrado', '/?role=spoof-viewer').falharNoEnvio = true;
      servico.broadcastSpoofCommand('{"type":"pause"}');
      servico.broadcastSpoofCommand({ type: 'speed', speed: 2 });
      await devolveu(palco, 'setSpoofVideo', servico.setSpoofVideo('/v.mp4'));
      await devolveu(palco, 'setSpoofVideo vazio', servico.setSpoofVideo(null, { motivo: 'limpar' }));
    },
  },
  {
    nome: 'quadros do pc',
    cenario: { interfaces: REDE_DE_CASA },
    rodar: async palco => {
      const servico = palco.servico();
      servico.pushPcFrame('q1');
      await ligar(palco, servico);
      conectar(palco, 'aberto', '/?role=viewer');
      conectar(palco, 'fechado', '/?role=viewer', 3);
      conectar(palco, 'quebrado', '/?role=viewer').falharNoEnvio = true;
      servico.pushPcFrame('q2');
    },
  },
  {
    nome: 'status com túnel e qr quebrado',
    cenario: { interfaces: REDE_DE_CASA, falhaNoQr: true },
    rodar: async palco => {
      const servico = palco.servico();
      servico.httpsUrl = 'https://tunel.exemplo';
      await devolveu(palco, 'getStatus', servico.getStatus());
    },
  },
  {
    nome: 'status com túnel',
    cenario: { interfaces: REDE_DE_CASA },
    rodar: async palco => {
      const servico = palco.servico();
      servico.httpsUrl = 'https://tunel.exemplo';
      await devolveu(palco, 'getStatus', servico.getStatus());
    },
  },
];

module.exports = [...CENAS_DE_REDE, ...CENAS_DE_SERVIDOR, ...CENAS_DE_CONEXAO, ...CENAS_HTTP, ...CENAS_ADB, ...CENAS_DE_SPOOF];
