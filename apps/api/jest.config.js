// Unitarias: src/**/*.spec.ts. Integración contra PostgreSQL real: test/**/*.int-spec.ts.
module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000,
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.int-spec.ts'],
  setupFiles: ['<rootDir>/test/load-env.js'],
  reporters: ['default', '<rootDir>/test/timing-reporter.js'],
};
