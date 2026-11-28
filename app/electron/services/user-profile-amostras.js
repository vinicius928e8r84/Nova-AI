const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const LIMITE_DE_CONVERSAS = 5;
const LIMITE_DE_ATIVIDADES = 100;
const LIMITE_DO_HTML = 300;
const LIMITE_DO_TEXTO = 50000;
const ENTIDADES_DO_HTML = [
    [/&quot;/g, '"'],
    [/&amp;/g, '&'],
    [/&lt;/g, '<'],
    [/&gt;/g, '>'],
    [/&nbsp;/g, ' '],
];

const stripHtml = (html) => {
    const semTags = (html || '').replace(/<[^>]+>/g, ' ');
    return ENTIDADES_DO_HTML
        .reduce((texto, [entidade, troca]) => texto.replace(entidade, troca), semTags)
        .replace(/\s+/g, ' ')
        .trim();
};

const textoDaMensagem = (mensagem) => `${mensagem.role === 'user' ? 'User' : 'NOVA'}: ${mensagem.text}`;

function amostraDaConversa(conversa) {
    const mensagens = conversa.messages || [];
    return `--- RECENT CHAT ---\n${mensagens.map(textoDaMensagem).join('\n')}\n`;
}

const amostrasDasConversas = (conversas) => (Array.isArray(conversas)
    ? conversas.slice(0, LIMITE_DE_CONVERSAS).map(amostraDaConversa)
    : []);

function caminhoDoCofre() {
    const doExecutavel = path.join(path.dirname(app.getPath('exe')), 'Nova_Vault', 'MyActivity.json');
    const alternativo = path.join(__dirname, '..', '..', 'Nova_Vault', 'MyActivity.json');
    return [doExecutavel, alternativo].find((caminho) => fs.existsSync(caminho)) || null;
}

function amostraDaAtividade(atividade) {
    const titulo = atividade.title || '';
    const html = (atividade.safeHtmlItem || []).map((item) => stripHtml(item.html)).join(' ');
    if (html.length === 0 && titulo.length === 0) return null;
    return `--- VAULT MEMORY ---\n${titulo}\n${html.substring(0, LIMITE_DO_HTML)}`;
}

function juntarAmostrasDoCofre(amostras, caminho) {
    try {
        const atividades = JSON.parse(fs.readFileSync(caminho, 'utf8'));
        for (const atividade of atividades.slice(0, LIMITE_DE_ATIVIDADES)) {
            const amostra = amostraDaAtividade(atividade);
            if (amostra) amostras.push(amostra);
        }
    } catch (e) {
        console.error('[UserProfileManager] Failed to read MyActivity.json', e);
    }
}

function reunirAmostras(conversas = []) {
    const amostras = amostrasDasConversas(conversas);
    const cofre = caminhoDoCofre();
    if (cofre) juntarAmostrasDoCofre(amostras, cofre);

    const combinado = amostras.join('\n\n');
    return combinado.length > LIMITE_DO_TEXTO ? combinado.substring(0, LIMITE_DO_TEXTO) : combinado;
}

module.exports = { reunirAmostras };
