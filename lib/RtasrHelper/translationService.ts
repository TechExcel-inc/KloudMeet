/**
 * Translation utility functions for STT feature.
 * Using local API proxy to avoid CORS issues and secure API keys.
 */

/**
 * Language code mapping to API format.
 */
const LANGUAGE_CODE_MAP: { [key: string]: string; } = {
    'zh': 'cn', // Chinese
    'en': 'en', // English
    'ko': 'ko', // Korean
    'ja': 'ja', // Japanese
    // 'fr': 'fr', // French
};

/**
 * Translates text using the local translation proxy API.
 *
 * @param {string} text - The text to translate.
 * @param {string} targetLangId - Target language ID.
 * @param {string} sourceLangId - Source language ID, defaults to 'auto'.
 * @returns {Promise<string>} Translated text.
 */
export async function translateText(
    text: string,
    targetLangId: string,
    sourceLangId: string = 'auto'
): Promise<string> {
    if (!text || !text.trim()) return '';

    try {
        const from = LANGUAGE_CODE_MAP[sourceLangId] || sourceLangId;
        const to = LANGUAGE_CODE_MAP[targetLangId] || targetLangId;

        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text,
                from,
                to
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Translation proxy error: ${response.status} ${errorData.error || ''}`);
        }

        const result = await response.json();

        if (result.code === 0 && result.translatedText) {
            return result.translatedText;
        }

        throw new Error(`Translation proxy returned error: ${result.error || 'Unknown error'}`);
    } catch (error) {
        console.error('Translation failed:', error);
        // Fallback to original text if translation fails to not break the UI
        return text;
    }
}
