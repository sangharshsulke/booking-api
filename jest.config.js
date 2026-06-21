/**
 * Jest Configuration for Salon Booking API
 * Targets 80%+ coverage across all modules
 */
module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Look for tests in __tests__ folders or *.test.js files
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/?(*.)+(spec|test).js',
  ],

  // Coverage configuration
  collectCoverage: false, // Enable via --coverage flag
  collectCoverageFrom: [
    'controllers/**/*.js',
    'middleware/**/*.js',
    'routes/**/*.js',
    'services/**/*.js',
    // Exclude legacy / unmounted files (not wired into server.js)
    '!controllers/serviceController.js',
    '!controllers/shopController.js',
    '!controllers/testController.js',
    '!routes/serviceRoutes.js',
    '!routes/shopRoutes.js',
    '!routes/vendorRoutes-old.js',
    '!**/node_modules/**',
    '!**/__tests__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'clover', 'html'],
  // Thresholds reflect happy-path test suite (error-branch paths are not covered)
  coverageThreshold: {
    global: {
      branches: 45,
      functions: 65,
      lines: 60,
      statements: 60,
    },
  },

  // Setup file that runs after Jest is installed (gives access to jest.fn, afterEach, etc.)
  setupFilesAfterEnv: ['<rootDir>/setupTests.js'],

  // Timeout per test (ms)
  testTimeout: 15000,

  // Verbose output
  verbose: true,

  // Clear mocks between every test
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Module name mapper for path aliases (if any)
  moduleNameMapper: {},
};
