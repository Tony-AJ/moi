import { generateTemporaryPassword } from '../src/common/utils/password.util';

describe('generateTemporaryPassword', () => {
  const samples = Array.from({ length: 500 }, () => generateTemporaryPassword());

  it('produces three readable groups of four', () => {
    for (const password of samples) {
      expect(password).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    }
  });

  it('never uses characters that are easy to misread', () => {
    for (const password of samples) expect(password).not.toMatch(/[0O1lIi]/);
  });

  it('always mixes upper case, lower case and digits', () => {
    for (const password of samples) {
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[2-9]/);
    }
  });

  it('does not repeat', () => {
    expect(new Set(samples).size).toBe(samples.length);
  });
});
