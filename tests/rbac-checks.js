import { isAdminUsername } from '../src/core/rbac.js';
import { validateUsername, validatePin } from '../src/core/validation.js';

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};

const run = () => {
    assert(isAdminUsername('ADM_Juan'), 'ADM prefix should be recognized.');
    assert(isAdminUsername('ADM-001'), 'ADM prefix should allow dash.');
    assert(!isAdminUsername('admin_juan'), 'Lowercase admin should not be treated as admin.');
    assert(!isAdminUsername('USR_ADM'), 'ADM prefix is required at start.');

    assert(validateUsername('User_01').ok, 'Valid username should pass.');
    assert(!validateUsername('ab').ok, 'Short usernames should fail.');
    assert(validatePin('1234').ok, 'Valid PIN should pass.');
    assert(!validatePin('12ab').ok, 'Non-numeric PIN should fail.');

    console.log('RBAC checks passed.');
};

run();
