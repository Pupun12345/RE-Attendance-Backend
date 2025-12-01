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

// Import upload middleware
const { uploadAttendanceImage, uploadToGCS } = require('../middleware/upload');

const router = express.Router();

// All routes below are protected
router.use(protect);

// --- Routes for Admin/Management ---
router.get('/summary/today', authorize('admin', 'management'), getTodaySummary);
router.get('/pending', authorize('admin', 'management'), getPendingAttendance);
router.put('/:id/approve', authorize('admin', 'management'), approveAttendance);
router.put('/:id/reject', authorize('admin', 'management'), rejectAttendance);

// --- Routes for Supervisor ---
router.get('/status/today', authorize('supervisor'), getDailyStatusReport);
router.post('/mark', authorize('supervisor'), markWorkerAttendance);

// --- Routes for Supervisor/Management (Self-Attendance) ---
// We apply upload middleware only to the routes that need it.
router.post('/checkin', authorize('supervisor', 'management'), uploadAttendanceImage, uploadToGCS, selfCheckIn);
router.post('/checkout', authorize('supervisor', 'management'), uploadAttendanceImage, uploadToGCS, selfCheckOut);


module.exports = router;