/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // e2e 파일들이 같은 hub_test DB를 지우고 다시 만들므로 한 번에 하나씩 돈다.
  maxWorkers: 1,
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
};
