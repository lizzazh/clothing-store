/**
 * AIService — єдиний reusable сервіс для роботи з Gemini API.
 * Централізує: отримання ключа, вибір моделі, формування запитів,
 * обробку помилок (429, timeout, network, invalid JSON).
 *
 * Сторінки не повинні знати деталі Gemini endpoint.
 */

const AIService = {

    // =============================================
    // MODEL CONFIGURATION
    // Єдине місце для зміни назв моделей.
    // =============================================
    MODELS: {
        /** Для легких задач: класифікація, короткі пояснення */
        light: 'gemini-3.5-flash-lite',
        /** Для складних задач: стилістичні поради, капсули, аналіз гардеробу */
        standard: 'gemini-3.6-flash',
        /** Для multimodal (Vision): розпізнавання фото одягу */
        vision: 'gemini-3.6-flash',
    },

    API_BASE: 'https://generativelanguage.googleapis.com/v1beta',
    DEFAULT_TIMEOUT: 30000, // 30 seconds

    _keys: null,
    _keysPromise: null,

    // =============================================
    // API KEY
    // =============================================

    /**
     * Отримує API ключі з серверного endpoint /api/key.
     * Кешує результат для уникнення зайвих запитів.
     * @returns {Promise<Object>} { key, openrouter_key }
     */
    async getKeys() {
        if (this._keys) return this._keys;

        if (this._keysPromise) return this._keysPromise;

        this._keysPromise = (async () => {
            try {
                const r = await fetch('/api/key');
                if (!r.ok) throw new Error(`Failed to fetch API keys: ${r.status}`);
                const data = await r.json();
                if (!data.key) throw new Error('API key not configured on server');
                this._keys = data;
                return this._keys;
            } catch (e) {
                this._keysPromise = null;
                throw new AIServiceError('API_KEY_ERROR', 'Не вдалося отримати ключ API. Перевірте підключення до сервера.', e);
            }
        })();

        return this._keysPromise;
    },

    // =============================================
    // PUBLIC METHODS
    // =============================================

    /**
     * Генерація тексту (text-only prompt).
     * @param {string} prompt - Текстовий промпт
     * @param {Object} options - { model: 'light'|'standard', timeout: ms }
     * @returns {Promise<string>} - Текст відповіді
     */
    async generateText(prompt, options = {}) {
        const model = this.MODELS[options.model || 'standard'];
        const contents = [{ parts: [{ text: prompt }] }];
        const result = await this._callGemini(model, contents, options);
        return result.text;
    },

    /**
     * Генерація структурованої JSON відповіді.
     * Автоматично витягує JSON із відповіді та валідує.
     * @param {string} prompt - Промпт, що просить JSON
     * @param {Object} options - { model, timeout, validator: (obj) => bool }
     * @returns {Promise<Object>} - Розпарсений JSON об'єкт
     */
    async generateStructured(prompt, options = {}) {
        const model = this.MODELS[options.model || 'light'];
        const contents = [{ parts: [{ text: prompt }] }];
        const result = await this._callGemini(model, contents, options);

        const parsed = this._extractJSON(result.text);
        if (!parsed) {
            throw new AIServiceError('PARSE_ERROR', 'AI повернув невалідну відповідь. Спробуйте ще раз.');
        }

        // Optional custom validator
        if (options.validator && !options.validator(parsed)) {
            throw new AIServiceError('VALIDATION_ERROR', 'AI відповідь не відповідає очікуваному формату.');
        }

        return parsed;
    },

    /**
     * Аналіз зображення (multimodal Vision).
     * @param {string} base64Data - Base64 data URL зображення
     * @param {string} prompt - Текстовий промпт для аналізу
     * @param {Object} options - { model, timeout, validator }
     * @returns {Promise<Object>} - Розпарсений JSON результат
     */
    async analyzeImage(base64Data, prompt, options = {}) {
        const model = this.MODELS[options.model || 'vision'];
        const base64Clean = base64Data.replace(/^data:image\/(png|jpeg|jpg|webp|gif);base64,/, '');

        const contents = [{
            parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: base64Clean } }
            ]
        }];

        const result = await this._callGemini(model, contents, options);
        const parsed = this._extractJSON(result.text);

        if (!parsed) {
            throw new AIServiceError('PARSE_ERROR', 'Не вдалося розпізнати зображення. Спробуйте інше фото.');
        }

        if (options.validator && !options.validator(parsed)) {
            throw new AIServiceError('VALIDATION_ERROR', 'AI не зміг коректно класифікувати зображення.');
        }

        return parsed;
    },

    // =============================================
    // INTERNAL: GEMINI API CALL
    // =============================================

    /**
     * Виконує запит до Gemini API з обробкою помилок.
     * @param {string} model - Назва моделі (e.g. 'gemini-3.6-flash')
     * @param {Array} contents - Gemini contents array
     * @param {Object} options - { timeout }
     * @returns {Promise<{text: string}>}
     */
    async _callGemini(model, contents, options = {}) {
        return this._executeWithFallback(model, contents, options);
    },

    async _executeWithFallback(model, contents, options) {
        try {
            return await this._callGeminiDirect(model, contents, options);
        } catch (e) {
            // Check if fallback is appropriate
            const fallbackCodes = ['RATE_LIMIT', 'SERVICE_UNAVAILABLE', 'TIMEOUT', 'NETWORK_ERROR', 'API_ERROR'];
            if (e instanceof AIServiceError && fallbackCodes.includes(e.code)) {
                console.warn(`Gemini API failed (${e.code}). Attempting OpenRouter fallback...`);
                try {
                    return await this._callOpenRouterDirect(model, contents, options);
                } catch (fallbackError) {
                    console.error('OpenRouter fallback also failed:', fallbackError);
                    // Throw original error with a slight modification to indicate fallback failed
                    if (e.userMessage.includes('резервн')) throw e;
                    e.userMessage = e.userMessage + ' (Резервний AI-сервіс також недоступний)';
                    throw e;
                }
            }
            throw e; // Not a fallback-able error (e.g., validation or parse error)
        }
    },

    async _callGeminiDirect(model, contents, options) {
        const keys = await this.getKeys();
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
            if (!text) throw new AIServiceError('EMPTY_RESPONSE', 'AI повернув порожню відповідь.');
            return { text, raw: data };

        } catch (e) {
            clearTimeout(timeoutId);
            if (e instanceof AIServiceError) throw e;
            if (e.name === 'AbortError') throw new AIServiceError('TIMEOUT', 'Час очікування відповіді вичерпано.');
            throw new AIServiceError('NETWORK_ERROR', 'Не вдалося зв\'язатися з AI-сервісом.', e);
        }
    },

    async _callOpenRouterDirect(model, contents, options) {
        const keys = await this.getKeys();
        if (!keys.openrouter_key) {
            throw new AIServiceError('NO_FALLBACK', 'Резервний API ключ не налаштований.');
        }

        // Map Gemini models to OpenRouter equivalents
        const orModelMap = {
            'gemini-3.5-flash-lite': 'google/gemini-flash-1.5-8b',
            'gemini-3.6-flash': 'google/gemini-flash-1.5',
            'gemini-2.5-flash': 'google/gemini-flash-1.5' // fallback for older code if any
        };
        const orModel = orModelMap[model] || 'google/gemini-flash-1.5';

        // Convert Gemini contents to OpenRouter (OpenAI) format
        const messages = contents.map(c => {
            let contentStr = '';
            let contentArr = [];
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
                role: 'user', // Simplified
                content: hasImage ? contentArr : contentStr.trim()
            };
        });

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
                body: JSON.stringify({ model: orModel, messages }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            if (!response.ok) return this._handleHttpError(response, 'OpenRouter');

            const data = await response.json();
            const text = data?.choices?.[0]?.message?.content;
            if (!text) throw new AIServiceError('EMPTY_RESPONSE', 'AI повернув порожню відповідь.');
            return { text, raw: data };

        } catch (e) {
            clearTimeout(timeoutId);
            if (e instanceof AIServiceError) throw e;
            if (e.name === 'AbortError') throw new AIServiceError('TIMEOUT', 'Час очікування відповіді вичерпано.');
            throw new AIServiceError('NETWORK_ERROR', 'Не вдалося зв\'язатися з резервним AI-сервісом.', e);
        }
    },

    /**
     * Обробка HTTP помилок.
     */
    async _handleHttpError(response, provider) {
        let errData = {};
        try { errData = await response.json(); } catch (e) { /* ignore */ }

        const status = response.status;
        const apiMsg = errData?.error?.message || '';

        if (status === 429) {
            throw new AIServiceError('RATE_LIMIT', 'Ліміт AI-сервісу тимчасово вичерпано. Зачекайте хвилинку.');
        }
        if (status === 503 || status === 502) {
            throw new AIServiceError('SERVICE_UNAVAILABLE', 'AI-сервіс тимчасово недоступний.');
        }
        if (status === 400) {
            throw new AIServiceError('BAD_REQUEST', `Помилка запиту до AI: ${apiMsg || 'невалідні дані'}.`);
        }

        throw new AIServiceError('API_ERROR', `Помилка ${provider} (${status}). ${apiMsg}`);
    },

    // =============================================
    // UTILS
    // =============================================

    /**
     * Витягує JSON об'єкт з тексту AI-відповіді.
     * Обробляє випадки markdown code blocks та зайвого тексту.
     * @param {string} text
     * @returns {Object|null}
     */
    _extractJSON(text) {
        if (!text) return null;

        // Remove markdown code fences
        let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

        // Try direct parse
        try {
            return JSON.parse(cleaned);
        } catch (e) { /* continue */ }

        // Try to find JSON object in text
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (e) { /* continue */ }
        }

        // Try to find JSON array in text
        const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            try {
                return JSON.parse(arrayMatch[0]);
            } catch (e) { /* continue */ }
        }

        return null;
    },

    /**
     * Форматує Gemini markdown → HTML для відображення.
     * @param {string} text - Raw text від Gemini
     * @returns {string} - HTML
     */
    formatMarkdown(text) {
        if (!text) return '';
        return text
            .replace(/\n\n/g, '<br><br>')
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    }
};

// =============================================
// ERROR CLASS
// =============================================

/**
 * Спеціалізована помилка AI сервісу.
 * Містить код помилки для програмної обробки та
 * людиноподібне повідомлення для показу користувачу.
 */
class AIServiceError extends Error {
    /**
     * @param {string} code - Код помилки: RATE_LIMIT, TIMEOUT, NETWORK_ERROR, etc.
     * @param {string} userMessage - Повідомлення для відображення користувачу
     * @param {Error} [cause] - Оригінальна помилка
     */
    constructor(code, userMessage, cause) {
        super(userMessage);
        this.name = 'AIServiceError';
        this.code = code;
        this.userMessage = userMessage;
        if (cause) this.cause = cause;
    }
}
