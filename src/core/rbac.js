const ADMIN_PREFIX_RE = /^ADM[\w-]+$/;

const ROLES = {
    ADMIN: 'admin',
    USER: 'user'
};

const normalizeUsername = (username) => (username || '').trim();

const isAdminUsername = (username) => ADMIN_PREFIX_RE.test(normalizeUsername(username));

const coerceRole = (role, username) => {
    const normalized = role === ROLES.ADMIN ? ROLES.ADMIN : ROLES.USER;
    if (normalized === ROLES.ADMIN && !isAdminUsername(username)) {
        return ROLES.USER;
    }
    return normalized;
};

const canAccessAdmin = (meta) => {
    const username = normalizeUsername(meta?.username);
    const role = coerceRole(meta?.role, username);
    return role === ROLES.ADMIN;
};

export {
    ADMIN_PREFIX_RE,
    ROLES,
    normalizeUsername,
    isAdminUsername,
    coerceRole,
    canAccessAdmin
};
