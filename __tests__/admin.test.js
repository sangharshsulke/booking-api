/**
 * Admin API Tests
 * Routes tested (all under /api/admin — require verifyToken + isAdmin):
 *   GET    /dashboard/stats
 *   GET    /users
 *   GET    /users/:id
 *   PUT    /users/:id/status
 *   DELETE /users/:id
 *   POST   /users/admin              (SUPERADMIN only)
 *   GET    /vendors
 *   GET    /vendors/:id
 *   PUT    /vendors/:id/verification
 *   GET    /vendors/:id/documents
 *   PUT    /documents/:documentId/verification
 *   DELETE /documents/:documentId
 *   GET    /vendors/:id/services
 *   GET    /services
 *   GET    /services/:id
 *   POST   /services
 *   PUT    /services/:id
 *   DELETE /services/:id
 *   PUT    /services/:id/availability
 *   GET    /categories
 *   GET    /categories/:id
 *   POST   /categories
 *   PUT    /categories/:id
 *   DELETE /categories/:id
 *   GET    /bookings
 *   GET    /bookings/:id
 *   POST   /bookings
 *   PUT    /bookings/:id/status
 *   PUT    /bookings/:id/cancel
 *   POST   /vendors/:id/services/add
 *   DELETE /vendors/:id/services/:serviceId
 */

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../server');
const db      = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-for-unit-tests';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeAdminToken = (userId = 99, userType = 'ADMIN') =>
  jwt.sign({ userId, userType, deviceId: 'dev-a' }, JWT_SECRET, { expiresIn: '1d' });

const makeSuperAdminToken = (userId = 100) =>
  jwt.sign({ userId, userType: 'SUPERADMIN', deviceId: 'dev-sa' }, JWT_SECRET, { expiresIn: '1d' });

const auth  = (token) => ({ Authorization: `Bearer ${token}` });
// device_id checks match the token's deviceId field
const dc    = ()      => db.query.mockResolvedValueOnce({ rows: [{ device_id: 'dev-a' }] });
const dcSA  = ()      => db.query.mockResolvedValueOnce({ rows: [{ device_id: 'dev-sa' }] });

/** Returns a booking date ~6 months in the future */
const futureDate = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return d.toISOString().split('T')[0];
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockUser = {
  user_id: 5, phone_number: '+919000000001', email: 'u@example.com',
  user_type: 'CUSTOMER', status: 'active', name: 'User One',
};

const mockVendor = {
  user_id: 20, phone_number: '+919000000002', email: 'v@example.com',
  user_type: 'VENDOR', status: 'active', name: 'Vendor One',
  shop_id: 1, shop_name: 'Style Studio', verification_status: 'pending',
};

const mockService = {
  service_id: 1, service_name: 'Haircut', category: 'Hair',
  description: 'Standard haircut', is_available: true, base_price: 300,
};

// NOTE: category fixture uses category_name (DB column) not name
const mockCategory = {
  category_id: 1, category_name: 'Hair', description: 'Hair services',
  icon: 'hair.png', is_active: true,
};

