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
  markWorkerAttendance,
  supervisorCheckInWorker,  // ✅ New
  supervisorCheckOutWorker  // ✅ New
} = require('../controllers/attendanceController');
const { protect, authorize } = require('../middleware/auth');
const { uploadAttendanceImage, uploadToGCS } = require('../middleware/upload');

const router = express.Router();

router.use(protect);

// --- Dashboard & Summary (Visible to all authorized roles) ---
router.get('/summary/today', authorize('admin', 'management', 'supervisor'), getTodaySummary);

// --- Admin/Management Only ---
router.get('/pending', authorize('admin', 'management'), getPendingAttendance);
router.put('/:id/approve', authorize('admin', 'management'), approveAttendance);
router.put('/:id/reject', authorize('admin', 'management'), rejectAttendance);

// --- Supervisor Routes ---
router.get('/status/today', authorize('supervisor'), getDailyStatusReport);
router.post('/mark', authorize('supervisor'), markWorkerAttendance);

// ✅ NEW: Supervisor performing Check-In/Out for a Worker (with Image)
router.post(
  '/supervisor/checkin', 
  authorize('supervisor', 'management'), 
  uploadAttendanceImage, 
  uploadToGCS, 
  supervisorCheckInWorker
);

router.post(
  '/supervisor/checkout', 
  authorize('supervisor', 'management'), 
  uploadAttendanceImage, 
  uploadToGCS, 
  supervisorCheckOutWorker
);

// --- Self Attendance (For Supervisor/Management personal attendance) ---
router.post('/checkin', authorize('supervisor', 'management'), uploadAttendanceImage, uploadToGCS, selfCheckIn);
router.post('/checkout', authorize('supervisor', 'management'), uploadAttendanceImage, uploadToGCS, selfCheckOut);

module.exports = router;