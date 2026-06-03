module.exports = {
  clearMocks: true,
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/**/*.test.ts',
    '!<rootDir>/src/**/*.d.ts',
  ],
  coverageProvider: 'v8',
  extensionsToTreatAsEsm: [
    '.ts',
  ],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  modulePathIgnorePatterns: [
    '<rootDir>/dist/',
    '<rootDir>/tmp/',
  ],
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testPathIgnorePatterns: [
    '<rootDir>/dist/',
    '<rootDir>/tmp/',
  ],
  testMatch: [
    '<rootDir>/src/**/*.test.ts',
  ],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        useESM: true,
      },
    ],
  },
  watchPathIgnorePatterns: [
    '<rootDir>/dist/',
    '<rootDir>/tmp/',
  ],
};
