module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  setupFiles: ['<rootDir>/test/setup-env.js'],
  // The end-to-end specs share one Postgres and each rebuilds the schema,
  // so running files in parallel would have them truncate each other's data.
  maxWorkers: 1,
  testRegex: '.*\.spec\.ts$',
  transform: { '^.+\.ts$': 'ts-jest' },
  collectCoverageFrom: ['src/**/*.ts'],
  testEnvironment: 'node',
};
