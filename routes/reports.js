// routes/reports.js
const express = require('express');
const {
  getDailyAttendance,
  getMonthlySummary,
  getComplaintReport
} = require('../controllers/reportController');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

// Daily attendance: accessible to admin, management, and supervisors
router.get('/attendance/daily', authorize('admin', 'management', 'supervisor'), getDailyAttendance);

// Monthly summary and complaints: only admin and management
router.use(authorize('admin', 'management'));
router.get('/attendance/monthly', getMonthlySummary);
router.get('/complaints', getComplaintReport);

module.exports = router;