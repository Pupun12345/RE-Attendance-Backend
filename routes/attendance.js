// routes/attendance.js
const express = require('express');
const {
  getPendingAttendance,
  approveAttendance,
  rejectAttendance,
  getTodaySummary,
  selfCheckIn,
  selfCheckOut,
  getDailyStatusReport,
  markWorkerAttendance
} = require('../controllers/attendanceController');
const { protect, authorize } = require('../middleware/auth');
const { uploadAttendanceImage, uploadToGCS } = require('../middleware/upload');

const router = express.Router();

router.use(protect);

// ✅ FIXED: All roles (Admin, Management, Supervisor) can view the summary
router.get('/summary/today', authorize('admin', 'management', 'supervisor'), getTodaySummary);

// --- Admin/Management Only ---
router.get('/pending', authorize('admin', 'management'), getPendingAttendance);
router.put('/:id/approve', authorize('admin', 'management'), approveAttendance);
router.put('/:id/reject', authorize('admin', 'management'), rejectAttendance);

// --- Supervisor Only ---
router.get('/status/today', authorize('supervisor'), getDailyStatusReport);
router.post('/mark', authorize('supervisor'), markWorkerAttendance);

// --- Self Attendance ---
router.post('/checkin', authorize('supervisor', 'management'), uploadAttendanceImage, uploadToGCS, selfCheckIn);
router.post('/checkout', authorize('supervisor', 'management'), uploadAttendanceImage, uploadToGCS, selfCheckOut);

module.exports = router;