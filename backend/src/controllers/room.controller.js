const { query } = require('../config/database');
const { validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

function generateRoomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 9; i++) {
    if (i === 3 || i === 6) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function createRoom(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, description, maxParticipants = 50, settings } = req.body;
  const hostId = req.user.userId;

  try {
    let roomCode;
    let codeExists = true;
    while (codeExists) {
      roomCode = generateRoomCode();
      const exists = await query('SELECT id FROM rooms WHERE room_code = $1', [roomCode]);
      codeExists = exists.rows.length > 0;
    }

    const result = await query(
      `INSERT INTO rooms (name, description, room_code, host_id, max_participants, settings)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, description, roomCode, hostId, maxParticipants, JSON.stringify(settings || {})]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create room' });
  }
}

async function getRooms(req, res) {
  const userId = req.user.userId;
  try {
    const result = await query(
      `SELECT r.*, u.name AS host_name
       FROM rooms r
       JOIN users u ON r.host_id = u.id
       WHERE r.host_id = $1 AND r.is_active = true
       ORDER BY r.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
}

async function getRoomByCode(req, res) {
  const { code } = req.params;
  try {
    const result = await query(
      `SELECT r.*, u.name AS host_name
       FROM rooms r
       JOIN users u ON r.host_id = u.id
       WHERE r.room_code = $1 AND r.is_active = true`,
      [code.toUpperCase()]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Room not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to fetch room' });
  }
}

async function getRoomById(req, res) {
  const { id } = req.params;
  try {
    const result = await query(
      `SELECT r.*, u.name AS host_name
       FROM rooms r
       JOIN users u ON r.host_id = u.id
       WHERE r.id = $1 AND r.is_active = true`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Room not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to fetch room' });
  }
}

async function updateRoom(req, res) {
  const { id } = req.params;
  const userId = req.user.userId;
  const { name, description, maxParticipants, isLocked, settings } = req.body;

  try {
    const existing = await query('SELECT id FROM rooms WHERE id = $1 AND host_id = $2', [id, userId]);
    if (existing.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });

    const result = await query(
      `UPDATE rooms SET name = COALESCE($1, name),
       description = COALESCE($2, description),
       max_participants = COALESCE($3, max_participants),
       is_locked = COALESCE($4, is_locked),
       settings = COALESCE($5::jsonb, settings)
       WHERE id = $6 RETURNING *`,
      [name, description, maxParticipants, isLocked, settings ? JSON.stringify(settings) : null, id]
    );
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to update room' });
  }
}

async function deleteRoom(req, res) {
  const { id } = req.params;
  const userId = req.user.userId;

  try {
    const result = await query(
      'UPDATE rooms SET is_active = false WHERE id = $1 AND host_id = $2 RETURNING id',
      [id, userId]
    );
    if (result.rows.length === 0) return res.status(403).json({ error: 'Forbidden' });
    res.json({ message: 'Room deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete room' });
  }
}

module.exports = { createRoom, getRooms, getRoomByCode, getRoomById, updateRoom, deleteRoom };
