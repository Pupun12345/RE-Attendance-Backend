// models/Attendance.js
const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
  checkInTime: {
    type: Date,
  },
  checkOutTime: {
    type: Date,
  },
  checkInLocation: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  checkOutLocation: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  checkInSelfie: {
    type: String,
    default: null
  },
  checkOutSelfie: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['present', 'absent', 'leave'],
    default: 'absent',
  },
  notes: { // Optional: Good for users to add a reason for manual request
    type: String,
  }
}, { timestamps: true });

// Every attendance query filters by user+date or by status; index both.
attendanceSchema.index({ user: 1, date: -1 });
attendanceSchema.index({ status: 1, date: -1 });

module.exports = mongoose.model('Attendance', attendanceSchema);