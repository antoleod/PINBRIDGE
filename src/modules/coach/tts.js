/* src/modules/coach/tts.js */
export const tts = {
    defaults: {
        lang: 'fr-FR',
        rate: 1.0,
        pitch: 1.0
    },

    speak(text, options = {}) {
        if (!window.speechSynthesis) {
            console.warn('SpeechSynthesis not supported.');
            return;
        }

        // Cancel previous
        window.speechSynthesis.cancel();

        const config = { ...this.defaults, ...options };
        const utterance = new SpeechSynthesisUtterance(text);

        utterance.lang = config.lang;
        utterance.rate = config.rate;
        utterance.pitch = config.pitch;

        // Optional: Select specific voice if available (e.g., Google Français)
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => v.lang === config.lang && v.name.includes('Google'));
        if (preferredVoice) utterance.voice = preferredVoice;

        window.speechSynthesis.speak(utterance);
    }
};
