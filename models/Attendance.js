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
  status: {
    type: String,
    enum: ['present', 'absent', 'leave', 'pending', 'rejected'], // ADDED 'pending' and 'rejected'
    default: 'absent',
  },
  notes: { // Optional: Good for users to add a reason for manual request
    type: String,
  },
  checkInLocation: {
    longitude: {
      type: String,
      default: null,
    },
    latitude: {
      type: String,
      default: null,
    },
    address: {
      type: String,
      default: null,
    }
  },
  checkOutLocation: {
    longitude: {
      type: String,
      default: null,
    },
    latitude: {
      type: String,
      default: null,
    },
    address: {
      type: String,
      default: null,
    }
  },
  checkInSelfie: {
    type: String,
    default: null,
  },
  checkOutSelfie: {
    type: String,
    default: null,
  }
}, { timestamps: true });

module.exports = mongoose.model('Attendance', attendanceSchema);