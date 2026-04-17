const request = require('supertest');
const app = require('../src/app');

// Mock database
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const { query } = require('../src/config/database');

describe('Auth Routes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('POST /api/auth/register', () => {
    it('should reject missing fields', async () => {
      const res = await request(app).post('/api/auth/register').send({});
      expect(res.status).toBe(400);
    });

    it('should reject weak password', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: 'test@example.com',
        password: 'weak',
        name: 'Test',
      });
      expect(res.status).toBe(400);
    });

    it('should reject duplicate email', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: '1' }] }); // email exists
      const res = await request(app).post('/api/auth/register').send({
        email: 'test@example.com',
        password: 'Password123',
        name: 'Test User',
      });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/auth/login', () => {
    it('should reject missing credentials', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
    });

    it('should return 401 for unknown user', async () => {
      query.mockResolvedValueOnce({ rows: [] }); // user not found
      const res = await request(app).post('/api/auth/login').send({
        email: 'unknown@example.com',
        password: 'Password123',
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/health', () => {
    it('should return 200 OK', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
    });
  });
});

describe('Room Routes', () => {
  it('should require authentication', async () => {
    const res = await request(app).get('/api/rooms');
    expect(res.status).toBe(401);
  });

  it('should reject invalid room code format', async () => {
    const res = await request(app).get('/api/rooms/code/INVALID');
    expect(res.status).toBe(401); // auth check first
  });
});
