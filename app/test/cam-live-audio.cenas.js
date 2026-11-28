'use strict';

const PICO_MESTRE = 'analisador#1';
const PICO_DO_PRIMEIRO_CANAL = 'analisador#2';

const ligar = (a, id = 'a') => a.api().attach(id, a.midia(`el-${id}`));
const bloco = (frames, esquerda, direita = esquerda) => ({ data: [new Float32Array(frames).fill(esquerda), new Float32Array(frames).fill(direita)] });
const enviar = (a, ...blocos) => blocos.forEach((item) => a.nosDoWorklet()[0].port.onmessage(item));
const blocosCheios = (a, quantidade, esquerda = 0.5, direita = 0.25) => enviar(a, ...Array.from({ length: quantidade }, () => bloco(128, esquerda, direita)));

const AMOSTRAS_DO_PCM = [0, 128, 256, 384, 512, 640, 768, 896];

function amostrasDoPcm(pcm) {
  const vista = new Int16Array(pcm.data.buffer, pcm.data.byteOffset, pcm.data.length / 2);
  return AMOSTRAS_DO_PCM.map((indice) => vista[indice]);
}

const ouvintes = (a) => ({
  onPacket: (pacote) => a.anotar('cb.onPacket', [pacote]),
  onAsc: (asc) => a.anotar('cb.onAsc', [asc]),
  onError: (mensagem) => a.anotar('cb.onError', [mensagem]),
  onPcm: (pcm) => a.anotar('cb.onPcm', [{ amostras: amostrasDoPcm(pcm), sampleRate: pcm.sampleRate }]),
});

const iniciar = (a, opcoes = {}) => a.api().startCapture({ ...ouvintes(a), ...opcoes });

function saidaDoCodificador(a, bytes, timestamp, asc) {
  const pedaco = { byteLength: bytes.length, timestamp, copyTo: (destino) => destino.set(bytes) };
  a.codificadores()[0].inicial.output(pedaco, asc ? { decoderConfig: { description: asc } } : {});
}

const aguardar = async (promessa, a, ms) => {
  await a.avancar(ms);
  return promessa;
};

const cenaDeCaptura = (nome, propriedades, roteiro) => ({ nome, ...propriedades, roteiro });

