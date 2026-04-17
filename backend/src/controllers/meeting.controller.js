const { query, getClient } = require('../config/database');

async function startMeeting(req, res) {
  const { roomId } = req.body;
  const hostId = req.user.userId;

  try {
    const roomResult = await query(
      'SELECT id, max_participants FROM rooms WHERE id = $1 AND is_active = true',
      [roomId]
    );
    if (roomResult.rows.length === 0) return res.status(404).json({ error: 'Room not found' });

    const result = await query(
      'INSERT INTO meetings (room_id, host_id) VALUES ($1, $2) RETURNING *',
      [roomId, hostId]
    );
    res.status(201).json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to start meeting' });
  }
}

async function endMeeting(req, res) {
  const { id } = req.params;
  const userId = req.user.userId;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const meetingResult = await client.query(
      'SELECT * FROM meetings WHERE id = $1 AND host_id = $2 AND ended_at IS NULL',
      [id, userId]
    );
    if (meetingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Forbidden or meeting already ended' });
    }

    const started = new Date(meetingResult.rows[0].started_at);
    const duration = Math.floor((Date.now() - started.getTime()) / 1000);

    await client.query(
      'UPDATE meetings SET ended_at = NOW(), duration = $1 WHERE id = $2',
      [duration, id]
    );

    // Update lingering participants
    await client.query(
      `UPDATE meeting_participants
       SET left_at = NOW(), duration = EXTRACT(EPOCH FROM (NOW() - joined_at))::INT
       WHERE meeting_id = $1 AND left_at IS NULL`,
      [id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Meeting ended', duration });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to end meeting' });
  } finally {
    client.release();
  }
}

async function getMeetingHistory(req, res) {
  const userId = req.user.userId;
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    const result = await query(
      `SELECT m.*, r.name AS room_name, r.room_code,
              u.name AS host_name
       FROM meetings m
       JOIN rooms r ON m.room_id = r.id
       JOIN users u ON m.host_id = u.id
       WHERE m.host_id = $1
       ORDER BY m.started_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, parseInt(limit), offset]
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
}

async function getMeetingMessages(req, res) {
  const { id } = req.params;
  try {
    const result = await query(
      `SELECT cm.*, u.name AS user_name, u.avatar
       FROM chat_messages cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.meeting_id = $1
       ORDER BY cm.created_at ASC`,
      [id]
    );
    res.json(result.rows);
  } catch {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
}

module.exports = { startMeeting, endMeeting, getMeetingHistory, getMeetingMessages };
