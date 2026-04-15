// models/Holiday.js
const mongoose = require('mongoose');

const holidaySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    required: true,
    unique: true,
  },
  type: {
    type: String,
    enum: ['national', 'company'],
    default: 'company',
  }
});

module.exports = mongoose.model('Holiday', holidaySchema);