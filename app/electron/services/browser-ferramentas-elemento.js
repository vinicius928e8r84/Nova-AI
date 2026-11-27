'use strict';

const path = require('path');
const fs = require('fs');
const { ERRO_TRANSITORIO, PRAZO_ESGOTADO, sucesso, falhou, semElemento, toAIFriendlyError } = require('./browser-respostas');

const COMMON_EXTENSIONS = [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.tiff',
    '.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.wmv', '.flv', '.3gp',
    '.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.txt', '.csv', '.json', '.zip', '.rar', '.7z'
];

const ACHE_PELA_FOTO = 'Take a browser_snapshot to find the correct element ref.';
const REFS_NOVAS = 'Run browser_snapshot to get fresh refs, then retry with the correct ref.';

function comExtensaoComum(p) {
    for (const ext of COMMON_EXTENSIONS) {
        const withExt = p + ext;
        if (fs.existsSync(withExt)) {
            console.info(`[BrowserService] Smart resolve: "${p}" → "${withExt}"`);
            return withExt;
        }
    }
    return null;
}

function achadoNaPasta(p, dir, entrada, rotulo) {
    if (!entrada) return null;
    const resolved = path.join(dir, entrada);
    console.info(`[BrowserService] Smart resolve (${rotulo}): "${p}" → "${resolved}"`);
    return resolved;
}

function parecidoNaPasta(p) {
    try {
        const dir = path.dirname(p);
        const base = path.basename(p).toLowerCase();
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
        const entries = fs.readdirSync(dir);
        return achadoNaPasta(p, dir, entries.find(e => e.toLowerCase() === base), 'case')
            || achadoNaPasta(p, dir, entries.find(e => e.toLowerCase().startsWith(base + '.')), 'ext');
    } catch (e) {
        return null;
    }
}

function resolverArquivo(p) {
    if (!p) return null;
    if (fs.existsSync(p)) return p;
    return comExtensaoComum(p) || parecidoNaPasta(p);
}

function dicaDaPasta(firstPath) {
    try {
        if (!firstPath) return '';
        const dir = path.dirname(firstPath);
        if (!fs.existsSync(dir)) return '';
        const files = fs.readdirSync(dir).slice(0, 10);
        return ` Files in ${dir}: [${files.join(', ')}]`;
    } catch (e) {
        return '';
    }
}

function arquivoNaoEncontrado(startTime, pathsArray) {
    return falhou('browser_upload_file', startTime, {
        error: `File not found: "${pathsArray[0]}". Also tried adding common extensions (.png, .jpg, .mp4, etc.) — none matched.${dicaDaPasta(pathsArray[0])}`,
        errorCode: 'FILE_NOT_FOUND',
        errorCategory: 'permanent',
        retryable: false,
        retrySuggestion: `Use the EXACT file path WITH extension. Example: C:\\Users\\<user>\\Downloads\\final thumbnail.png (not "final thumbnail"). Use fs_read on the folder to get exact filename first.`,
    }, { pathsArray });
}

async function avisarQueMudou(locator) {
    try {
        const handle = await locator.elementHandle();
        if (handle) {
            await handle.evaluate((el) => {
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            });
        }
    } catch (e) { }
}

function textoDoClique(selector, { doubleClick, modifiers }, seletorDeArquivo) {
    return `${doubleClick ? 'Double-clicked' : 'Clicked'} element "${selector}"${modifiers.length ? ` with ${modifiers.join('+')}` : ''}${seletorDeArquivo ? ' (file chooser opened — use browser_upload_file next)' : ''}`;
}

const enviado = (fileNames, validPaths, como, method) => ({
    result: `Uploaded ${fileNames.length} file(s)${como}: ${fileNames.join(', ')}`,
    data: method ? { fileNames, filePaths: validPaths, method } : { fileNames, filePaths: validPaths },
});

