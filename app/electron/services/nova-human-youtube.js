const { browserService } = require('./browser-manager');

const LIMITE_DE_LEITURAS_DO_LINK = 20;

async function buscarDigitando(controlador, pagina, consulta) {
    controlador.log(`Navigating to YouTube Media Database...`);
    await browserService.navigate('https://www.youtube.com');
    await pagina.waitForTimeout(1500);

    await pagina.bringToFront();
    controlador.log(`Manually typing query: "${consulta}"`);
    await browserService.type('input#search', consulta, { delay: 120, pressEnter: true });

    await pagina.waitForTimeout(2000);

    if (!pagina.url().includes('/results')) {
        controlador.log(`Search not triggered via Enter. Clicking Search Icon manually...`);
        await pagina.click('button#search-icon-legacy');
        await pagina.waitForTimeout(1000);
    }
}

async function voltarParaBusca(controlador, pagina, consulta) {
    controlador.log(`Returning to Search interface...`);
    await pagina.bringToFront();

    if (pagina.url().includes('watch?v=')) {
        await pagina.goBack();
    } else {
        await browserService.navigate(`https://www.youtube.com/results?search_query=${encodeURIComponent(consulta)}`);
    }
    await pagina.waitForTimeout(2000);
}

function abrirBusca(controlador, pagina, consulta, tentativa) {
    return tentativa === 1
        ? buscarDigitando(controlador, pagina, consulta)
        : voltarParaBusca(controlador, pagina, consulta);
}

async function listarResultados(controlador, pagina) {
    controlador.log(`Analyzing search results (Waiting up to 20s)...`);
    await pagina.bringToFront();

    await pagina.waitForSelector('ytd-video-renderer', { visible: true, timeout: 20000 });
    await pagina.waitForTimeout(1500);

    return pagina.locator('ytd-video-renderer a#video-title');
}

async function abrirResultado(controlador, pagina, tentativa) {
    const resultados = await listarResultados(controlador, pagina);
    const total = await resultados.count();

    if (total === 0) throw new Error('No videos found.');

    const indice = Math.min(tentativa - 1, total - 1);
    controlador.log(`Selecting Media Result #${indice + 1}...`);

    await resultados.nth(indice).scrollIntoViewIfNeeded();
    await pagina.waitForTimeout(800);
    await resultados.nth(indice).click();
}

async function esperarLinkDoVideo(controlador, pagina) {
    for (let leitura = 0; leitura < LIMITE_DE_LEITURAS_DO_LINK; leitura++) {
        await pagina.waitForTimeout(500);
        const endereco = pagina.url();
        if (endereco.includes('/watch?v=')) {
            controlador.log(`Playback confirmed. Capturing link...`);
            await pagina.waitForTimeout(1500);
            return endereco;
        }
    }
    return '';
}

async function capturarLink(controlador, pagina) {
    controlador.log(`Stabilizing encrypted media link...`);
    const link = await esperarLinkDoVideo(controlador, pagina);

    if (!link) throw new Error('Link stabilization failed.');

    controlador.log(`Media Link Captured Successfully.`);
    await pagina.waitForTimeout(1000);
    return link;
}

module.exports = { abrirBusca, abrirResultado, capturarLink };
