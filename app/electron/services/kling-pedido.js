const { tamanhoDoArquivo } = require('./kling-arquivos');

const ESPERA_ENTRE_CONSULTAS_MS = 4000;
const PROMPT_PADRAO = 'Cinematic dynamic camera motion, high detail';

function esperarAProximaConsulta() {
    return new Promise(r => setTimeout(r, ESPERA_ENTRE_CONSULTAS_MS));
}

function textoDoPrompt(prompt, padrao) {
    return (prompt && String(prompt).trim()) || padrao;
}

function mensagemDoErro(erro) {
    return String(erro && erro.message || erro);
}

function resumoDoErro(erro, limite, semErro) {
    return erro ? String(erro.message || erro).slice(0, limite) : semErro;
}

async function primeiroModeloQueAceita(modelos, recusa, enviar) {
    let ultimoErro = null;
    for (const modelo of modelos) {
        try {
            await enviar(modelo);
            return { aceito: true, ultimoErro };
        } catch (e) {
            ultimoErro = e;
            if (!recusa.indisponivel.test(mensagemDoErro(e))) throw new Error(recusa.prefixo + mensagemDoErro(e));
        }
    }
    return { aceito: false, ultimoErro };
}

function lerPedido({
    imagePath,
    imageBase64,
    engine = '',
    prompt = PROMPT_PADRAO,
    duration = 5,
    aspectRatio = '16:9',
    motionPreset = 'zoom',
    apiKey = '',
    onProgress = () => {}
}) {
    return { imagePath, imageBase64, engine, prompt, duration, aspectRatio, motionPreset, apiKey, onProgress };
}

function duracaoOuCinco(duration) {
    return Number(duration) || 5;
}

function concluir(pedido) {
    pedido.onProgress({ step: 'complete', percent: 100, message: 'Geração de vídeo concluída!' });
}

function resultadoDoVideo(pedido, { duration, engine }) {
    return {
        success: true,
        videoPath: pedido.outFilePath,
        fileName: pedido.outFileName,
        sizeBytes: tamanhoDoArquivo(pedido.outFilePath),
        duration,
        engine,
        aspectRatio: pedido.aspectRatio
    };
}

function rotuloDoMotorLocal(pedido) {
    return pedido.apiKey ? 'Nova Motion Engine (Cloud fallback)' : 'Nova Motion Engine';
}

module.exports = { esperarAProximaConsulta, textoDoPrompt, mensagemDoErro, resumoDoErro, primeiroModeloQueAceita, lerPedido, duracaoOuCinco, concluir, resultadoDoVideo, rotuloDoMotorLocal };
