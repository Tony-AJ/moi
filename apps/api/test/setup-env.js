/**
 * Runs before any module is imported.
 *
 * The @Throttle decorators are evaluated when their controller module is
 * first imported, so the limits have to be in the environment before that
 * happens. Setting them inside a beforeAll is too late.
 */
process.env.THROTTLE_LIMIT = '1000000';
process.env.THROTTLE_LOGIN_LIMIT = '1000000';
process.env.THROTTLE_GUEST_WRITE_LIMIT = '1000000';
process.env.THROTTLE_GUEST_READ_LIMIT = '1000000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-characters-long!!';
process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://moi:moi_dev_password@localhost:5433/moi_test?schema=public';
