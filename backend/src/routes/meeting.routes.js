const { Router } = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const { startMeeting, endMeeting, getMeetingHistory, getMeetingMessages } = require('../controllers/meeting.controller');

const router = Router();

router.use(authenticate);

router.post('/start', startMeeting);
router.patch('/:id/end', endMeeting);
router.get('/history', getMeetingHistory);
router.get('/:id/messages', getMeetingMessages);

module.exports = router;
