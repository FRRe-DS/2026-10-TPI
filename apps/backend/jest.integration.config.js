/**
 * Configuración de Jest EXCLUSIVA para pruebas de integración (Tema 25 - Testcontainers).
 *
 * Requiere Docker. Se ejecuta con:  npm run test:integration
 * La suite unitaria (`npm test`) NO ejecuta estos archivos (ver testPathIgnorePatterns
 * en package.json) y es independiente de Docker.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.integration\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/integration-tests/support/global-setup.ts',
  globalTeardown: '<rootDir>/integration-tests/support/global-teardown.ts',
  // La primera ejecución descarga la imagen de PostgreSQL; las pruebas en sí son rápidas.
  testTimeout: 60000,
};
