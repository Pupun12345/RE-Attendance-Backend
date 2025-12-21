// controllers/complaintController.js
const Complaint = require('../models/Complaint');

// @desc    Get all complaints
// @route   GET /api/v1/complaints
exports.getComplaints = async (req, res) => {
  let query = {};
  if (req.query.status) {
    query.status = req.query.status;
  }
  
  try {
    const complaints = await Complaint.find(query).populate('user', 'name userId');
    res.status(200).json({ success: true, count: complaints.length, complaints });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc    Update complaint status
// @route   PUT /api/v1/complaints/:id
exports.updateComplaint = async (req, res) => {
  // ... (this function is fine, no changes)
  const { status } = req.body;
  if (!status || !['pending', 'in_progress', 'resolved'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }

  try {
    const complaint = await Complaint.findByIdAndUpdate(
      req.params.id, 
      { status }, 
      { new: true }
    );
    
    if (!complaint) {
      return res.status(404).json({ success: false, message: 'Complaint not found' });
    }
    res.status(200).json({ success: true, complaint });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc    Create a complaint
// @route   POST /api/v1/complaints
// @access  Protected (Supervisor, Management)
exports.createComplaint = async (req, res) => {
  const { title, description, workerId } = req.body;

  try {
    let targetUserId = req.user.id;
    let submittedBy = null;

    if (workerId && ['supervisor', 'management', 'admin'].includes(req.user.role)) {
      targetUserId = workerId;
      submittedBy = req.user.id;
    }

    const complaintData = {
      title,
      description,
      user: targetUserId,
      submittedBy: submittedBy
    };

    // Fix: Check if image was uploaded and path is set by uploadToGCS middleware
    if (req.file && req.file.path) {
      complaintData.imageUrl = req.file.path;
    }

    const complaint = await Complaint.create(complaintData);
    res.status(201).json({ success: true, data: complaint });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};