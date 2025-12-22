const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/;
const PIN_RE = /^\d{4,6}$/;

const validateUsername = (username) => {
    const value = (username || '').trim();
    if (!value) {
        return { ok: false, code: 'USERNAME_REQUIRED', message: 'Username is required.' };
    }
    if (!USERNAME_RE.test(value)) {
        return { ok: false, code: 'USERNAME_INVALID', message: 'Use 3-32 characters (letters, numbers, _ or -).' };
    }
    return { ok: true, value };
};

const validatePin = (pin) => {
    const value = (pin || '').trim();
    if (!value) {
        return { ok: false, code: 'PIN_REQUIRED', message: 'PIN is required.' };
    }
    if (!PIN_RE.test(value)) {
        return { ok: false, code: 'PIN_INVALID', message: 'PIN must be 4-6 digits.' };
    }
    return { ok: true, value };
};

export {
    validateUsername,
    validatePin
};
