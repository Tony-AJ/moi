/**
 * Imported for its side effect, before the application modules.
 *
 * The @Throttle decorators read their limits when the controller module is
 * first imported, so a spec that wants production-shaped limits has to set
 * them before that import runs. Import order in the spec file is what makes
 * this work, so this import must stay first.
 */
process.env.THROTTLE_LOGIN_LIMIT = '3';
process.env.THROTTLE_GUEST_WRITE_LIMIT = '3';
process.env.THROTTLE_LIMIT = '1000000';
