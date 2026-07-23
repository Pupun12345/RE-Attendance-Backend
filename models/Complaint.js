// models/Complaint.js
const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema({
  user: { // The WORKER (person who has the issue)
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true,
  },
  submittedBy: { //NEW: The SUPERVISOR (person who submitted it)
    type: mongoose.Schema.ObjectId,
    ref: 'User',
  },
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'resolved'],
    default: 'pending',
  },
  imageUrl: {
    type: String,
  }
}, { timestamps: true });

complaintSchema.index({ status: 1, createdAt: -1 });
complaintSchema.index({ user: 1 });

module.exports = mongoose.model('Complaint', complaintSchema);