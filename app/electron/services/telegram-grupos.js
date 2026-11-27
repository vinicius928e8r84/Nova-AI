const INTERVALO_ENTRE_AVISOS_DE_GRUPO_MS = 24 * 60 * 60 * 1000;

const listaComItens = (lista) => Array.isArray(lista) && lista.length > 0;

function momentoDoUltimoAviso(avisos, titulo) {
    return avisos[titulo] ? new Date(avisos[titulo]).getTime() : 0;
}

function filtroDeGruposAtivo(gerente) {
    return gerente.tgNotificationFilterEnabled && listaComItens(gerente.tgMonitoredGroups);
}

function grupoMonitorado(gerente, chatTitle) {
    return gerente.tgMonitoredGroups.some(g => g.trim().toLowerCase() === chatTitle.trim().toLowerCase());
}

async function tratarMensagemDeGrupo(gerente, peer) {
    console.info(`[Telegram-Filter] Received group/channel message. Enabled: ${gerente.tgNotificationFilterEnabled}, Monitored: ${JSON.stringify(gerente.tgMonitoredGroups)}`);
    if (!filtroDeGruposAtivo(gerente)) return;
    try {
        const entity = await gerente.client.getEntity(peer);
        const chatTitle = entity.title || '';
        console.info(`[Telegram-Filter] Resolved group title: "${chatTitle}"`);
        if (grupoMonitorado(gerente, chatTitle)) {
            await avisarGrupoMonitorado(gerente, entity, chatTitle);
        }
    } catch (err) {
        console.error('[Telegram-Filter] Error in monitored group message processing:', err.message);
    }
}

async function avisarGrupoMonitorado(gerente, entity, chatTitle) {
    const now = Date.now();
    const decorrido = now - momentoDoUltimoAviso(gerente.tgNotificationCooldowns, chatTitle);
    if (decorrido >= INTERVALO_ENTRE_AVISOS_DE_GRUPO_MS) {
        await enviarAvisoAoGrupo(gerente, entity, chatTitle);
    } else {
        console.info(`[Telegram-Filter] Group "${chatTitle}" is under cooldown. (Remaining: ${Math.round((INTERVALO_ENTRE_AVISOS_DE_GRUPO_MS - decorrido) / 1000 / 60)} minutes)`);
    }
}

async function enviarAvisoAoGrupo(gerente, entity, chatTitle) {
    console.info(`[Telegram-Filter] Message detected in monitored group: "${chatTitle}". Dispatching predefined message...`);
    gerente.tgNotificationCooldowns[chatTitle] = new Date().toISOString();
    gerente.saveSettings();
    await gerente.client.sendMessage(entity, { message: gerente.tgNotificationMessage });
    console.info(`[Telegram-Filter] Predefined notification successfully sent to group: "${chatTitle}"`);
}

module.exports = { tratarMensagemDeGrupo };
