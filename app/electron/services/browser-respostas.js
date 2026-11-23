'use strict';

const ERRO_TRANSITORIO = { errorCode: 'UNKNOWN_ERROR', errorCategory: 'transient', retryable: true };
const ERRO_PERMANENTE = { errorCode: 'UNKNOWN_ERROR', errorCategory: 'permanent', retryable: false };
const ARGUMENTO_INVALIDO = { errorCode: 'INVALID_ARGS', errorCategory: 'permanent', retryable: false };
const PRAZO_ESGOTADO = { errorCode: 'NAVIGATION_TIMEOUT', errorCategory: 'timeout', retryable: true };
const NAVEGACAO_LENTA = { errorCode: 'NAVIGATION_TIMEOUT', errorCategory: 'transient', retryable: true };
const PAGINA_QUEBROU = { errorCode: 'PAGE_CRASHED', errorCategory: 'transient', retryable: true };

const KNOWN_DEVICES = {
    'iPhone 12': { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1' },
    'iPhone 14': { viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
    'iPad Pro': { viewport: { width: 1024, height: 1366 }, userAgent: 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1' },
    'Samsung Galaxy S20': { viewport: { width: 412, height: 915 }, userAgent: 'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36' },
    'Pixel 5': { viewport: { width: 393, height: 851 }, userAgent: 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36' },
    'Desktop 1280': { viewport: { width: 1280, height: 720 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
    'Desktop 1920': { viewport: { width: 1920, height: 1080 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
};

const INTERACTIVE_ROLES = new Set([
    'button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'searchbox',
    'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'treeitem',
]);

const CONTENT_ROLES = new Set([
    'article', 'cell', 'columnheader', 'gridcell', 'heading',
    'listitem', 'main', 'navigation', 'region', 'rowheader',
]);

const STRUCTURAL_ROLES = new Set([
    'application', 'directory', 'document', 'generic', 'grid', 'group',
    'ignored', 'list', 'menu', 'menubar', 'none', 'presentation',
    'row', 'rowgroup', 'table', 'tablist', 'toolbar', 'tree', 'treegrid',
]);

const PAPEIS_IGNORADOS_NO_CDP = new Set(['', 'none', 'generic']);
const LINHA_DO_ARIA = /^(\s*-\s*)(\w+)(?:\s+"([^"]*)")?(.*)$/;
const LIMITE_DE_LINHAS_DO_CDP = 600;

const depuracao = (startTime, extras) => ({ executionTimeMs: Date.now() - startTime, ...extras });

function sucesso(toolName, startTime, campos, extras) {
    return { success: true, toolName, ...campos, debugInfo: depuracao(startTime, extras) };
}

function falhou(toolName, startTime, campos, extras) {
    return { success: false, toolName, ...campos, debugInfo: depuracao(startTime, extras) };
}

function semElemento(toolName, startTime, { error, retrySuggestion }, extras) {
    const sugestao = retrySuggestion === undefined ? {} : { retrySuggestion };
    return falhou(toolName, startTime, { error, errorCode: 'ELEMENT_NOT_FOUND', errorCategory: 'not_found', retryable: true, ...sugestao }, extras);
}

const mostraMuitos = message => message.includes('strict mode violation');
const esperou = message => message.includes('Timeout') || message.includes('waiting for');
const naoApareceu = message => message.includes('to be visible') || message.includes('not visible');
const esperouAparecer = message => esperou(message) && naoApareceu(message);
const naoInterage = message => ['intercepts pointer events', 'not visible', 'not receive pointer events'].some(trecho => message.includes(trecho));

const ERROS_DE_ELEMENTO = [
    [mostraMuitos, (selector, message) => {
        const countMatch = message.match(/resolved to (\d+) elements/);
        const count = countMatch ? countMatch[1] : 'multiple';
        return `Element "${selector}" matched ${count} elements. Run browser_snapshot to get updated refs.`;
    }],
    [esperouAparecer, selector => `Element "${selector}" not found or not visible. Run browser_snapshot to see current page elements.`],
    [naoInterage, selector => `Element "${selector}" is not interactable (hidden or covered by overlay). Try browser_scroll_into_view first, or close any overlays, then re-snapshot.`],
];

function toAIFriendlyError(error, selector) {
    const message = error instanceof Error ? error.message : String(error);
    const conhecido = ERROS_DE_ELEMENTO.find(([reconhece]) => reconhece(message));
    return conhecido ? conhecido[1](selector, message) : message;
}

function textoComRef({ prefix, roleRaw, name, suffix }, ref, nth) {
    let enhanced = `${prefix}${roleRaw}`;
    if (name) enhanced += ` "${name}"`;
    enhanced += ` [ref=${ref}]`;
    if (nth > 0) enhanced += ` [nth=${nth}]`;
    if (suffix && suffix.includes('[')) enhanced += suffix;
    return enhanced;
}

function linhaComRef(estado, partes) {
    const { name, role } = partes;
    estado.counter++;
    const ref = `e${estado.counter}`;
    const key = `${role}:${name || ''}`;
    const nth = estado.roleCounts[key] || 0;
    estado.roleCounts[key] = nth + 1;
    estado.elementMap.set(ref, {
        role,
        name: name || null,
        nth: nth > 0 ? nth : undefined,
    });
    if (INTERACTIVE_ROLES.has(role)) estado.interactiveCount++;
    return textoComRef(partes, ref, nth);
}

function lerLinhaDoAria(estado, line) {
    const match = line.match(LINHA_DO_ARIA);
    if (!match) return line;
    const [, prefix, roleRaw, name, suffix] = match;
    if (roleRaw.startsWith('/')) return line;
    const role = roleRaw.toLowerCase();
    if (STRUCTURAL_ROLES.has(role) && !name) return null;
    const shouldHaveRef = INTERACTIVE_ROLES.has(role) || (CONTENT_ROLES.has(role) && name);
    return shouldHaveRef ? linhaComRef(estado, { prefix, roleRaw, name, suffix, role }) : line;
}

const recuo = linha => Math.floor((linha.match(/^(\s*)/)?.[1]?.length || 0) / 2);

function temFilhoComRef(linhas, i) {
    const currentIndent = recuo(linhas[i]);
    for (let j = i + 1; j < linhas.length; j++) {
        if (recuo(linhas[j]) <= currentIndent) return false;
        if (linhas[j].includes('[ref=')) return true;
    }
    return false;
}

const temRef = (linhas, i) => linhas[i].includes('[ref=');
const temValor = (linhas, i) => linhas[i].includes(':') && !linhas[i].trimEnd().endsWith(':');
const CRITERIOS_DA_LINHA = [temRef, temValor, temFilhoComRef];

function montarSnapshot(ariaText, elementMap) {
    const estado = { counter: 0, roleCounts: {}, interactiveCount: 0, elementMap };
    const resultLines = [];
    for (const line of ariaText.split('\n')) {
        const lida = lerLinhaDoAria(estado, line);
        if (lida !== null) resultLines.push(lida);
    }
    const compactedLines = resultLines.filter((_, i) => CRITERIOS_DA_LINHA.some(criterio => criterio(resultLines, i)));
    return { compactedLines, counter: estado.counter, interactiveCount: estado.interactiveCount };
}

const papelDoNo = node => String(node.role?.value || '').toLowerCase();
const nomeDoNo = node => String(node.name?.value || '').trim();

function linhaDoNoCdp(node) {
    if (node.ignored) return null;
    const role = papelDoNo(node);
    const name = nomeDoNo(node);
    if (PAPEIS_IGNORADOS_NO_CDP.has(role)) return null;
    if (!name && !INTERACTIVE_ROLES.has(role)) return null;
    let line = `- ${role}`;
    if (name) line += ` "${name.substring(0, 120)}"`;
    return line;
}

function textoDaArvoreCdp(nodes) {
    const lines = [];
    for (const node of nodes) {
        const line = linhaDoNoCdp(node);
        if (line === null) continue;
        lines.push(line);
        if (lines.length >= LIMITE_DE_LINHAS_DO_CDP) break;
    }
    return lines.join('\n');
}

module.exports = {
    ERRO_TRANSITORIO,
    ERRO_PERMANENTE,
    ARGUMENTO_INVALIDO,
    PRAZO_ESGOTADO,
    NAVEGACAO_LENTA,
    PAGINA_QUEBROU,
    KNOWN_DEVICES,
    sucesso,
    falhou,
    semElemento,
    toAIFriendlyError,
    montarSnapshot,
    textoDaArvoreCdp,
};