const mockBooking = {
  booking_id: 500, vendor_id: 20, user_id: 5,
  booking_date: '2026-12-25', booking_time: '10:00',
  booking_status: 'confirmed', status: 'active', total_amount: 500,
};

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/dashboard/stats
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/dashboard/stats', () => {
  test('should return platform-level dashboard statistics', async () => {
    // Arrange — controller makes 10 db.query calls:
    //   userStats, bookingStats, todayBookingStats, todayUserStats,
    //   pendingVendors, recentUsers, recentBookings, monthlyRevenue,
    //   categoriesCount, servicesCount
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ user_type: 'CUSTOMER', count: '80' }, { user_type: 'VENDOR', count: '20' }] }) // userStats
      .mockResolvedValueOnce({ rows: [{ total_bookings: '500', completed_bookings: '300', cancelled_bookings: '50', pending_bookings: '150', total_revenue: '250000' }] }) // bookingStats
      .mockResolvedValueOnce({ rows: [{ bookings: '10', revenue: '5000', completed: '7', cancelled: '1' }] }) // todayBookingStats
      .mockResolvedValueOnce({ rows: [{ new_customers: '3', new_vendors: '1' }] }) // todayUserStats
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })  // pendingVendors
      .mockResolvedValueOnce({ rows: [] })                 // recentUsers
      .mockResolvedValueOnce({ rows: [mockBooking] })      // recentBookings
      .mockResolvedValueOnce({ rows: [] })                 // monthlyRevenue
      .mockResolvedValueOnce({ rows: [{ count: '8' }] })  // categoriesCount
      .mockResolvedValueOnce({ rows: [{ count: '40' }] }); // servicesCount

    // Act
    const res = await request(app).get('/api/admin/dashboard/stats').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  test('should return 401 without token', async () => {
    const res = await request(app).get('/api/admin/dashboard/stats');
    expect(res.statusCode).toBe(401);
  });

  test('should return 403 for non-admin user', async () => {
    const customerToken = jwt.sign({ userId: 1, userType: 'CUSTOMER', deviceId: 'dev-a' }, JWT_SECRET, { expiresIn: '1d' });
    dc();

    const res = await request(app).get('/api/admin/dashboard/stats').set(auth(customerToken));
    expect(res.statusCode).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/users
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/users', () => {
  test('should return paginated list of all users', async () => {
    // Arrange — response shape: { data: { users: [...], pagination: {...} } }
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '10' }] })
      .mockResolvedValueOnce({ rows: [mockUser, { ...mockUser, user_id: 6 }] });

    // Act
    const res = await request(app).get('/api/admin/users').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('users');
    expect(Array.isArray(res.body.data.users)).toBe(true);
    expect(res.body.data.pagination).toBeDefined();
  });

  test('should support user_type filter', async () => {
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [mockVendor] });

    const res = await request(app).get('/api/admin/users?user_type=VENDOR').set(auth(token));
    expect(res.statusCode).toBe(200);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/users/:id
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/users/:id', () => {
  test('should return user details by id', async () => {
    // Arrange
    const token = makeAdminToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [mockUser] });

    // Act
    const res = await request(app).get('/api/admin/users/5').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('user_id', 5);
  });

  test('should return 404 for non-existent user', async () => {
    const token = makeAdminToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/admin/users/9999').set(auth(token));
    expect(res.statusCode).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/users/:id/status
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/admin/users/:id/status', () => {
  test('should update user status to inactive', async () => {
    // Arrange — updateUserStatus: UPDATE user, then if inactive → SELECT fcm_token + fire-and-forget notification INSERT
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [] })   // UPDATE status
      .mockResolvedValueOnce({ rows: [] });  // SELECT fcm_token (no token → skip push)

    // Act
    const res = await request(app)
      .put('/api/admin/users/5/status')
      .set(auth(token))
      .send({ status: 'inactive' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should return 400 for invalid status value', async () => {
    const token = makeAdminToken();
    dc();

    const res = await request(app)
      .put('/api/admin/users/5/status')
      .set(auth(token))
      .send({ status: 'banned' });

    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/users/:id
// ──────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/admin/users/:id', () => {
  test('should soft-delete a user', async () => {
    // Arrange
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ user_type: 'CUSTOMER' }] }) // userCheck
      .mockResolvedValueOnce({ rows: [] }); // DELETE

    // Act
    const res = await request(app).delete('/api/admin/users/5').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/admin/users/admin  (SUPERADMIN only)
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/admin/users/admin', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = db.__mockClient;
    db.pool.connect.mockResolvedValue(mockClient);
  });

  test('should create a new admin user (SUPERADMIN)', async () => {
    // Arrange
    const token = makeSuperAdminToken();
    dcSA();
    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                   // BEGIN
      .mockResolvedValueOnce({ rows: [] })                   // existing user check
      .mockResolvedValueOnce({ rows: [{ user_id: 50 }] })   // INSERT user
      .mockResolvedValueOnce({ rows: [] })                   // INSERT profile
      .mockResolvedValueOnce({ rows: [] });                  // COMMIT

    // Act
    const res = await request(app)
      .post('/api/admin/users/admin')
      .set(auth(token))
      .send({ phone_number: '+919111111111', email: 'newadmin@test.com', password: 'Admin@123', name: 'New Admin' });

    // Assert
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('should return 403 when ADMIN (non-super) tries to create admin', async () => {
    const token = makeAdminToken(); // regular ADMIN, not SUPERADMIN
    dc();

    const res = await request(app)
      .post('/api/admin/users/admin')
      .set(auth(token))
      .send({ phone_number: '+919111111112', email: 'x@test.com', password: 'Pass@123', name: 'Admin' });

    expect(res.statusCode).toBe(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/vendors
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/vendors', () => {
  test('should return all vendors with their shop details', async () => {
    // Arrange — response shape: { data: { vendors: [...], pagination: {...} } }
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [mockVendor] });

    // Act
    const res = await request(app).get('/api/admin/vendors').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('vendors');
    expect(Array.isArray(res.body.data.vendors)).toBe(true);
  });

  test('should filter vendors by verification_status', async () => {
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [mockVendor] });

    const res = await request(app)
      .get('/api/admin/vendors?verification_status=pending')
      .set(auth(token));

    expect(res.statusCode).toBe(200);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/vendors/:id
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/vendors/:id', () => {
  test('should return vendor details by id', async () => {
    // Arrange — controller makes 3 db.query calls: vendor info, documents, services
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [mockVendor] })  // vendor info
      .mockResolvedValueOnce({ rows: [] })             // documents
      .mockResolvedValueOnce({ rows: [] });            // services

    // Act
    const res = await request(app).get('/api/admin/vendors/20').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('user_id', 20);
  });

  test('should return 404 for non-existent vendor', async () => {
    const token = makeAdminToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/admin/vendors/9999').set(auth(token));
    expect(res.statusCode).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/vendors/:id/verification
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/admin/vendors/:id/verification', () => {
  test('should approve a vendor', async () => {
    // Arrange — sequence for "approved":
    //   1. vendorCheck (SELECT user_id FROM users WHERE user_id AND user_type='VENDOR')
    //   2. shopCheck   (SELECT shop_id FROM vendor_shop_details WHERE user_id)
    //   3. docs check  (SELECT document_id, verification_status FROM vendor_documents)
    //      → empty array = no docs to validate, approval proceeds
    //   4. UPDATE vendor_shop_details
    //   5. INSERT notification (in-app, inside try/catch)
    //   6. SELECT fcm_token (inside nested try/catch — fails gracefully if no token)
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ user_id: 20 }] })                                          // vendorCheck
      .mockResolvedValueOnce({ rows: [{ shop_id: 1 }] })                                           // shopCheck
      .mockResolvedValueOnce({ rows: [] })                                                          // docs check (no docs → skip doc validation)
      .mockResolvedValueOnce({ rows: [{ ...mockVendor, verification_status: 'approved' }] })       // UPDATE
      .mockResolvedValueOnce({ rows: [] })                                                          // INSERT notification
      .mockResolvedValueOnce({ rows: [] });                                                         // SELECT fcm_token (empty → skip push)

    // Act
    const res = await request(app)
      .put('/api/admin/vendors/20/verification')
      .set(auth(token))
      .send({ verification_status: 'approved', admin_comments: 'All docs verified' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('should reject a vendor with admin comments', async () => {
    // Arrange — sequence for "rejected" (no docs check):
    //   vendorCheck → shopCheck → UPDATE → INSERT notification → SELECT fcm_token
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ user_id: 20 }] })
      .mockResolvedValueOnce({ rows: [{ shop_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ ...mockVendor, verification_status: 'rejected' }] })
      .mockResolvedValueOnce({ rows: [] })   // INSERT notification
      .mockResolvedValueOnce({ rows: [] });  // SELECT fcm_token

    // Act
    const res = await request(app)
      .put('/api/admin/vendors/20/verification')
      .set(auth(token))
      .send({ verification_status: 'rejected', admin_comments: 'Documents incomplete' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/vendors/:id/documents
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/vendors/:id/documents', () => {
  test('should return vendor documents', async () => {
    // Arrange
    const token = makeAdminToken();
    dc();
    db.query.mockResolvedValueOnce({
      rows: [{ document_id: 1, document_url: '/uploads/doc.pdf', document_type: 'license', verification_status: 'pending' }],
    });

    // Act
    const res = await request(app).get('/api/admin/vendors/20/documents').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/documents/:documentId/verification
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/admin/documents/:documentId/verification', () => {
  test('should verify a vendor document', async () => {
    // Arrange — controller requires body field "status" (not "verification_status"),
    //   valid values: 'approved' | 'rejected' | 'pending'.
    //   Single UPDATE query that returns vendor_id if found.
    const token = makeAdminToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [{ vendor_id: 20 }] }); // UPDATE RETURNING vendor_id

    // Act
    const res = await request(app)
      .put('/api/admin/documents/1/verification')
      .set(auth(token))
      .send({ status: 'approved', admin_comments: 'Valid document' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/documents/:documentId
// ──────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/admin/documents/:documentId', () => {
  test('should delete a vendor document', async () => {
    // Arrange
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ document_id: 1, vendor_id: 20, document_url: '/uploads/doc.pdf' }] })
      .mockResolvedValueOnce({ rows: [] }); // soft-delete

    // Act
    const res = await request(app).delete('/api/admin/documents/1').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/vendors/:id/services
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/vendors/:id/services', () => {
  test('should return vendor services for booking creation', async () => {
    // Arrange — response shape: { data: { services: [...] } }
    const token = makeAdminToken();
    dc();
    db.query.mockResolvedValueOnce({
      rows: [{ vendor_service_id: 1, service_name: 'Haircut', price: 300, is_available: true }],
    });

    // Act
    const res = await request(app).get('/api/admin/vendors/20/services').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('services');
    expect(Array.isArray(res.body.data.services)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/services
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/services', () => {
  test('should return all master services', async () => {
    // Arrange — response shape: { data: { services: [...], pagination: {...} } }
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [mockService] });

    // Act
    const res = await request(app).get('/api/admin/services').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('services');
    expect(Array.isArray(res.body.data.services)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/services/:id
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/services/:id', () => {
  test('should return a specific service by id', async () => {
    // Arrange
    const token = makeAdminToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [mockService] });

    // Act
    const res = await request(app).get('/api/admin/services/1').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('service_id', 1);
  });

  test('should return 404 for non-existent service', async () => {
    const token = makeAdminToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/admin/services/9999').set(auth(token));
    expect(res.statusCode).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/admin/services
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/admin/services', () => {
  test('should create a new master service', async () => {
    // Arrange — controller requires: service_name, category, base_price
    //   Direct INSERT (no duplicate check). 1 db.query call.
    const token = makeAdminToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [{ ...mockService, service_id: 1 }] }); // INSERT RETURNING

    // Act
    const res = await request(app)
      .post('/api/admin/services')
      .set(auth(token))
      .send({ service_name: 'Haircut', category: 'Hair', base_price: 300, description: 'Standard haircut' });

    // Assert
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('service_id');
  });

  test('should return 400 when name is missing', async () => {
    const token = makeAdminToken();
    dc();

    const res = await request(app)
      .post('/api/admin/services')
      .set(auth(token))
      .send({ category: 'Hair', base_price: 300 }); // service_name missing

    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/services/:id
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/admin/services/:id', () => {
  test('should update a master service', async () => {
    // Arrange — controller uses service_name (not name). 2 db.query calls:
    //   SELECT existing → UPDATE
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ service_id: 1 }] })                           // SELECT existing
      .mockResolvedValueOnce({ rows: [{ ...mockService, service_name: 'Premium Haircut' }] }); // UPDATE RETURNING

    // Act
    const res = await request(app)
      .put('/api/admin/services/1')
      .set(auth(token))
      .send({ service_name: 'Premium Haircut' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/services/:id
// ──────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/admin/services/:id', () => {
  test('should delete a master service', async () => {
    // Arrange
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [mockService] })
      .mockResolvedValueOnce({ rows: [] }); // soft-delete

    // Act
    const res = await request(app).delete('/api/admin/services/1').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/services/:id/availability
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/admin/services/:id/availability', () => {
  test('should toggle service availability', async () => {
    // Arrange
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [mockService] })
      .mockResolvedValueOnce({ rows: [{ ...mockService, is_available: false }] });

    // Act
    const res = await request(app)
      .put('/api/admin/services/1/availability')
      .set(auth(token))
      .send({ is_available: false });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/categories
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/categories', () => {
  test('should return all service categories', async () => {
    // Arrange — response shape: { data: { categories: [...], pagination: {...} } }
    //   Controller makes 2 db.query calls: COUNT then list
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [mockCategory, { ...mockCategory, category_id: 2, category_name: 'Beard' }] });

    // Act
    const res = await request(app).get('/api/admin/categories').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('categories');
    expect(Array.isArray(res.body.data.categories)).toBe(true);
    expect(res.body.data.categories.length).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/categories/:id
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/categories/:id', () => {
  test('should return category by id', async () => {
    // Arrange
    const token = makeAdminToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [mockCategory] });

    // Act
    const res = await request(app).get('/api/admin/categories/1').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('category_id', 1);
  });

  test('should return 404 for non-existent category', async () => {
    const token = makeAdminToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/admin/categories/9999').set(auth(token));
    expect(res.statusCode).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/admin/categories
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/admin/categories', () => {
  test('should create a new category', async () => {
    // Arrange — controller requires "category_name" (not "name"). 2 db.query calls:
    //   duplicate check → INSERT
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [] })                // duplicate check (none)
      .mockResolvedValueOnce({ rows: [mockCategory] });   // INSERT RETURNING

    // Act
    const res = await request(app)
      .post('/api/admin/categories')
      .set(auth(token))
      .send({ category_name: 'Hair', description: 'Hair services', icon: 'hair.png' });

    // Assert
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('category_id');
  });

  test('should return 400 when name is missing', async () => {
    const token = makeAdminToken();
    dc();

    const res = await request(app)
      .post('/api/admin/categories')
      .set(auth(token))
      .send({ description: 'No name provided' }); // category_name missing

    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/categories/:id
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/admin/categories/:id', () => {
  test('should update category name and icon', async () => {
    // Arrange — controller reads "category_name" (not "name"). 4 db.query calls:
    //   SELECT existing → duplicate check (name changed) → UPDATE → UPDATE services_master (cascade)
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ category_id: 1, category_name: 'Hair' }] })    // SELECT existing
      .mockResolvedValueOnce({ rows: [] })                                               // duplicate check
      .mockResolvedValueOnce({ rows: [{ ...mockCategory, category_name: 'Hair Care' }] }) // UPDATE
      .mockResolvedValueOnce({ rows: [] });                                              // UPDATE services_master

    // Act
    const res = await request(app)
      .put('/api/admin/categories/1')
      .set(auth(token))
      .send({ category_name: 'Hair Care' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/categories/:id
// ──────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/admin/categories/:id', () => {
  test('should delete a category', async () => {
    // Arrange — 3 db.query calls:
    //   SELECT existing → SELECT COUNT services using it (must be 0) → UPDATE soft-delete
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ category_id: 1, category_name: 'Hair' }] }) // SELECT existing
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })                             // COUNT services (0 → safe to delete)
      .mockResolvedValueOnce({ rows: [] });                                           // UPDATE soft-delete

    // Act
    const res = await request(app).delete('/api/admin/categories/1').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/bookings
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/bookings', () => {
  test('should return all platform bookings with pagination', async () => {
    // Arrange — response shape: { data: { bookings: [...], pagination: {...} } }
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '50' }] })
      .mockResolvedValueOnce({ rows: [mockBooking] });

    // Act
    const res = await request(app).get('/api/admin/bookings').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('bookings');
    expect(Array.isArray(res.body.data.bookings)).toBe(true);
  });

  test('should filter bookings by status', async () => {
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [mockBooking] });

    const res = await request(app)
      .get('/api/admin/bookings?booking_status=confirmed')
      .set(auth(token));

    expect(res.statusCode).toBe(200);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/admin/bookings/:id
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /api/admin/bookings/:id', () => {
  test('should return booking by id with services', async () => {
    // Arrange
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [mockBooking] })
      .mockResolvedValueOnce({ rows: [{ service_id: 1, service_name: 'Haircut', price: 300 }] });

    // Act
    const res = await request(app).get('/api/admin/bookings/500').set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('booking_id', 500);
  });

  test('should return 404 for non-existent booking', async () => {
    const token = makeAdminToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/admin/bookings/9999').set(auth(token));
    expect(res.statusCode).toBe(404);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/admin/bookings
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/admin/bookings', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = db.__mockClient;
    db.pool.connect.mockResolvedValue(mockClient);
  });

  test('should create a booking on behalf of a customer', async () => {
    // Arrange — admin createBooking uses client.query (transaction). Sequence:
    //   BEGIN → userCheck (must be CUSTOMER) → vendorCheck (must be approved) →
    //   INSERT booking → INSERT booking_services (per service) → COMMIT
    //
    // booking_date must be future. Services must include service_price.
    // vendorCheck must return { verification_status: 'approved' }.
    const token = makeAdminToken();
    const bDate = futureDate();
    dc();

    mockClient.query
      .mockResolvedValueOnce({ rows: [] })                                              // BEGIN
      .mockResolvedValueOnce({ rows: [{ user_id: 5, user_type: 'CUSTOMER' }] })        // userCheck
      .mockResolvedValueOnce({ rows: [{ user_id: 20, verification_status: 'approved' }] }) // vendorCheck
      .mockResolvedValueOnce({ rows: [{ booking_id: 500, vendor_id: 20, user_id: 5, booking_date: bDate, booking_status: 'confirmed', total_amount: 300 }] }) // INSERT booking
      .mockResolvedValueOnce({ rows: [] })                                              // INSERT booking_services
      .mockResolvedValueOnce({ rows: [] });                                             // COMMIT

    // Act
    const res = await request(app)
      .post('/api/admin/bookings')
      .set(auth(token))
      .send({
        customer_id:  5,
        vendor_id:    20,
        booking_date: bDate,
        services: [{
          service_id:       1,
          service_name:     'Haircut',
          service_price:    300,
          start_time:       '10:00',
          end_time:         '10:30',
          duration_minutes: 30,
        }],
      });

    // Assert
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/bookings/:id/status
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/admin/bookings/:id/status', () => {
  test('should update booking status', async () => {
    // Arrange — controller reads "booking_status" (not "status"). 2 db.query calls:
    //   SELECT existing → UPDATE RETURNING
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ booking_id: 500, booking_status: 'confirmed' }] })
      .mockResolvedValueOnce({ rows: [{ ...mockBooking, booking_status: 'completed' }] });

    // Act
    const res = await request(app)
      .put('/api/admin/bookings/500/status')
      .set(auth(token))
      .send({ booking_status: 'completed' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/bookings/:id/cancel
// ──────────────────────────────────────────────────────────────────────────────

describe('PUT /api/admin/bookings/:id/cancel', () => {
  test('should cancel a booking from admin panel', async () => {
    // Arrange — controller requires { cancellation_reason, cancelled_by } (not "reason").
    //   No pool.connect transaction. 2 db.query calls: SELECT existing → UPDATE RETURNING
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [{ booking_id: 500, booking_status: 'confirmed', payment_status: 'pending' }] }) // SELECT
      .mockResolvedValueOnce({ rows: [{ ...mockBooking, booking_status: 'cancelled' }] }); // UPDATE

    // Act
    const res = await request(app)
      .put('/api/admin/bookings/500/cancel')
      .set(auth(token))
      .send({ cancellation_reason: 'Admin override', cancelled_by: 'admin' });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/admin/vendors/:id/services/add
// ──────────────────────────────────────────────────────────────────────────────

describe('POST /api/admin/vendors/:id/services/add', () => {
  test('should add a service to a vendor from admin', async () => {
    // Arrange — controller: check existing → if none, INSERT (returns 201).
    //   2 db.query calls.
    const token = makeAdminToken();
    dc();
    db.query
      .mockResolvedValueOnce({ rows: [] })                              // existing check (none)
      .mockResolvedValueOnce({ rows: [{ vendor_service_id: 10 }] });   // INSERT

    // Act
    const res = await request(app)
      .post('/api/admin/vendors/20/services/add')
      .set(auth(token))
      .send({ service_id: 1, price: 350 });

    // Assert
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/vendors/:id/services/:serviceId
// ──────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/admin/vendors/:id/services/:serviceId', () => {
  test('should remove a service from vendor listing', async () => {
    // Arrange
    const token = makeAdminToken();
    dc();
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE soft-delete

    // Act
    const res = await request(app)
      .delete('/api/admin/vendors/20/services/1')
      .set(auth(token));

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
