// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
  },
  userId: {
    type: String,
    required: [true, 'User ID is required'],
    unique: true,
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
  },
  email: {
    type: String,
    unique: true,
    sparse: true,
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6,
  },
  role: {
    type: String,
    enum: ['worker', 'supervisor', 'management', 'admin'],
    required: true,
  },
  designation: {
    type: String,
    default: null,
  },
  profileImageUrl: {
    type: String,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  }, // <--- The comma was missing here

  // New fields for password reset
  passwordResetToken: {
    type: String,
  },
  passwordResetExpires: {
    type: Date,
  },
  
}, { timestamps: true }); // This line is now correct

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);