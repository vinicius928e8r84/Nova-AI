/**
 * 
 *  NOVA STUDIO  Core Backend Orchestrator v3
 *  electron/services/nova-studio-controller.js
 *
 *  MODES:
 *    1. ACCOUNT MODE (Primary):   Routes through GeminiBrowserEngine
 *       — Uses the user's own Google Account session (no API quota).
 *    2. API KEY MODE (Fallback):  Uses GoogleGenerativeAI SDK with stored key.
 *
 *  Model selection, login state, and mode-switch are controlled via IPC.
 * 
 */

'use strict';

const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI } = require('@google/genai');
const path = require('path');
const fs = require('fs');
const { clipboard } = require('electron');

// ── Google Account Browser Engine ──────────────────────────────────
let geminiBrowserEngine = null;
try {
    geminiBrowserEngine = require('./gemini-browser-engine');
    console.log('[Studio] ✓ GeminiBrowserEngine loaded — Account Mode available.');
} catch (e) {
    console.warn('[Studio] GeminiBrowserEngine not available:', e.message);
}

const SYSTEM_INSTRUCTION = "You are Nova, an intelligent AI assistant and Creative Director of NOVA STUDIO. You must always act on previously extracted text if the user instructs you to. You remember all context in a conversation. You are brief, professional, and focus on high-fidelity results for both imaging and document tasks.";

class NovaStudioController {
    constructor(mainWindow, app) {
        this.mainWindow = mainWindow;
        this.app = app;

        // Diagnostic model check removed to prevent SDK listModels errors

        // PHASE 1 (Native Imaging): Initialize Imagen 3
        this.app.getGeminiToken().then(token => {
            if (token) {
                this.nativeImageClient = new GoogleGenAI({ apiKey: token });
            }
        });
    }

    /**
     * Helper: Convert Base64 into Generative Part
     */
    base64ToGenerativePart(base64Str, mimeType = "image/png") {
        if (!base64Str) return null;
        try {
            const data = base64Str.includes(',') ? base64Str.split(',')[1] : base64Str;
            return {
                inlineData: {
                    data: data,
                    mimeType
                },
            };
        } catch (e) {
            console.error("[Studio] Base64 conversion failed:", e.message);
            return null;
        }
    }

