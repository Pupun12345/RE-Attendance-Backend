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
  // Normal Supervisor Checkin/out
  supervisorCheckInWorker, 
  supervisorCheckOutWorker,
  // Offline Sync Checkin/out
  supervisorCreatePendingCheckIn,
  supervisorCreatePendingCheckOut,
  selfCreatePendingCheckIn, 
  selfCreatePendingCheckOut 
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

// 1. API: Supervisor performing Check-In/Out for a Worker (Normal Network)
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

// API: Offline Sync Endpoints (Creates Pending Requests)
router.post(
  '/supervisor/checkin-pending', 
  authorize('supervisor', 'management'), 
  uploadAttendanceImage, 
  uploadToGCS, 
  supervisorCreatePendingCheckIn
);

router.post(
  '/supervisor/checkout-pending', 
  authorize('supervisor', 'management'), 
  uploadAttendanceImage, 
  uploadToGCS, 
  supervisorCreatePendingCheckOut
);

// --- Self Attendance (For Supervisor/Management personal attendance) ---
router.post('/checkin', authorize('supervisor', 'management'), uploadAttendanceImage, uploadToGCS, selfCheckIn);
router.post('/checkout', authorize('supervisor', 'management'), uploadAttendanceImage, uploadToGCS, selfCheckOut);

// OFFLINE SELF-ATTENDANCE ROUTES
router.post(
  '/checkin-pending', 
  authorize('supervisor', 'management', 'worker'), 
  uploadAttendanceImage, 
  uploadToGCS, 
  selfCreatePendingCheckIn
);

router.post(
  '/checkout-pending', 
  authorize('supervisor', 'management', 'worker'), 
  uploadAttendanceImage, 
  uploadToGCS, 
  selfCreatePendingCheckOut
);
module.exports = router;