'use strict';

const ASSINATURA_DO_ROBO = '[NOVA_AI_BOT]';
const MARCAS_DO_ROBO = [ASSINATURA_DO_ROBO, '🤖', '\u200B'];
const TIPOS_DE_VOZ = ['ptt', 'audio'];
const PALAVRAS_URGENTES_NO_GRUPO = ['payment', 'meeting', 'urgent', 'emergency', 'jaldi', 'zaroori', 'paisa'];
const PALAVRAS_URGENTES_DO_CONTATO = ['urgent', 'emergency', 'call me', 'jaldi', 'zaroori'];
const LIMITE_DO_RESUMO_DA_NOTIFICACAO = 50;

const ehIdDeGrupo = id => id.includes('@g.us');

function ehMensagemDeVoz(msg) {
    return Boolean(msg.hasMedia) && TIPOS_DE_VOZ.includes(msg.type);
}

const textoDaMensagem = msg => String(msg.body || '').trim();

function descreverMensagem(msg) {
    const fromId = msg.from || '';
    const toId = msg.to || '';
    return {
        body: textoDaMensagem(msg),
        fromId,
        toId,
        ehGrupo: [fromId, toId].some(ehIdDeGrupo),
        conversaComigo: msg.from === msg.to,
        targetId: msg.fromMe ? toId : fromId,
        messageId: msg.id?._serialized,
        fromMe: msg.fromMe,
        timestamp: msg.timestamp
    };
}

function dadosDaMensagemRecebida(msg, mensagem, nomeDoDono) {
    return {
        message:    mensagem.body,
        chatId:     mensagem.targetId,
        fromMe:     msg.fromMe === true,
        isSelfChat: mensagem.conversaComigo,
        bossName:   nomeDoDono,
        timestamp:  msg.timestamp,
        messageId:  mensagem.messageId || `msg-${Date.now()}`
    };
}

function textoDaTranscricao(resposta) {
    return String(resposta?.data?.text || '').trim() || null;
}

function motivoDaFalhaNaTranscricao(error) {
    return error?.response?.data || error.message || error;
}

function mensagemDoErro(error) {
    return String(error?.message || error || '');
}

function ehEcoDoRobo(body) {
    return MARCAS_DO_ROBO.some(marca => body.includes(marca));
}

function deveDescartar({ body, fromMe, conversaComigo }) {
    if (ehEcoDoRobo(body)) return true;
    if (fromMe && !conversaComigo) return true;
    return !body;
}

function motivoDoAlertaDeGrupo(body, nomeDoDono) {
    const texto = body.toLowerCase();
    if (texto.includes(nomeDoDono.toLowerCase())) return 'MENTION';
    return PALAVRAS_URGENTES_NO_GRUPO.some(palavra => texto.includes(palavra)) ? 'URGENT_KEYWORD' : null;
}

function ehUrgenteParaContato(body) {
    const texto = body.toLowerCase();
    return PALAVRAS_URGENTES_DO_CONTATO.some(palavra => texto.includes(palavra));
}

function nomeDoRemetente(contato, chat) {
    return contato?.name || contato?.pushname || chat.name || 'Someone';
}

function resumoDaNotificacao(body) {
    if (body.length <= LIMITE_DO_RESUMO_DA_NOTIFICACAO) return body;
    return `${body.substring(0, LIMITE_DO_RESUMO_DA_NOTIFICACAO)}...`;
}

function duracaoDaDigitacao(texto) {
    return Math.min(Math.max(texto.length * 20, 1000), 4000);
}

function envioInvalido(chatId, texto) {
    if (!chatId || chatId === 'self') return true;
    return !texto;
}

function comAssinatura(texto, semAssinatura) {
    return semAssinatura ? texto : `${texto}\n\n_${ASSINATURA_DO_ROBO}_`;
}

module.exports = {
    ASSINATURA_DO_ROBO,
    ehMensagemDeVoz,
    descreverMensagem,
    dadosDaMensagemRecebida,
    textoDaTranscricao,
    motivoDaFalhaNaTranscricao,
    mensagemDoErro,
    deveDescartar,
    motivoDoAlertaDeGrupo,
    ehUrgenteParaContato,
    nomeDoRemetente,
    resumoDaNotificacao,
    duracaoDaDigitacao,
    envioInvalido,
    comAssinatura
};
