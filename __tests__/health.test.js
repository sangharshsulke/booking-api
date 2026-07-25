/**
 * Health Check & Server Tests
 * Routes:
 *   GET /health
 *   GET /unknown-route  → 404
 */

const request = require('supertest');
const app     = require('../server');

describe('GET /health', () => {
  test('should return 200 with server running message', async () => {
    // Act
    const res = await request(app).get('/health');

    // Assert
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/running/i);
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('404 Handler', () => {
  test('should return 404 for unknown routes', async () => {
    // Act
    const res = await request(app).get('/api/nonexistent-route');

    // Assert
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/not found/i);
  });

  test('should return 404 for unknown POST routes', async () => {
    const res = await request(app)
      .post('/api/totally-unknown')
      .send({ data: 'test' });

    expect(res.statusCode).toBe(404);
  });
});