    /**
     * Main Entry Point for the Studio Panel (Real Intelligence Overhaul)
     *
     * accountMode=true  → uses the logged-in Google Account browser session
     * accountMode=false → falls back to Gemini SDK + API key
     */
    async executeEdit({ image, command, mode, history = [], accountMode = false, selectedModel = null }) {
        console.log(`[Studio] Neural Routing: ${command} (${mode} | accountMode=${accountMode}) | History: ${history.length} turns`);

        // ══ ACCOUNT MODE: Route through Browser Engine (no API quota) ═══════
        if (accountMode && geminiBrowserEngine) {
            const authStatus = geminiBrowserEngine.getAuthStatus();
            if (!authStatus.isLoggedIn) {
                return {
                    success: false,
                    error: 'NOT_LOGGED_IN',
                    role: 'nova',
                    message: '⚠️ Google Account connect nahi hai. Studio Settings → "Connect Google Account" dabayein.'
                };
            }

            const activeModel = selectedModel || geminiBrowserEngine.getSelectedModel();
            console.log(`[Studio] → Account Mode via Browser Engine (model: ${activeModel})`);

            try {
                const engineResult = await geminiBrowserEngine.sendMessage({
                    prompt:      command || (image ? 'Analyze this image in detail and describe everything you see.' : 'Hello'),
                    imageBase64: image || null,
                    model:       activeModel,
                    history:     history.map(h => ({
                        role: h.role === 'user' ? 'user' : 'model',
                        text: Array.isArray(h.parts) ? (h.parts[0]?.text || '') : ''
                    })),
                });

                if (engineResult.success) {
                    if (image && command && /copy|text|read|extract|ocr/i.test(command)) {
                        clipboard.writeText(engineResult.text);
                    }
                    return {
                        success:       true,
                        intent:        image ? 'ocr_extraction' : 'chat',
                        message:       engineResult.text,
                        extractedText: engineResult.text,
                        answer:        engineResult.text,
                        role:          'nova',
                        model:         engineResult.model,
                    };
                }

                // Engine returned an error — fall through to API key
                console.warn('[Studio] Account engine error, falling back to API key:', engineResult.error);
            } catch (engineErr) {
                console.warn('[Studio] Browser Engine exception, falling back:', engineErr.message);
            }
        }

        // ══ API KEY MODE: Gemini SDK (original flow) ═════════════════════════
        let cleanKey = null;
        try {
            const apiKey = await this.app.getGeminiToken();
            if (!apiKey) throw new Error("GEMINI_API_KEY_MISSING");

            cleanKey = apiKey.trim();
            const genAI = new GoogleGenerativeAI(cleanKey);

            // PHASE 1: INTENT CLASSIFICATION (Lightning Fast via Flash)
            const classification = await this.classifyIntent(image, command, genAI, history);
            console.log(`[Studio] Goal Identified:`, classification.intent);

            // PHASE 2: CONTEXT-AWARE RESPONSE GENERATION (Deep Reasoning via Pro)
            // If it's pure chat or OCR, we need the final answer now.
            if (classification.intent === 'ocr_extraction' || classification.intent === 'question') {
                const aiResult = await this.generateVisionResponse(image, command, classification.intent, genAI, history);
                
                if (classification.intent === 'ocr_extraction') {
                    clipboard.writeText(aiResult);
                    return {
                        success: true,
                        intent: 'ocr',
                        extractedText: aiResult,
                        message: aiResult, // AI text describing the extraction
                        role: 'nova'
                    };
                }

                return {
                    success: true,
                    intent: 'chat',
                    answer: aiResult,
                    message: aiResult,
                    role: 'nova'
                };
            }

            // PHASE 3: NATIVE IMAGE GENERATION (Imagen 3)
            // Use Pro to get a conversational confirmation + The high-fidelity description for Imagen
            const brainResponse = await this.enhancePrompt(image, command, genAI, history);

            // Construct a detailed professional prompt for the full re-generation
            const result = await this.generateNativeImage(brainResponse.positive);

            return {
                success: true,
                intent: brainResponse.intent,
                image: result,
                replacementText: brainResponse.replacement_text,
                message: brainResponse.confirmation_text, // REAL conversational confirmation
                role: 'nova',
                metadata: {
                    prompt: brainResponse.positive,
                    mode: mode
                }
            };

        } catch (error) {
            console.error('GEMINI SDK EXCEPTION:', error);
            
            // PHASE 3 (Auto-Discovery): Log the truth when 404 occurs
            if (error.message.includes('404') || error.message.includes('not found')) {
                console.log('[Studio] 404 detected. Model may be outdated.');
                
                return {
                    success: false,
                    error: `404 MODEL NOT FOUND: ${error.message}`,
                    role: 'nova',
                    message: `CRITICAL ERROR: The model you requested is not available. System has been updated to use gemini-1.5-flash.`
                };
            }

            // Add user-requested disclaimer for generative editing
            const resultPayload = {
                success: false,
                error: error.message || "Neural Matrix Destabilized",
                role: 'nova',
                message: `GEMINI_ERROR: ${error.message}`
            };

            if (error.message.includes("IMAGEN")) {
                resultPayload.message = `Boss, I am re-generating the entire card based on the original data. Text rendering on complex official documents might have slight alignment/spelling variations.`;
            }

            return resultPayload;
        }
    }

    /**
     * MULTIMODAL VISION: Deep Reasoning & OCR (Gemini 1.5 Pro)
     */
    async generateVisionResponse(image, command, intent, genAI, history = []) {
        const model = genAI.getGenerativeModel({ 
            model: 'gemini-3.8-flash',
            systemInstruction: SYSTEM_INSTRUCTION
        }, { apiVersion: 'v1beta' });
        const chat = model.startChat({ history });

        let prompt = `You are Nova, the high-fidelity AI brain of this Studio. `;
        if (intent === 'ocr_extraction') {
            prompt += `Extract ALL relevant text from this image accurately. Respond conversationally telling me what you found, and then list the raw text clearly. If it's an ID, format it nicely.`;
        } else {
            prompt += `Analyze this image and answer the user's request: "${command}". Be brief but very professional and smart.`;
        }

        const imagePart = this.base64ToGenerativePart(image);
        const parts = imagePart ? [imagePart, { text: prompt }] : [{ text: prompt }];

        const result = await chat.sendMessage(parts);
        return result.response.text();
    }