module.exports = [
  { nome: 'attach cria o contexto de 48 kHz e liga a cadeia do canal com os parâmetros padrão', roteiro: async (a) => [ligar(a), a.contextos().length] },
  { nome: 'attach sem id, com id nulo ou sem elemento devolve falso e não cria o contexto', roteiro: async (a) => [a.api().attach(undefined, a.midia('x')), a.api().attach(null, a.midia('x')), a.api().attach('a', null), a.contextos().length] },
  { nome: 'attach do mesmo elemento no mesmo canal devolve verdadeiro sem religar', roteiro: async (a) => [ligar(a), ligar(a), a.contextos().length] },
  { nome: 'attach de outro elemento no mesmo canal desliga o anterior', roteiro: async (a) => [ligar(a), a.api().attach('a', a.midia('outro'))] },
  { nome: 'a mesma mídia em outro canal reaproveita a fonte', roteiro: async (a) => [ligar(a, 'a'), a.api().detach('a'), a.api().attach('b', a.midia('el-a'))] },
  { nome: 'o canal numérico vira texto', roteiro: async (a) => [a.api().attach(7, a.midia('sete')), a.api().levels()] },
  { nome: 'attach sem Web Audio avisa e devolve falso', semAudioContext: true, roteiro: async (a) => ligar(a) },
  { nome: 'attach usa o webkitAudioContext quando não há o AudioContext', semAudioContext: true, comWebkit: true, roteiro: async (a) => ligar(a) },
  { nome: 'attach com a fonte recusada avisa e devolve falso', fonteFalha: true, roteiro: async (a) => ligar(a) },
  { nome: 'o contexto fechado é recriado no attach seguinte', roteiro: async (a) => { ligar(a, 'a'); a.contextos()[0].state = 'closed'; return [ligar(a, 'b'), a.contextos().length]; } },
  { nome: 'sem setTargetAtTime o ganho vai direto no valor', alvoFalha: true, roteiro: async (a) => { a.api().setParams('a', { volume: 0.4, monitor: true }); return ligar(a); } },
  { nome: 'o parâmetro enviado antes do attach vale quando o canal liga', roteiro: async (a) => { a.api().setParams('a', { volume: 0.3, muted: true, monitor: true }); return ligar(a); } },
  { nome: 'o parâmetro muda o canal ligado, mantendo o que não veio', roteiro: async (a) => { ligar(a); a.api().setParams('a', { volume: 0.5 }); a.api().setParams('a', { muted: true }); a.api().setParams('a', { visible: false, monitor: 1 }); return a.api().setParams('a', null); } },
  { nome: 'o volume fora da faixa ou inválido é limitado', roteiro: async (a) => { for (const volume of [5, -2, NaN, Infinity, '0.5', 0]) a.api().setParams('a', { volume }); return ligar(a); } },
  { nome: 'os valores de verdadeiro ou falso são convertidos', roteiro: async (a) => { a.api().setParams('a', { muted: 'sim', visible: 0, monitor: '' }); return ligar(a); } },
  { nome: 'o detach desliga o canal e esquece o que estava pendente', roteiro: async (a) => { ligar(a); a.api().setParams('b', { volume: 0.2 }); a.api().detach('a'); a.api().detach('b'); a.api().detach('nunca'); return ligar(a, 'b'); } },
  { nome: 'o detach engole o erro de desconectar', desconectarFalha: true, roteiro: async (a) => { ligar(a); return a.api().detach('a'); } },
  { nome: 'o levels sem contexto devolve o piso', roteiro: async (a) => a.api().levels() },
  { nome: 'o levels mede o mestre e cada canal em decibéis, com piso', picos: { [PICO_MESTRE]: 0.5, [PICO_DO_PRIMEIRO_CANAL]: -0.25, 'analisador#3': 0 }, roteiro: async (a) => { ligar(a, 'a'); ligar(a, 'b'); return a.api().levels(); } },
  { nome: 'o pico minúsculo cai no piso de cem decibéis negativos', picos: { [PICO_MESTRE]: 1e-9 }, roteiro: async (a) => { ligar(a); return a.api().levels(); } },
  { nome: 'o levels com o contexto fechado devolve o piso', roteiro: async (a) => { ligar(a); a.contextos()[0].state = 'closed'; return a.api().levels(); } },
  { nome: 'o levels que falha no meio devolve o que já mediu', picos: { [PICO_MESTRE]: 0.5, [PICO_DO_PRIMEIRO_CANAL]: 'lanca' }, roteiro: async (a) => { ligar(a); return a.api().levels(); } },
  { nome: 'o resume sem contexto devolve falso', roteiro: async (a) => a.api().resume() },
  { nome: 'o resume de contexto suspenso retoma e devolve verdadeiro', estadoDoContexto: 'suspended', roteiro: async (a) => { ligar(a); return a.api().resume(); } },
  { nome: 'o resume que recusa devolve falso', estadoDoContexto: 'suspended', retomaFalha: true, roteiro: async (a) => { ligar(a); return a.api().resume(); } },
  { nome: 'o resume de contexto rodando devolve verdadeiro sem retomar', roteiro: async (a) => { ligar(a); return a.api().resume(); } },
  { nome: 'o resume de contexto fechado devolve falso', roteiro: async (a) => { ligar(a); a.contextos()[0].state = 'closed'; return a.api().resume(); } },
  { nome: 'o supported devolve verdadeiro e lembra a resposta', roteiro: async (a) => [await a.api().supported(), await a.api().supported()] },
  { nome: 'o supported sem AudioEncoder devolve falso', semGlobais: ['AudioEncoder'], roteiro: async (a) => a.api().supported() },
  { nome: 'o supported sem AudioData devolve falso', semGlobais: ['AudioData'], roteiro: async (a) => a.api().supported() },
  { nome: 'o supported sem AudioWorkletNode devolve falso', semGlobais: ['AudioWorkletNode'], roteiro: async (a) => a.api().supported() },
  { nome: 'o supported com a configuração recusada devolve falso', suporte: { supported: false }, roteiro: async (a) => a.api().supported() },
  { nome: 'o supported com resposta vazia devolve falso', suporte: null, roteiro: async (a) => a.api().supported() },
  { nome: 'o supported que lança devolve falso', suporteLanca: true, roteiro: async (a) => a.api().supported() },
  { nome: 'a captura em andamento recusa uma segunda', roteiro: async (a) => [await iniciar(a), await iniciar(a)] },
  { nome: 'a captura AAC sem suporte devolve o erro do Electron', suporte: { supported: false }, roteiro: async (a) => iniciar(a) },
  { nome: 'a captura sem onPacket pede o callback', roteiro: async (a) => a.api().startCapture({}) },
  { nome: 'a captura sem opções pede o callback', roteiro: async (a) => a.api().startCapture() },
  { nome: 'a captura de PCM bruto sem onPcm pede o callback', roteiro: async (a) => a.api().startCapture({ rawPcm: true, onPacket: () => {} }) },
  { nome: 'o contexto que não retoma em um segundo e meio bloqueia a captura', estadoDoContexto: 'suspended', retomaNunca: true, roteiro: async (a) => aguardar(iniciar(a), a, 1500) },
  { nome: 'o contexto suspenso que retoma deixa a captura seguir', estadoDoContexto: 'suspended', roteiro: async (a) => iniciar(a) },
  { nome: 'o contexto suspenso cuja retomada falha continua bloqueado', estadoDoContexto: 'suspended', retomaFalha: true, roteiro: async (a) => iniciar(a) },
  cenaDeCaptura('a captura AAC liga o worklet ao mestre e configura o codificador com a taxa pedida', {}, async (a) => [await iniciar(a, { bitrateKbps: 96, t0Ms: 250 }), a.nosDoWorklet().length]),
  cenaDeCaptura('a taxa inválida ou o tempo inicial inválido usam os padrões', {}, async (a) => iniciar(a, { bitrateKbps: -5, t0Ms: 'x' })),
  cenaDeCaptura('o módulo do worklet recusado desfaz a captura e devolve o erro', { moduloFalha: true }, async (a) => [await iniciar(a), await a.api().stopCapture()]),
  cenaDeCaptura('a captura de PCM bruto não cria o codificador', {}, async (a) => [await iniciar(a, { rawPcm: true }), a.codificadores().length]),
  cenaDeCaptura('oito blocos do worklet completam um bloco e vão ao codificador com o tempo certo', {}, async (a) => { a.relogio(5000); await iniciar(a, { t0Ms: 1000 }); blocosCheios(a, 8); blocosCheios(a, 8); return a.api().stopCapture(); }),
  cenaDeCaptura('blocos de tamanho irregular atravessam o limite do bloco', {}, async (a) => { await iniciar(a); enviar(a, bloco(700, 0.1), bloco(700, 0.2), bloco(700, 0.3)); return a.api().stopCapture(); }),
  cenaDeCaptura('a parada codifica o que sobrou do bloco, preenchido com silêncio', {}, async (a) => { await iniciar(a); blocosCheios(a, 3); return a.api().stopCapture(); }),
  cenaDeCaptura('os pacotes do codificador viram onAsc uma vez e onPacket sempre, e a parada conta', {}, async (a) => { await iniciar(a); saidaDoCodificador(a, new Uint8Array([1, 2, 3]), 10, new Uint8Array([9, 9])); saidaDoCodificador(a, new Uint8Array([4, 5]), 20, new Uint8Array([8])); return a.api().stopCapture(); }),
  cenaDeCaptura('o pacote sem descrição não chama onAsc', {}, async (a) => { await iniciar(a); saidaDoCodificador(a, new Uint8Array([7]), 5); return a.api().stopCapture(); }),
  cenaDeCaptura('o onPacket que lança conta como falha do áudio', {}, async (a) => { await iniciar(a, { onPacket: () => { throw new Error('consumidor quebrou'); } }); saidaDoCodificador(a, new Uint8Array([1]), 5); saidaDoCodificador(a, new Uint8Array([2]), 6); return a.api().stopCapture(); }),
  cenaDeCaptura('o erro do codificador avisa uma vez e a parada devolve o erro', {}, async (a) => { await iniciar(a); a.codificadores()[0].inicial.error(new Error('codec caiu')); a.codificadores()[0].inicial.error('outra'); blocosCheios(a, 8); return a.api().stopCapture(); }),
  cenaDeCaptura('o erro do processador do worklet vira falha do áudio', {}, async (a) => { await iniciar(a); a.nosDoWorklet()[0].onprocessorerror(); return a.api().stopCapture(); }),
  cenaDeCaptura('o encode que lança vira falha e os blocos seguintes são ignorados', { encodeFalha: true }, async (a) => { await iniciar(a); blocosCheios(a, 8); blocosCheios(a, 8); return a.api().stopCapture(); }),
  cenaDeCaptura('o codificador fechado ignora os blocos', {}, async (a) => { await iniciar(a); a.codificadores()[0].state = 'closed'; blocosCheios(a, 8); return a.api().stopCapture(); }),
  cenaDeCaptura('o PCM bruto manda inteiros de 16 bits da média dos canais, limitados', {}, async (a) => { await iniciar(a, { rawPcm: true }); enviar(a, bloco(128, 1, 1), bloco(128, 3, 1), bloco(128, -1, -1), bloco(128, -3, -1), bloco(128, 0.5, -0.25), bloco(128, 0, 0), bloco(128, 0.1, 0.2), bloco(128, 0.3, 0.3)); return a.api().stopCapture(); }),
  cenaDeCaptura('a parada do PCM bruto não codifica o resto', {}, async (a) => { await iniciar(a, { rawPcm: true }); blocosCheios(a, 3); return a.api().stopCapture(); }),
  cenaDeCaptura('dois canais iguais em PCM bruto dão a mesma amostra nos oito blocos', {}, async (a) => { await iniciar(a, { rawPcm: true }); enviar(a, ...Array.from({ length: 8 }, () => bloco(128, 0.5))); return a.api().stopCapture(); }),
  cenaDeCaptura('a parada engole as falhas do flush e do fechamento', { flushFalha: true, fecharFalha: true }, async (a) => { await iniciar(a); blocosCheios(a, 2); return a.api().stopCapture(); }),
  cenaDeCaptura('a parada sem captura devolve verdadeiro', {}, async (a) => a.api().stopCapture()),
  cenaDeCaptura('a captura pode recomeçar depois da parada', {}, async (a) => [await iniciar(a), await a.api().stopCapture(), await iniciar(a), a.nosDoWorklet().length]),
  cenaDeCaptura('o contexto recriado depois de fechado carrega o worklet de novo', {}, async (a) => { ligar(a); await iniciar(a); await a.api().stopCapture(); a.contextos()[0].state = 'closed'; const nova = ligar(a, 'b'); return [nova, await iniciar(a), a.contextos().length]; }),
  cenaDeCaptura('o worklet já carregado no mesmo contexto não é carregado de novo', {}, async (a) => [await iniciar(a), await a.api().stopCapture(), await iniciar(a)]),
];
