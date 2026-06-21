/**
 * Auth API Tests
 * Routes tested:
 *   POST   /api/auth/send-otp
 *   POST   /api/auth/verify-otp
 *   POST   /api/auth/check-user
 *   POST   /api/auth/login
 *   POST   /api/auth/register
 *   GET    /api/auth/profile
 *   PUT    /api/auth/profile
 *   POST   /api/auth/logout
 */

const request  = require('supertest');
const jwt      = require('jsonwebtoken');
const app      = require('../server');
const db       = require('../config/database');

// ─── Helpers ────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-for-unit-tests';

/** Generate a signed test token */
const makeToken = (userId = 1, userType = 'CUSTOMER', deviceId = 'device-001') =>
  jwt.sign({ userId, userType, deviceId }, JWT_SECRET, { expiresIn: '1d' });

/** Auth header shortcut */
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

// ─── Fixtures ───────────────────────────────────────────────────────────────

const mockUserRow = {
  user_id:       1,
  phone_number:  '+919876543210',
  email:         'test@example.com',
  user_type:     'CUSTOMER',
  status:        'active',
  phone_verified: true,
  created_at:    new Date().toISOString(),
  name:          'Test User',
  city:          'Mumbai',
  state:         'MH',
  gender:        'male',
  profile_picture: null,
  last_login_at: null,
  shop_id:       null,
  stored_device_id: 'device-001',
  fcm_token:     null,
};

