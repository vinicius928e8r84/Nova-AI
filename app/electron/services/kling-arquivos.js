const fs = require('fs');
const path = require('path');

const TAMANHO_MINIMO_DO_VIDEO = 1000;
const TIPO_POR_EXTENSAO = new Map([['.png', 'image/png'], ['.webp', 'image/webp']]);

function criarPasta(pasta) {
    try {
        fs.mkdirSync(pasta, { recursive: true });
        return true;
    } catch (e) {
        return false;
    }
}

function tamanhoDoArquivo(caminho) {
    return fs.existsSync(caminho) ? fs.statSync(caminho).size : 0;
}

function exigirVideoGravado(caminho, mensagem) {
    if (tamanhoDoArquivo(caminho) < TAMANHO_MINIMO_DO_VIDEO) throw new Error(mensagem);
}

function tipoDaImagem(caminho) {
    return TIPO_POR_EXTENSAO.get(path.extname(caminho).toLowerCase()) || 'image/jpeg';
}

function imagemEmDataUri(caminho) {
    return `data:${tipoDaImagem(caminho)};base64,${fs.readFileSync(caminho).toString('base64')}`;
}

function imagemExiste(caminho) {
    return Boolean(caminho) && fs.existsSync(caminho);
}

function apagarImagemTemporaria(imagem) {
    if (!imagem.temporaria || !fs.existsSync(imagem.caminho)) return;
    try { fs.unlinkSync(imagem.caminho); } catch (e) {}
}

module.exports = { criarPasta, tamanhoDoArquivo, exigirVideoGravado, tipoDaImagem, imagemEmDataUri, imagemExiste, apagarImagemTemporaria };
