// routes/attendance.js
const express = require('express');
const {
  getTodaySummary,
  selfCheckIn,
  selfCheckOut,
  getDailyStatusReport,
  markWorkerAttendance,
  // Supervisor Checkin/out
  supervisorCheckInWorker,
  supervisorCheckOutWorker,
} = require('../controllers/attendanceController');
const { protect, authorize } = require('../middleware/auth');
const { uploadAttendanceImage, uploadToGCS } = require('../middleware/upload');

const router = express.Router();

router.use(protect);

// --- Dashboard & Summary (Visible to all authorized roles) ---
router.get('/summary/today', authorize('admin', 'management', 'supervisor'), getTodaySummary);

// --- Supervisor Routes ---
router.get('/status/today', authorize('supervisor'), getDailyStatusReport);
router.post('/mark', authorize('supervisor'), markWorkerAttendance);

// API: Supervisor performing Check-In/Out for a Worker
router.post(
  '/supervisor/checkin',
  authorize('admin', 'supervisor', 'management'),
  uploadAttendanceImage,
  uploadToGCS,
  supervisorCheckInWorker
);

router.post(
  '/supervisor/checkout',
  authorize('admin', 'supervisor', 'management'),
  uploadAttendanceImage,
  uploadToGCS,
  supervisorCheckOutWorker
);

// --- Self Attendance (For Supervisor/Management personal attendance) ---
router.post('/checkin', authorize('admin', 'supervisor', 'management'), uploadAttendanceImage, uploadToGCS, selfCheckIn);
router.post('/checkout', authorize('admin', 'supervisor', 'management'), uploadAttendanceImage, uploadToGCS, selfCheckOut);

module.exports = router;