const mockProfileRows = [mockUserRow];

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/send-otp
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/send-otp', () => {
  test('should return OTP info for valid phone number (new user)', async () => {
    // Arrange — user does not exist yet
    db.query.mockResolvedValueOnce({ rows: [] });

    // Act
    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone_number: '+919876543210' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.phone_number).toBe('+919876543210');
    expect(res.body.data.user_exists).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('should return OTP info and user_exists=true for existing user', async () => {
    // Arrange — user already exists
    db.query.mockResolvedValueOnce({
      rows: [{ user_id: 1, user_type: 'CUSTOMER', status: 'active' }],
    });

    // Act
    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone_number: '+919876543210' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.data.user_exists).toBe(true);
    expect(res.body.data.user_type).toBe('CUSTOMER');
  });

  test('should return 400 when phone_number is missing', async () => {
    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('should return 400 when phone_number format is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/send-otp')
      .send({ phone_number: '9876543210' }); // missing +91 prefix

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/verify-otp  — Login flow (existing user)
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/verify-otp (login - existing user)', () => {
  let mockClient;

  beforeEach(() => {
    // db.pool.connect() returns mockClient
    mockClient = db.__mockClient || { query: jest.fn(), release: jest.fn() };
    db.pool.connect.mockResolvedValue(mockClient);
  });

  test('should login an existing user successfully with bypass token', async () => {
    // Arrange
    const existingUserRow = { ...mockUserRow };
    // Call sequence in verifyOTP for existing user (phone_verified=true, same device):
    //   1. BEGIN
    //   2. SELECT existing user
    //   3. UPDATE device_id + last_login_at   (phone_verified is already true → no extra UPDATE)
    //   4. SELECT completed user
    //   5. COMMIT
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                      // 1: BEGIN
      .mockResolvedValueOnce({ rows: [existingUserRow] })       // 2: SELECT existing user
      .mockResolvedValueOnce({ rows: [] })                      // 3: UPDATE device_id / last_login_at
      .mockResolvedValueOnce({ rows: [existingUserRow] })       // 4: SELECT completed user
      .mockResolvedValueOnce({ rows: [] });                     // 5: COMMIT

    // Act
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({
        firebase_token: 'BYPASS_TOKEN_test',
        phone_number:   '+919876543210',
        device_id:      'device-001',
      });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/login successful/i);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data.user).toHaveProperty('user_id');
  });

  test('should register a new user successfully with bypass token', async () => {
    // Arrange — no existing user, no email in payload so email-check is skipped
    // Call sequence in verifyOTP for new user (no email provided):
    //   1. BEGIN
    //   2. SELECT existing user → none
    //   3. INSERT user → returns user_id
    //   4. INSERT user_profiles
    //   5. COMMIT
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                                              // 1: BEGIN
      .mockResolvedValueOnce({ rows: [] })                                              // 2: SELECT existing → none
      .mockResolvedValueOnce({ rows: [{ user_id: 5, user_type: 'CUSTOMER', created_at: new Date() }] }) // 3: INSERT user
      .mockResolvedValueOnce({ rows: [] })                                              // 4: INSERT user_profiles
      .mockResolvedValueOnce({ rows: [] });                                             // 5: COMMIT

    // Act
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({
        firebase_token: 'BYPASS_TOKEN_test',
        phone_number:   '+917777777777',
        name:           'New User',
        user_type:      'CUSTOMER',
        device_id:      'device-new',
      });

    // Assert
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/registered/i);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data.user.role).toBe('CUSTOMER');
  });

  test('should return 400 when firebase_token is missing', async () => {
    const res = await request(app)
      .post('/api/auth/verify-otp')
      .send({ phone_number: '+919876543210' });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/check-user
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/check-user', () => {
  test('should return user found when phone and role match', async () => {
    // Arrange
    db.query.mockResolvedValueOnce({
      rows: [{ user_id: 1, user_type: 'CUSTOMER', status: 'active' }],
    });

    // Act
    const res = await request(app)
      .post('/api/auth/check-user')
      .send({ phone_number: '+919876543210', role: 'CUSTOMER' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.exists).toBe(true);
  });

  test('should return 404 when user does not exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/check-user')
      .send({ phone_number: '+910000000000', role: 'CUSTOMER' });

    expect(res.statusCode).toBe(404);
    expect(res.body.exists).toBe(false);
  });

  test('should return 403 when role does not match', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ user_id: 1, user_type: 'VENDOR', status: 'active' }],
    });

    const res = await request(app)
      .post('/api/auth/check-user')
      .send({ phone_number: '+919876543210', role: 'CUSTOMER' });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('should return 400 when phone_number or role is missing', async () => {
    const res = await request(app)
      .post('/api/auth/check-user')
      .send({ phone_number: '+919876543210' }); // role missing

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login  (legacy password-based)
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  test('should login successfully with valid credentials', async () => {
    // Arrange
    const bcrypt = require('bcryptjs');
    bcrypt.compare.mockResolvedValueOnce(true);

    db.query
      .mockResolvedValueOnce({
        rows: [{ user_id: 1, password_hash: 'hashed', user_type: 'CUSTOMER', status: 'active' }],
      })
      .mockResolvedValueOnce({ rows: [] })           // UPDATE last_login_at
      .mockResolvedValueOnce({ rows: [{ name: 'Test', city: 'Mumbai', state: 'MH', profile_picture: null }] }); // profile

    // Act
    const res = await request(app)
      .post('/api/auth/login')
      .send({ phone_number: '+919876543210', password: 'password123' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data.user_type).toBe('CUSTOMER');
  });

  test('should return 401 for invalid credentials (wrong password)', async () => {
    const bcrypt = require('bcryptjs');
    bcrypt.compare.mockResolvedValueOnce(false);

    db.query.mockResolvedValueOnce({
      rows: [{ user_id: 1, password_hash: 'hashed', user_type: 'CUSTOMER', status: 'active' }],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ phone_number: '+919876543210', password: 'wrongpassword' });

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('should return 401 for non-existent user', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ phone_number: '+910000000000', password: 'password123' });

    expect(res.statusCode).toBe(401);
  });

  test('should return 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ phone_number: '+919876543210' }); // password missing

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/register  (legacy password-based)
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = db.__mockClient || { query: jest.fn(), release: jest.fn() };
    db.pool.connect.mockResolvedValue(mockClient);
  });

  test('should register a new user successfully', async () => {
    // Arrange
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                                               // BEGIN
      .mockResolvedValueOnce({ rows: [] })                                               // check existing
      .mockResolvedValueOnce({ rows: [{ user_id: 10, user_type: 'CUSTOMER' }] })        // INSERT user
      .mockResolvedValueOnce({ rows: [] })                                               // INSERT profile
      .mockResolvedValueOnce({ rows: [] });                                              // COMMIT

    // Act
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        phone_number: '+919876543210',
        email:        'new@example.com',
        password:     'Password@123',
        name:         'New User',
        user_type:    'CUSTOMER',
        city:         'Pune',
        state:        'MH',
        gender:       'male',
      });

    // Assert
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data.user_type).toBe('CUSTOMER');
  });

  test('should return 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'no-phone@example.com' });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('should return 400 when user already exists', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                       // BEGIN
      .mockResolvedValueOnce({ rows: [{ user_id: 1 }] })        // existing user found
      .mockResolvedValueOnce({ rows: [] });                      // ROLLBACK

    const res = await request(app)
      .post('/api/auth/register')
      .send({
        phone_number: '+919876543210',
        password:     'Password@123',
        name:         'Duplicate User',
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/auth/profile
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/auth/profile', () => {
  test('should return user profile for authenticated user', async () => {
    // Arrange
    const token = makeToken(1, 'CUSTOMER');
    db.query
      .mockResolvedValueOnce({ rows: [{ device_id: 'device-001' }] }) // device check
      .mockResolvedValueOnce({ rows: [mockProfileRows[0]] });          // profile query

    // Act
    const res = await request(app)
      .get('/api/auth/profile')
      .set(bearer(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('user_id');
    expect(res.body.data).toHaveProperty('phone_number');
  });

  test('should return 401 when no token is provided', async () => {
    const res = await request(app).get('/api/auth/profile');
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('NO_TOKEN');
  });

  test('should return 404 when user is not found in DB', async () => {
    const token = makeToken(999, 'CUSTOMER');
    db.query
      .mockResolvedValueOnce({ rows: [] })  // device check (no stored device)
      .mockResolvedValueOnce({ rows: [] }); // profile query → empty

    const res = await request(app)
      .get('/api/auth/profile')
      .set(bearer(token));

    expect(res.statusCode).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/auth/profile
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/auth/profile', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = db.__mockClient || { query: jest.fn(), release: jest.fn() };
    db.pool.connect.mockResolvedValue(mockClient);
  });

  test('should update profile successfully', async () => {
    // Arrange
    const token = makeToken(1, 'CUSTOMER');
    const updatedProfile = { ...mockUserRow, name: 'Updated Name', city: 'Delhi' };

    // device check in middleware
    db.query.mockResolvedValueOnce({ rows: [{ device_id: 'device-001' }] });

    mockClient.query
      .mockResolvedValueOnce({ rows: [] })           // BEGIN
      .mockResolvedValueOnce({ rows: [] })           // UPDATE email on users
      .mockResolvedValueOnce({ rows: [] })           // UPDATE is_current = false
      .mockResolvedValueOnce({ rows: [] })           // INSERT new profile
      .mockResolvedValueOnce({ rows: [updatedProfile] }) // SELECT updated user
      .mockResolvedValueOnce({ rows: [] });          // COMMIT

    // Act
    const res = await request(app)
      .put('/api/auth/profile')
      .set(bearer(token))
      .send({ name: 'Updated Name', city: 'Delhi', email: 'updated@example.com' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/updated/i);
  });

  test('should return 401 when not authenticated', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .send({ name: 'No Auth' });

    expect(res.statusCode).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/auth/logout
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  test('should logout successfully and clear device_id', async () => {
    // Arrange
    const token = makeToken(1, 'CUSTOMER');
    db.query
      .mockResolvedValueOnce({ rows: [{ device_id: 'device-001' }] }) // device check
      .mockResolvedValueOnce({ rows: [] });                            // UPDATE clear device_id

    // Act
    const res = await request(app)
      .post('/api/auth/logout')
      .set(bearer(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/logged out/i);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('device_id = NULL'),
      expect.any(Array)
    );
  });

  test('should return 401 when no token is provided', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.statusCode).toBe(401);
  });
});
