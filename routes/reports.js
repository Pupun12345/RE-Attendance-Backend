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
router.use(authorize('admin', 'management'));

router.get('/attendance/daily', getDailyAttendance);
router.get('/attendance/monthly', getMonthlySummary);
router.get('/complaints', getComplaintReport);

module.exports = router;