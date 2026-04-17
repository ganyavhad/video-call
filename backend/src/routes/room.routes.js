const { Router } = require('express');
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth.middleware');
const {
  createRoom, getRooms, getRoomByCode, getRoomById, updateRoom, deleteRoom
} = require('../controllers/room.controller');

const router = Router();

router.use(authenticate);

router.post('/', [
  body('name').trim().isLength({ min: 3, max: 200 }).escape(),
  body('maxParticipants').optional().isInt({ min: 2, max: 200 }),
], createRoom);

router.get('/', getRooms);
router.get('/code/:code', [
  param('code').matches(/^[A-Z0-9]{3}-[A-Z0-9]{3}-[A-Z0-9]{3}$/)
], getRoomByCode);
router.get('/:id', getRoomById);
router.put('/:id', [
  body('name').optional().trim().isLength({ min: 3, max: 200 }).escape(),
  body('maxParticipants').optional().isInt({ min: 2, max: 200 }),
], updateRoom);
router.delete('/:id', deleteRoom);

module.exports = router;
