// routes/overtime.js
const express = require('express');
const {
  getOvertimeRequests,
  approveOvertime,
  rejectOvertime,
  createOvertimeRequest
} = require('../controllers/overtimeController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes are protected
router.use(protect);

// Route for any user to create a request
router.route('/')
  .post(createOvertimeRequest);

// Routes below are only for admin/management
router.use(authorize('admin', 'management'));

router.route('/')
  .get(getOvertimeRequests); // Admin gets all (can filter by status)

router.route('/:id/approve')
  .put(approveOvertime);
  
router.route('/:id/reject')
  .put(rejectOvertime);

module.exports = router;