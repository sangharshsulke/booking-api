/**
 * Global Jest Setup File
 */

global.console = { ...console, log: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };

process.env.NODE_ENV   = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-unit-tests';
process.env.JWT_EXPIRE = '1d';
process.env.PORT       = '3001';

jest.mock('./config/database', () => {
  const mockClient = { query: jest.fn(), release: jest.fn() };
  return { query: jest.fn(), pool: { connect: jest.fn().mockResolvedValue(mockClient) }, __mockClient: mockClient };
});

jest.mock('./config/firebase', () => ({
  apps: [{ name: '[DEFAULT]' }],
  auth: () => ({ verifyIdToken: jest.fn().mockResolvedValue({ uid: 'firebase-uid-123', phone_number: '+919876543210' }) }),
  messaging: () => ({ send: jest.fn().mockResolvedValue('message-id-123'), sendMulticast: jest.fn().mockResolvedValue({ successCount: 1, failureCount: 0 }) }),
}));

jest.mock('multer', () => {
  const multer = () => ({
    single:  () => (req, res, next) => { req.file = { filename: 'test-image.jpg', path: '/uploads/test-image.jpg', mimetype: 'image/jpeg', size: 1024 }; next(); },
    array:   () => (req, res, next) => { req.files = [{ filename: 'test-image.jpg', path: '/uploads/test-image.jpg', mimetype: 'image/jpeg', size: 1024 }]; next(); },
    fields:  () => (req, res, next) => { req.files = {}; next(); },
    none:    () => (req, res, next) => { next(); },
  });
  multer.diskStorage = () => ({});
  multer.memoryStorage = () => ({});
  return multer;
});

jest.mock('bcryptjs', () => ({ genSalt: jest.fn().mockResolvedValue('salt'), hash: jest.fn().mockResolvedValue('hashed-password'), compare: jest.fn().mockResolvedValue(true) }));

jest.mock('fs', () => ({ ...jest.requireActual('fs'), existsSync: jest.fn().mockReturnValue(true), unlinkSync: jest.fn(), mkdirSync: jest.fn(), writeFileSync: jest.fn() }));

afterEach(() => { jest.clearAllMocks(); });
