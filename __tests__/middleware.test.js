/**
 * Middleware Tests — auth.js
 * Tests:
 *   verifyToken   — valid, expired, invalid, missing, device mismatch
 *   isAdmin       — ADMIN and SUPERADMIN allowed, others rejected
 *   isSuperAdmin  — only SUPERADMIN allowed
 *   isVendor      — only VENDOR allowed
 *   isCustomer    — only CUSTOMER allowed
 */

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const express = require('express');
const { verifyToken, isAdmin, isSuperAdmin, isVendor, isCustomer } = require('../middleware/auth');
const db      = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-for-unit-tests';

// ─── Tiny test app to mount middleware under test ────────────────────────────
const buildApp = (...middlewares) => {
  const app = express();
  app.use(express.json());
  app.get('/test', ...middlewares, (req, res) => res.json({ success: true, user: req.user }));
  return app;
};

const makeToken = (userId = 1, userType = 'CUSTOMER', deviceId = 'dev-123') =>
  jwt.sign({ userId, userType, deviceId }, JWT_SECRET, { expiresIn: '1d' });

// ──────────────────────────────────────────────────────────────────────────────
// verifyToken
// ──────────────────────────────────────────────────────────────────────────────

describe('Middleware: verifyToken', () => {
  const app = buildApp(verifyToken);

  test('should allow request with a valid JWT token', async () => {
    // Arrange
    const token = makeToken(1, 'CUSTOMER', 'dev-123');
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'dev-123' }] });

    // Act
    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.userId).toBe(1);
    expect(res.body.user.userType).toBe('CUSTOMER');
  });

  test('should return 401 NO_TOKEN when Authorization header is missing', async () => {
    const res = await request(app).get('/test');
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('NO_TOKEN');
  });

  test('should return 401 INVALID_TOKEN for a malformed token', async () => {
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer not.a.real.token');

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  test('should return 401 TOKEN_EXPIRED for an expired token', async () => {
    // Create a token that is already expired
    const expiredToken = jwt.sign(
      { userId: 1, userType: 'CUSTOMER' },
      JWT_SECRET,
      { expiresIn: '-1s' } // negative = instantly expired
    );

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  test('should return 401 SESSION_EXPIRED when device_id does not match stored value', async () => {
    // Token says device-A but DB has device-B
    const token = makeToken(1, 'CUSTOMER', 'device-A');
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'device-B' }] });

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
  });

  test('should pass through when token has no deviceId (pre-B15 token)', async () => {
    // Token without deviceId — device check should be skipped
    const token = jwt.sign({ userId: 1, userType: 'CUSTOMER' }, JWT_SECRET, { expiresIn: '1d' });

    const res = await request(app)
      .get('/test')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(db.query).not.toHaveBeenCalled(); // no DB call for device check
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// isAdmin
// ──────────────────────────────────────────────────────────────────────────────

describe('Middleware: isAdmin', () => {
  const app = buildApp(verifyToken, isAdmin);

  test('should allow ADMIN user through', async () => {
    const token = makeToken(1, 'ADMIN');
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'dev-123' }] });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
  });

  test('should allow SUPERADMIN user through', async () => {
    const token = makeToken(1, 'SUPERADMIN');
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'dev-123' }] });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
  });

  test('should reject CUSTOMER user with 403', async () => {
    const token = makeToken(1, 'CUSTOMER');
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'dev-123' }] });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('should reject VENDOR user with 403', async () => {
    const token = makeToken(1, 'VENDOR');
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'dev-123' }] });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// isSuperAdmin
// ──────────────────────────────────────────────────────────────────────────────

describe('Middleware: isSuperAdmin', () => {
  const app = buildApp(verifyToken, isSuperAdmin);

  test('should allow SUPERADMIN user through', async () => {
    const token = makeToken(1, 'SUPERADMIN');
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'dev-123' }] });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
  });

  test('should reject ADMIN (non-super) with 403', async () => {
    const token = makeToken(1, 'ADMIN');
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'dev-123' }] });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// isVendor
// ──────────────────────────────────────────────────────────────────────────────

describe('Middleware: isVendor', () => {
  const app = buildApp(verifyToken, isVendor);

  test('should allow VENDOR user through', async () => {
    const token = makeToken(2, 'VENDOR');
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'dev-123' }] });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
  });

  test('should reject CUSTOMER with 403', async () => {
    const token = makeToken(1, 'CUSTOMER');
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'dev-123' }] });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// isCustomer
// ──────────────────────────────────────────────────────────────────────────────

describe('Middleware: isCustomer', () => {
  const app = buildApp(verifyToken, isCustomer);

  test('should allow CUSTOMER user through', async () => {
    const token = makeToken(1, 'CUSTOMER');
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'dev-123' }] });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
  });

  test('should reject VENDOR with 403', async () => {
    const token = makeToken(2, 'VENDOR');
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'dev-123' }] });

    const res = await request(app).get('/test').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(403);
  });
});