const ferramentasDeElemento = {
    async _comElemento(toolName, selector, roteiro) {
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            const locator = await this.resolveElement(page, selector);
            if (!locator) return semElemento(toolName, startTime, roteiro.naoAchou(), roteiro.extras);
            const campos = await roteiro.agir(locator, page, startTime);
            return sucesso(toolName, startTime, campos, roteiro.extrasDoSucesso ? roteiro.extrasDoSucesso() : roteiro.extras);
        } catch (e) {
            return falhou(toolName, startTime, roteiro.falha(e), roteiro.extras);
        }
    },

    _vigiarSeletorDeArquivo(page) {
        this._pendingFileChooser = null;
        this._esquecerPrazoDoSeletor();
        return page.waitForEvent('filechooser', { timeout: 2000 })
            .then(chooser => {
                this._pendingFileChooser = chooser;
                console.info('[BrowserService] ✅ File chooser captured proactively');
                this._pendingFileChooserTimeout = setTimeout(() => {
                    this._pendingFileChooser = null;
                    this._pendingFileChooserTimeout = null;
                }, 60000);
            })
            .catch(() => { });
    },

    async click(selector, opts = {}) {
        const startTime = Date.now();
        const page = await this.getPage();
        const { doubleClick = false, button = 'left', modifiers = [], delayMs = 0 } = opts;
        try {
            const locator = await this.resolveElement(page, selector);
            if (!locator) {
                return semElemento('browser_click', startTime, {
                    error: `Element "${selector}" not found on the page.`,
                    retrySuggestion: 'Take a browser_snapshot first to find the correct element reference number, then retry with the right ref.',
                }, { selector });
            }
            const clickOpts = { timeout: 5000, button, modifiers, delay: delayMs };
            const chooserPromise = this._vigiarSeletorDeArquivo(page);
            if (doubleClick) {
                await locator.dblclick(clickOpts);
            } else {
                await locator.click(clickOpts);
            }
            await Promise.race([chooserPromise, new Promise(r => setTimeout(r, 500))]);
            return sucesso('browser_click', startTime, {
                result: textoDoClique(selector, { doubleClick, modifiers }, this._pendingFileChooser),
            }, { selector, fileChooserCaptured: !!this._pendingFileChooser });
        } catch (e) {
            return falhou('browser_click', startTime, {
                error: toAIFriendlyError(e, selector),
                errorCode: e.message?.includes('timeout') ? 'ELEMENT_NOT_FOUND' : 'UNKNOWN_ERROR',
                errorCategory: 'transient',
                retryable: true,
                retrySuggestion: REFS_NOVAS,
            }, { selector });
        }
    },

    async _digitar(page, locator, { text, clearFirst, slowly }) {
        if (slowly) {
            await locator.click();
            if (clearFirst) {
                await locator.selectText().catch(() => {});
                await page.keyboard.press('Delete');
            }
            await locator.pressSequentially(text, { delay: 75 });
        } else if (clearFirst) {
            await locator.fill(text);
        } else {
            await locator.click();
            await locator.pressSequentially(text, { delay: 30 });
        }
    },

    async type(selector, text, clearFirst = true, slowly = false) {
        return this._comElemento('browser_type', selector, {
            naoAchou: () => ({
                error: `Input element "${selector}" not found.`,
                retrySuggestion: 'Take a browser_snapshot to find the correct input element, then try again with the right ref number.',
            }),
            agir: async (locator, page) => {
                await this._digitar(page, locator, { text, clearFirst, slowly });
                return { result: `Typed "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" into "${selector}"${slowly ? ' (human-like)' : ''}${clearFirst ? ' (cleared first)' : ' (appended)'}` };
            },
            extrasDoSucesso: () => ({ selector, textLength: text.length, slowly }),
            falha: e => ({
                error: toAIFriendlyError(e, selector),
                ...ERRO_TRANSITORIO,
                retrySuggestion: 'Run browser_snapshot to get fresh refs, then retry. Make sure the element is a text input.',
            }),
            extras: { selector },
        });
    },

    async _preencherCampo(page, field, timeoutMs) {
        const { selector, text, clearFirst = true } = field;
        try {
            const locator = await this.resolveElement(page, selector);
            if (!locator) return { selector, ok: false, error: 'Element not found' };
            if (clearFirst) {
                await locator.fill(text, { timeout: timeoutMs });
            } else {
                await locator.pressSequentially(text, { delay: 30 });
            }
            return { selector, ok: true };
        } catch (e) {
            return { selector, ok: false, error: e.message };
        }
    },

    async fillForm(fields, timeoutMs = 8000) {
        const startTime = Date.now();
        const page = await this.getPage();
        const results = [];
        for (const field of fields) {
            results.push(await this._preencherCampo(page, field, timeoutMs));
        }
        const successCount = results.filter(r => r.ok).length;
        return {
            ...sucesso('browser_fill_form', startTime, { result: `Filled ${successCount}/${fields.length} form fields`, data: { results } }),
            success: successCount > 0,
        };
    },

    async hover(selector) {
        return this._comElemento('browser_hover', selector, {
            naoAchou: () => ({ error: `Element "${selector}" not found.`, retrySuggestion: 'Take a browser_snapshot to verify the element exists.' }),
            agir: async locator => {
                await locator.hover();
                return { result: `Hovering over "${selector}"` };
            },
            falha: e => ({ error: toAIFriendlyError(e, selector), ...ERRO_TRANSITORIO, retrySuggestion: 'Run browser_snapshot to get fresh refs.' }),
            extras: { selector },
        });
    },

    async scrollIntoView(selector) {
        return this._comElemento('browser_scroll_into_view', selector, {
            naoAchou: () => ({ error: `Element "${selector}" not found.`, retrySuggestion: ACHE_PELA_FOTO }),
            agir: async locator => {
                await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
                return { result: `Scrolled element "${selector}" into view` };
            },
            falha: e => ({ error: `Scroll into view failed: ${e.message}`, ...ERRO_TRANSITORIO }),
        });
    },

    async highlight(selector) {
        return this._comElemento('browser_highlight', selector, {
            naoAchou: () => ({ error: `Element "${selector}" not found.`, retrySuggestion: ACHE_PELA_FOTO }),
            agir: async locator => {
                const handle = await locator.elementHandle();
                if (handle) {
                    await handle.evaluate((el) => {
                        const prev = el.style.outline;
                        el.style.outline = '3px solid red';
                        setTimeout(() => { el.style.outline = prev; }, 2000);
                    });
                }
                return { result: `Highlighted element "${selector}" with red outline (2 seconds)` };
            },
            falha: e => ({ error: `Highlight failed: ${e.message}`, ...ERRO_TRANSITORIO }),
        });
    },

    async select(selector, value) {
        return this._comElemento('browser_select', selector, {
            naoAchou: () => ({ error: `Select element "${selector}" not found.`, retrySuggestion: 'Take a browser_snapshot to find the select/dropdown element ref.' }),
            agir: async locator => {
                await locator.selectOption(value);
                return { result: `Selected "${value}" in dropdown "${selector}"` };
            },
            extrasDoSucesso: () => ({ selector, value }),
            falha: e => ({
                error: `Select failed: ${e.message}`,
                ...ERRO_TRANSITORIO,
                retrySuggestion: 'The value might not match available options. Try using { label: "Option Text" } format.',
            }),
            extras: { selector },
        });
    },

    async dragDrop(sourceSelector, targetSelector) {
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            const source = await this.resolveElement(page, sourceSelector);
            const target = await this.resolveElement(page, targetSelector);
            if (!source) return semElemento('browser_drag_drop', startTime, { error: `Source element "${sourceSelector}" not found.` });
            if (!target) return semElemento('browser_drag_drop', startTime, { error: `Target element "${targetSelector}" not found.` });
            await source.dragTo(target);
            return sucesso('browser_drag_drop', startTime, { result: `Dragged "${sourceSelector}" to "${targetSelector}"` });
        } catch (e) {
            return falhou('browser_drag_drop', startTime, { error: `Drag and drop failed: ${e.message}`, ...ERRO_TRANSITORIO });
        }
    },

    async _enviarPeloCampo(page, { selector, validPaths, fileNames, timeoutMs }) {
        const locator = await this.resolveElement(page, selector);
        if (!locator) return null;
        await locator.setInputFiles(validPaths, { timeout: timeoutMs });
        await avisarQueMudou(locator);
        return enviado(fileNames, validPaths, '', null);
    },

    async _enviarPeloSeletorJaAberto({ validPaths, fileNames }) {
        console.info('[BrowserService] ✅ Using pre-captured file chooser from click');
        const chooser = this._pendingFileChooser;
        this._pendingFileChooser = null;
        this._esquecerPrazoDoSeletor();
        await chooser.setFiles(validPaths);
        return enviado(fileNames, validPaths, ' via pre-captured file chooser', 'file_chooser_precaptured');
    },

    async _enviarArquivos(page, envio) {
        if (envio.selector) {
            const peloCampo = await this._enviarPeloCampo(page, envio);
            if (peloCampo) return peloCampo;
        }
        if (this._pendingFileChooser) return this._enviarPeloSeletorJaAberto(envio);
        const fileChooser = await page.waitForEvent('filechooser', { timeout: envio.timeoutMs });
        await fileChooser.setFiles(envio.validPaths);
        return enviado(envio.fileNames, envio.validPaths, ' via file chooser', 'file_chooser');
    },

    async uploadFile(selector, filePaths, timeoutMs = 30000) {
        const startTime = Date.now();
        const page = await this.getPage();
        const pathsArray = Array.isArray(filePaths) ? filePaths : [filePaths];
        const validPaths = pathsArray.map(resolverArquivo).filter(Boolean).filter(p => p && fs.existsSync(p));
        if (validPaths.length === 0) return arquivoNaoEncontrado(startTime, pathsArray);
        const fileNames = validPaths.map(p => path.basename(p));
        try {
            return sucesso('browser_upload_file', startTime, await this._enviarArquivos(page, { selector, validPaths, fileNames, timeoutMs }));
        } catch (e) {
            return falhou('browser_upload_file', startTime, {
                error: `Upload failed: ${e.message}`,
                ...ERRO_TRANSITORIO,
                retrySuggestion: 'Click the upload button first (browser_click), then IMMEDIATELY call browser_upload_file. The file chooser is captured during the click.',
            }, { selector, validPaths });
        }
    },

    async waitDownload(timeoutMs = 30000) {
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            const download = await page.waitForEvent('download', { timeout: timeoutMs });
            const resolved = await this.resolveBrowserDownloadPath(download, startTime, timeoutMs);
            return sucesso('browser_wait_download', startTime, {
                result: `Downloaded: ${resolved.filename} -> ${resolved.path}`,
                data: { filename: resolved.filename, path: resolved.path, url: download.url() },
            });
        } catch (e) {
            return falhou('browser_wait_download', startTime, {
                error: `Download wait failed: ${e.message}`,
                ...PRAZO_ESGOTADO,
                retrySuggestion: 'Make sure a download was triggered before calling this. Click a download button first.',
            });
        }
    },

    async downloadByClick(selector, timeoutMs = 30000) {
        return this._comElemento('browser_download_by_click', selector, {
            naoAchou: () => ({ error: `Element "${selector}" not found.`, retrySuggestion: 'Take a browser_snapshot to find the download button ref.' }),
            agir: async (locator, page, startTime) => {
                const [download] = await Promise.all([
                    page.waitForEvent('download', { timeout: timeoutMs }),
                    locator.click()
                ]);
                const resolved = await this.resolveBrowserDownloadPath(download, startTime, timeoutMs);
                return {
                    result: `Clicked and downloaded: ${resolved.filename} -> ${resolved.path}`,
                    data: { filename: resolved.filename, path: resolved.path, url: download.url() },
                };
            },
            falha: e => ({ error: `Download by click failed: ${e.message}`, ...ERRO_TRANSITORIO }),
        });
    },

    async handleDialog(accept = true, promptText = null, timeoutMs = 10000) {
        const startTime = Date.now();
        const page = await this.getPage();
        try {
            const dialog = await page.waitForEvent('dialog', { timeout: timeoutMs });
            const dialogType = dialog.type();
            const dialogMessage = dialog.message();
            if (accept) {
                await dialog.accept(promptText || '');
            } else {
                await dialog.dismiss();
            }
            return sucesso('browser_handle_dialog', startTime, {
                result: `${accept ? 'Accepted' : 'Dismissed'} ${dialogType} dialog: "${dialogMessage}"`,
                data: { type: dialogType, message: dialogMessage, accepted: accept },
            });
        } catch (e) {
            return falhou('browser_handle_dialog', startTime, {
                error: `Dialog handling failed: ${e.message}`,
                ...PRAZO_ESGOTADO,
                retrySuggestion: 'No dialog appeared within timeout. Make sure a browser action triggers a dialog first.',
            });
        }
    },
};

module.exports = { ferramentasDeElemento };
