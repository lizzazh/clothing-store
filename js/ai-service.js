/**
 * AIService — єдиний reusable сервіс для роботи з AI API.
 * Підтримує ланцюжок відмовостійкості (Fallback Chain): Gemini -> Groq -> OpenRouter.
 */

const AIService = {

    // =============================================
    // AI MODELS CONFIGURATION
    // =============================================
    AI_MODELS: {
        gemini: {
            standard: 'gemini-3.6-flash',
            light: 'gemini-3.5-flash-lite',
            vision: 'gemini-3.6-flash'
        },
        groq: {
            standard: 'llama-3.1-70b-versatile',
            light: 'llama-3.1-8b-instant'
        },
        openrouter: {
            standard: 'meta-llama/llama-3.1-8b-instruct:free',
            light: 'meta-llama/llama-3.1-8b-instruct:free',
            vision: 'qwen/qwen-2-vl-7b-instruct:free'
        }
    },

    API_BASE: 'https://generativelanguage.googleapis.com/v1beta',
    DEFAULT_TIMEOUT: 30000,

    _keys: null,
    _keysPromise: null,

    // =============================================
    // API KEYS
    // =============================================
    async getKeys() {
        if (this._keys) return this._keys;
        if (this._keysPromise) return this._keysPromise;

        this._keysPromise = (async () => {
            try {
                const r = await fetch('/api/key');
                if (!r.ok) throw new Error(`Failed to fetch API keys: ${r.status}`);
                const data = await r.json();
                if (!data.key) throw new Error('Gemini API key not configured');
                this._keys = data;
                return this._keys;
            } catch (e) {
                this._keysPromise = null;
                throw new AIServiceError('API_KEY_ERROR', 'Не вдалося отримати ключі API.', e);
            }
        })();

        return this._keysPromise;
    },

    // =============================================
    // PUBLIC METHODS
    // =============================================

    async generateText(prompt, options = {}) {
        const contents = [{ parts: [{ text: prompt }] }];
        const chain = ['gemini', 'groq', 'openrouter'];
        const result = await this._executeChain(chain, options.model || 'standard', contents, options, null);
        return result.content;
    },

    async generateStructured(prompt, options = {}) {
        const contents = [{ parts: [{ text: prompt }] }];
        const chain = ['gemini', 'groq', 'openrouter'];
        
        const result = await this._executeChain(chain, options.model || 'light', contents, options, (text) => {
            const parsed = this._extractJSON(text);
            if (!parsed) throw new AIServiceError('PARSE_ERROR', 'Invalid JSON from AI');
            if (options.validator && !options.validator(parsed)) throw new AIServiceError('VALIDATION_ERROR', 'Validation failed');
            return parsed;
        });
        
        return result.content;
    },

    async analyzeImage(base64Data, prompt, options = {}) {
        const base64Clean = base64Data.replace(/^data:image\/(png|jpeg|jpg|webp|gif);base64,/, '');
        const contents = [{
            parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: base64Clean } }
            ]
        }];

        const chain = ['gemini', 'openrouter']; // Groq doesn't support vision reliably in this config
        
        try {
            const result = await this._executeChain(chain, 'vision', contents, options, (text) => {
                const parsed = this._extractJSON(text);
                if (!parsed) throw new AIServiceError('PARSE_ERROR', 'Invalid JSON from AI');
                // Vision validation: must have category and color
                if (!parsed.category || !parsed.color) throw new AIServiceError('VALIDATION_ERROR', 'Missing required vision fields');
                if (options.validator && !options.validator(parsed)) throw new AIServiceError('VALIDATION_ERROR', 'Custom validation failed');
                return parsed;
            });
            return result.content;
        } catch (e) {
            throw new AIServiceError('VISION_FAILED', 'Не вдалося автоматично визначити характеристики речі. Ви можете заповнити їх вручну.', e);
        }
    },

    // =============================================
    // FALLBACK ORCHESTRATOR
    // =============================================

    async _executeChain(chain, modelTier, contents, options, processResult) {
        let lastError = null;
        
        for (const provider of chain) {
            try {
                if (provider === 'gemini') console.log('[AIService] Gemini request...');
                else console.log(`[AIService] Trying ${provider}...`);
                
                let textResponse = '';
                
                if (provider === 'gemini') {
                    const res = await this._callGeminiDirect(modelTier, contents, options);
                    textResponse = res.text;
                } else if (provider === 'groq') {
                    const res = await this._callGroqDirect(modelTier, contents, options);
                    textResponse = res.text;
                } else if (provider === 'openrouter') {
                    const res = await this._callOpenRouterDirect(modelTier, contents, options);
                    textResponse = res.text;
                }

                let finalContent = textResponse;
                
                if (processResult) {
                    finalContent = processResult(textResponse);
                }

                console.log(`[AIService] ${provider} success.`);
                return { success: true, content: finalContent, provider };

            } catch (e) {
                const fallbackCodes = ['RATE_LIMIT', 'SERVICE_UNAVAILABLE', 'TIMEOUT', 'NETWORK_ERROR', 'API_ERROR', 'EMPTY_RESPONSE', 'PARSE_ERROR', 'VALIDATION_ERROR'];
                
                if (e instanceof AIServiceError && fallbackCodes.includes(e.code)) {
                    console.warn(`[AIService] ${provider} failed: ${e.code}`);
                    lastError = e;
                    continue; // try next
                }
                
                // For other errors (e.g. BAD_REQUEST, NO_FALLBACK key), abort chain or bubble up
                console.error(`[AIService] ${provider} unrecoverable error:`, e);
                throw e;
            }
        }
        
        if (lastError) {
            lastError.userMessage = "Не вдалося отримати відповідь AI. Спробуйте ще раз трохи пізніше.";
            throw lastError;
        }
        
        throw new AIServiceError('UNKNOWN', 'All AI providers failed silently.');
    },

    // =============================================
    // PROVIDER IMPLEMENTATIONS
    // =============================================

    async _callGeminiDirect(modelTier, contents, options) {
        const keys = await this.getKeys();
        if (!keys.key) throw new AIServiceError('API_ERROR', 'Gemini key missing');
        
        const model = this.AI_MODELS.gemini[modelTier];
        const url = `${this.API_BASE}/models/${model}:generateContent?key=${keys.key}`;
        const timeout = options.timeout || this.DEFAULT_TIMEOUT;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) return this._handleHttpError(response, 'Gemini');

            const data = await response.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new AIServiceError('EMPTY_RESPONSE', 'Empty text from Gemini');
            return { text, raw: data };
        } catch (e) {
            clearTimeout(timeoutId);
            if (e instanceof AIServiceError) throw e;
            if (e.name === 'AbortError') throw new AIServiceError('TIMEOUT', 'Timeout');
            throw new AIServiceError('NETWORK_ERROR', 'Network error', e);
        }
    },

    async _callGroqDirect(modelTier, contents, options) {
        const keys = await this.getKeys();
        if (!keys.groq_key) {
            throw new AIServiceError('API_ERROR', 'Groq key missing'); // Treat missing key as API error to continue chain
        }
        
        const model = this.AI_MODELS.groq[modelTier];
        const messages = this._convertToOpenAILike(contents);
        const timeout = options.timeout || this.DEFAULT_TIMEOUT;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${keys.groq_key}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ model, messages }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) return this._handleHttpError(response, 'Groq');

            const data = await response.json();
            const text = data?.choices?.[0]?.message?.content;
            if (!text) throw new AIServiceError('EMPTY_RESPONSE', 'Empty text from Groq');
            return { text, raw: data };
        } catch (e) {
            clearTimeout(timeoutId);
            if (e instanceof AIServiceError) throw e;
            if (e.name === 'AbortError') throw new AIServiceError('TIMEOUT', 'Timeout');
            throw new AIServiceError('NETWORK_ERROR', 'Network error', e);
        }
    },

    async _callOpenRouterDirect(modelTier, contents, options) {
        const keys = await this.getKeys();
        if (!keys.openrouter_key) {
            throw new AIServiceError('API_ERROR', 'OpenRouter key missing');
        }
        
        const model = this.AI_MODELS.openrouter[modelTier];
        const messages = this._convertToOpenAILike(contents);
        const timeout = options.timeout || this.DEFAULT_TIMEOUT;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${keys.openrouter_key}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': window.location.href,
                    'X-Title': 'Elizabeths Elegance'
                },
                body: JSON.stringify({ model, messages }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) return this._handleHttpError(response, 'OpenRouter');

            const data = await response.json();
            const text = data?.choices?.[0]?.message?.content;
            if (!text) throw new AIServiceError('EMPTY_RESPONSE', 'Empty text from OpenRouter');
            return { text, raw: data };
        } catch (e) {
            clearTimeout(timeoutId);
            if (e instanceof AIServiceError) throw e;
            if (e.name === 'AbortError') throw new AIServiceError('TIMEOUT', 'Timeout');
            throw new AIServiceError('NETWORK_ERROR', 'Network error', e);
        }
    },

    // =============================================
    // UTILS
    // =============================================

    _convertToOpenAILike(contents) {
        return contents.map(c => {
            let contentArr = [];
            let contentStr = '';
            let hasImage = false;
            
            c.parts.forEach(p => {
                if (p.text) {
                    contentStr += p.text + '\n';
                    contentArr.push({ type: 'text', text: p.text });
                }
                if (p.inlineData) {
                    hasImage = true;
                    contentArr.push({
                        type: 'image_url',
                        image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` }
                    });
                }
            });
            return {
                role: 'user',
                content: hasImage ? contentArr : contentStr.trim()
            };
        });
    },

    async _handleHttpError(response, provider) {
        let errData = {};
        try { errData = await response.json(); } catch (e) { /* ignore */ }
        const status = response.status;
        const apiMsg = errData?.error?.message || '';

        if (status === 429) throw new AIServiceError('RATE_LIMIT', `Rate limit exceeded on ${provider}`);
        if (status >= 500) throw new AIServiceError('SERVICE_UNAVAILABLE', `Service unavailable on ${provider}`);
        if (status === 400) throw new AIServiceError('BAD_REQUEST', `Bad request on ${provider}: ${apiMsg}`);

        throw new AIServiceError('API_ERROR', `Error ${status} on ${provider}: ${apiMsg}`);
    },

    _extractJSON(text) {
        if (!text) return null;
        let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        try { return JSON.parse(cleaned); } catch (e) { }
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try { return JSON.parse(jsonMatch[0]); } catch (e) { }
        }
        const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            try { return JSON.parse(arrayMatch[0]); } catch (e) { }
        }
        return null;
    },

    formatMarkdown(text) {
        if (!text) return '';
        return text
            .replace(/\n\n/g, '<br><br>')
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    }
};

class AIServiceError extends Error {
    constructor(code, userMessage, cause) {
        super(userMessage);
        this.name = 'AIServiceError';
        this.code = code;
        this.userMessage = userMessage;
        if (cause) this.cause = cause;
    }
}
