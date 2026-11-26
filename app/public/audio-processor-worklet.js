const amostraParaInt16 = amostra => {
    const limitada = Math.max(-1, Math.min(1, amostra));
    return limitada < 0 ? limitada * 0x8000 : limitada * 0x7FFF;
};

const paraPcm16 = amostras => Int16Array.from(amostras, amostraParaInt16);

function primeiroCanalComAudio(inputs) {
    const canal = inputs[0]?.[0];
    return canal?.length > 0 ? canal : null;
}

class AudioCaptureProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const canal = primeiroCanalComAudio(inputs);
        if (canal) {
            const pcm16 = paraPcm16(canal);
            this.port.postMessage({ type: 'audio-data', data: pcm16.buffer }, [pcm16.buffer]);
        }
        return true;
    }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
