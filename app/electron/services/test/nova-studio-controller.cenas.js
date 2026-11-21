'use strict';
const { chamar } = require('./nova-studio-controller.palco');

const MOTOR_LOGADO = { logado: true, modelo: 'gemini-da-conta' };
const IMAGEM = 'data:image/png;base64,QUJD';
const HISTORICO = [
  { role: 'user', parts: [{ text: 'primeira pergunta' }] },
  { role: 'model', parts: [{ text: 'primeira resposta' }] },
  { role: 'assistant', parts: [] },
  { role: 'user', parts: 'sem lista' },
  { role: 'user' },
];
const JSON_DE_EDICAO = 'ok {"intent":"document_edit","positive":"um cartão verde","confirmation_text":"Feito, chefe.","target_text":"A","replacement_text":"B"} fim';
const IMAGEM_GERADA = { generatedImages: [{ imageBinary: Buffer.from('png-gerado') }] };

const editar = (pedido) => (studio, roteiro) => chamar(roteiro, 'executeEdit', () => studio.executeEdit(pedido));

function cena(nome, montagem, passos) {
  return { nome, ...montagem, passos };
}

const CENAS_DA_CONTA = [
  cena('conta: sem login', { tokens: ['chave'], motor: { logado: false } },
    editar({ image: IMAGEM, command: 'leia', mode: 'm', accountMode: true })),
  cena('conta: chat sem imagem com histórico e modelo do motor', { tokens: ['chave'], motor: { ...MOTOR_LOGADO, respostas: [{ success: true, text: 'olá!', model: 'm1' }] } },
    editar({ command: 'oi', mode: 'chat', history: HISTORICO, accountMode: true })),
  cena('conta: imagem com pedido de texto copia para a área de transferência', { tokens: ['chave'], motor: { ...MOTOR_LOGADO, respostas: [{ success: true, text: 'TEXTO LIDO', model: 'm2' }] } },
    editar({ image: IMAGEM, command: 'Extract the TEXT please', mode: 'ocr', accountMode: true, selectedModel: 'escolhido' })),
  cena('conta: imagem sem palavra de texto não copia', { tokens: ['chave'], motor: { ...MOTOR_LOGADO, respostas: [{ success: true, text: 'um gato', model: 'm3' }] } },
    editar({ image: IMAGEM, command: 'describe', accountMode: true })),
  cena('conta: imagem sem comando usa o prompt de análise', { tokens: ['chave'], motor: { ...MOTOR_LOGADO, respostas: [{ success: true, text: 'análise', model: 'm4' }] } },
    editar({ image: IMAGEM, command: '', accountMode: true })),
  cena('conta: sem imagem e sem comando manda Hello', { tokens: ['chave'], motor: { ...MOTOR_LOGADO, respostas: [{ success: true, text: 'oi', model: 'm5' }] } },
    editar({ accountMode: true })),
  cena('conta: erro do motor cai na chave (sem chave)', { tokens: ['chave', null], motor: { ...MOTOR_LOGADO, respostas: [{ success: false, error: 'COTA' }] } },
    editar({ command: 'oi', accountMode: true })),
  cena('conta: exceção do motor cai na chave', { tokens: [null, '  chave  '], motor: { ...MOTOR_LOGADO, respostas: [new Error('navegador fechou')] }, chat: ['{"intent":"question"}', 'resposta da chave'] },
    editar({ command: 'oi', accountMode: true })),
  cena('conta: histórico inválido cai na chave', { tokens: ['chave', 'chave'], motor: MOTOR_LOGADO, chat: ['{"intent":"question"}', 'r'] },
    editar({ command: 'oi', history: [null], accountMode: true })),
  cena('conta: falha da área de transferência cai na chave', { tokens: ['chave', 'chave'], falhaDoClipboard: 'sem área', motor: { ...MOTOR_LOGADO, respostas: [{ success: true, text: 'T', model: 'm' }] }, chat: ['nada', '{}'], imagens: [IMAGEM_GERADA] },
    editar({ image: 'QUJD', command: 'copy', accountMode: true })),
  cena('conta: sem motor carregado vai direto para a chave', { tokens: ['chave', null] },
    editar({ command: 'oi', accountMode: true })),
  cena('conta desligada com motor logado vai para a chave', { tokens: ['chave', null], motor: MOTOR_LOGADO },
    editar({ command: 'oi' })),
];

