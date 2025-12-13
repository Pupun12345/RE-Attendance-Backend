// routes/complaints.js
const express = require('express');
const { getComplaints, updateComplaint, createComplaint } = require('../controllers/complaintController');
const { protect, authorize } = require('../middleware/auth');
// --- 1. IMPORT THE MIDDLEWARE ---
const { uploadComplaintImage, uploadToGCS } = require('../middleware/upload');

const router = express.Router();

router.use(protect);

// Supervisors & Management can POST (create)
router.route('/')
  // --- 2. ADD THE MIDDLEWARE HERE ---
  .post(
    authorize('supervisor', 'management'), 
    uploadComplaintImage, 
    uploadToGCS, 
    createComplaint
  )
  .get(authorize('admin', 'management', 'supervisor'), getComplaints); // Admin/Management/Supervisor can GET

// Admin/Management can PUT (update)
router.route('/:id')
  .put(authorize('admin', 'management'), updateComplaint);

module.exports = router;