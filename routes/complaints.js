// routes/complaints.js
const express = require('express');
const { getComplaints, updateComplaint, createComplaint } = require('../controllers/complaintController');
const { protect, authorize } = require('../middleware/auth');
const { uploadComplaintImage, uploadToGCS } = require('../middleware/upload');

const router = express.Router();

router.use(protect);

// Supervisors & Management can POST (create)
router.route('/')
  .post(
    authorize('supervisor', 'management'), 
    uploadComplaintImage, 
    uploadToGCS, 
    createComplaint
  )
  .get(authorize('admin', 'management', 'supervisor'), getComplaints);

// Admin/Management can PUT (update)
router.route('/:id')
  .put(authorize('admin', 'management'), updateComplaint);

module.exports = router;