const CENAS_DA_CHAVE = [
  cena('chave: ocr copia e devolve intent ocr', { tokens: ['chave', ' k '], chat: ['```json {"intent":"ocr_extraction"} ```', 'Achei: 123'] },
    editar({ image: IMAGEM, command: 'copie o RG', mode: 'doc', history: HISTORICO })),
  cena('chave: pergunta devolve chat', { tokens: ['chave', 'k'], chat: ['{"intent":"question"}', 'É um gato.'] },
    editar({ image: 'QUJD', command: 'o que é?' })),
  cena('chave: pergunta sem imagem', { tokens: ['chave', 'k'], chat: ['{"intent":"question"}', 'Resposta.'] },
    editar({ command: 'tudo bem?' })),
  cena('chave: sem JSON vira edição de imagem', { tokens: ['chave', 'k'], chat: ['não sei', JSON_DE_EDICAO], imagens: [IMAGEM_GERADA] },
    editar({ image: IMAGEM, command: 'troque o nome', mode: 'documento' })),
  cena('chave: edição sem JSON usa o padrão', { tokens: ['chave', 'k'], chat: ['{"intent":"image_edit"}', 'sem json'], imagens: [IMAGEM_GERADA] },
    editar({ image: IMAGEM, command: 'deixe azul', mode: 'arte' })),
  cena('chave: intenção desconhecida ou herdada vira edição', { tokens: ['chave', 'k', 'k'], chat: ['{"intent":"constructor"}', JSON_DE_EDICAO, '{"intent":"toString"}', JSON_DE_EDICAO], imagens: [IMAGEM_GERADA, IMAGEM_GERADA] },
    async (studio, roteiro) => {
      await editar({ command: 'a', mode: 'x' })(studio, roteiro);
      await editar({ command: 'b', mode: 'y' })(studio, roteiro);
    }),
  cena('chave: Imagen vazio dá o aviso de regeneração', { tokens: ['chave', 'k'], chat: ['{}', JSON_DE_EDICAO], imagens: [{ generatedImages: [] }] },
    editar({ command: 'edite' })),
  cena('chave: Imagen lança', { tokens: ['chave', 'k'], chat: ['{}', JSON_DE_EDICAO], imagens: [new Error('cota do imagen')] },
    editar({ command: 'edite' })),
  cena('chave: Imagen sem cliente cria um com o token da hora', { tokens: [null, 'k', 'token-novo'], chat: ['{}', JSON_DE_EDICAO], imagens: [{}] },
    editar({ command: 'edite' })),
  cena('chave: 404 no chat', { tokens: ['chave', 'k'], chat: [new Error('[404] models/x')] },
    editar({ command: 'oi' })),
  cena('chave: not found no chat', { tokens: ['chave', 'k'], chat: [new Error('model not found')] },
    editar({ command: 'oi' })),
  cena('chave: erro sem mensagem', { tokens: ['chave', 'k'], chat: [new Error('')] },
    editar({ command: 'oi' })),
  cena('chave: JSON quebrado na classificação', { tokens: ['chave', 'k'], chat: ['{intent: ocr}'] },
    editar({ command: 'oi' })),
  cena('chave: rejeição que não é Error', { tokens: ['chave', 'k'], chat: [{ texto: 'objeto' }] },
    async (studio, roteiro) => {
      studio.classifyIntent = () => Promise.reject('texto solto');
      await editar({ command: 'oi' })(studio, roteiro);
    }),
  cena('chave: token que não é texto', { tokens: ['chave', 42] },
    editar({ command: 'oi' })),
];

const CENAS_DE_ENTRADA = [
  cena('pedido indefinido lança', { tokens: ['chave'] },
    (studio, roteiro) => chamar(roteiro, 'executeEdit', () => studio.executeEdit())),
  cena('histórico nulo lança no log', { tokens: ['chave'] },
    editar({ command: 'oi', history: null })),
  cena('base64ToGenerativePart com e sem vírgula, vazio e número', { tokens: [null] },
    async (studio, roteiro) => {
      for (const entrada of [IMAGEM, 'QUJD', '', null, 'a,b,c']) roteiro.anotar('parte', studio.base64ToGenerativePart(entrada));
      roteiro.anotar('parte jpeg', studio.base64ToGenerativePart('x,y', 'image/jpeg'));
      roteiro.anotar('parte número', studio.base64ToGenerativePart(7));
    }),
  cena('Stable Diffusion aposentado, harmonize e diagnóstico', { tokens: ['chave'] },
    async (studio, roteiro, NovaStudioController) => {
      await chamar(roteiro, 'callStableDiffusion', () => studio.callStableDiffusion('img', {}, 'm'));
      await chamar(roteiro, 'harmonizeEdit', () => studio.harmonizeEdit('img', 'm'));
      roteiro.anotar('diagnosticListModels', NovaStudioController.diagnosticListModels());
      roteiro.anotar('janela', studio.mainWindow);
    }),
];

module.exports = { CENAS: [...CENAS_DA_CONTA, ...CENAS_DA_CHAVE, ...CENAS_DE_ENTRADA] };