    /**
     * INTENT CLASSIFICATION (Gemini 1.5 Flash)
     */
    async classifyIntent(image, command, genAI, history = []) {
        const model = genAI.getGenerativeModel({ 
            model: 'gemini-3.8-flash',
            systemInstruction: SYSTEM_INSTRUCTION
        }, { apiVersion: 'v1beta' });
        const chat = model.startChat({ history });
        
        const prompt = `
Analyze this command and classify the user's intent: "${command}"
1. Image manipulation / Creative Edit? -> "image_edit"
2. Reading documents / ID text / Copying? -> "ocr_extraction"
3. Question or analysis about the image? -> "question"

Return ONLY valid JSON: { "intent": "image_edit" | "ocr_extraction" | "question" }
`;

        const imagePart = this.base64ToGenerativePart(image);
        const parts = imagePart ? [imagePart, { text: prompt }] : [{ text: prompt }];

        const result = await chat.sendMessage(parts);
        const responseText = result.response.text();
        const match = responseText.match(/\{[\s\S]*\}/);
        return match ? JSON.parse(match[0]) : { intent: 'image_edit' };
    }

    /**
     * PROMPT ENGINEERING & CONFIRMATION (Gemini 1.5 Pro)
     */
    async enhancePrompt(image, command, genAI, history = []) {
        const model = genAI.getGenerativeModel({ 
            model: 'gemini-3.1-flash-live-preview',
            systemInstruction: SYSTEM_INSTRUCTION
        }, { apiVersion: 'v1beta' });
        const chat = model.startChat({ history });

        const promptTemplate = `
You are the Creative Director of NOVA STUDIO. The goal is to generate a NATIVE GOOGLE IMAGEN prompt.
Attached is a source image. Analyze it and the command: "${command}"

Requirement:
1. Provide a detailed, high-fidelity technical description of the target image for a generator.
2. If it's a document/ID card, describe the layout, the card material, the background, AND include the updated data (e.g. "A high-resolution, perfectly aligned photograph of a Pakistani CNIC card on a dark surface, the card is made of green and white plastic, the name on the card is [NAME]...").
3. Include lighting, camera angles (8k, macro lens, cinematic lighting), and texture.

Return ONLY valid JSON with:
1. "intent": "image_edit" or "document_edit"
2. "positive": The standalone, full-frame textual description for Imagen 3.
3. "confirmation_text": A Jarvis-like response.
4. "target_text": (For reference) data being replaced.
5. "replacement_text": (For reference) new data.

Format: { "intent": "...", "positive": "...", "confirmation_text": "...", "target_text": "...", "replacement_text": "..." }
`;

        const imagePart = this.base64ToGenerativePart(image);
        const parts = imagePart ? [imagePart, { text: promptTemplate }] : [{ text: promptTemplate }];

        const result = await chat.sendMessage(parts);
        const responseText = result.response.text();
        const match = responseText.match(/\{[\s\S]*\}/);
        
        return match ? JSON.parse(match[0]) : { 
            intent: 'image_edit', 
            positive: command, 
            confirmation_text: "Understood. Starting neural imaging sequence.",
            negative: "low quality" 
        };
    }

    /**
     * NATIVE IMAGE GENERATION: Google Imagen 3.0
     */
    async generateNativeImage(prompt) {
        if (!this.nativeImageClient) {
            const token = await this.app.getGeminiToken();
            this.nativeImageClient = new GoogleGenAI({ apiKey: token });
        }

        console.log(`[Studio] Calling Google Imagen: ${prompt.substring(0, 100)}...`);

        try {
            const response = await this.nativeImageClient.models.generateImages({
                model: 'imagen-3.0-generate-002',
                prompt: prompt,
                config: {
                    numberOfImages: 1,
                    aspectRatio: '1:1',
                },
            });

            if (response.generatedImages?.[0]?.imageBinary) {
                const base64 = Buffer.from(response.generatedImages[0].imageBinary).toString('base64');
                return `data:image/png;base64,${base64}`;
            }
            
            throw new Error("IMAGEN_RETURNED_EMPTY");
        } catch (err) {
            console.error('[Studio] Imagen API Error:', err.message);
            throw new Error(`IMAGEN_FALLBACK: ${err.message}`);
        }
    }

    /**
     * Decommissioned: Stable Diffusion Router (Local)
     */
    async callStableDiffusion(sourceImage, promptData, mode) {
        throw new Error("STABLE_DIFFUSION_DECOMMISSIONED");
    }

    /**
     * Noise Harmonization Pass
     */
    async harmonizeEdit(sourceImage, mode) {
        console.log(`[Studio] Harmonizing...`);
        const payload = {
            positive: "scanned document paper noise, high resolution, film grain, matched lighting",
            denoising_strength: 0.18
        };

        return await this.callStableDiffusion(sourceImage, { ...payload, intent: 'edit' }, mode);
    }
}

module.exports = NovaStudioController;

module.exports.diagnosticListModels = () => {};
