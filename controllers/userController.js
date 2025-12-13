// controllers/userController.js
const User = require('../models/User');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const { bucket } = require('../config/initializeGCS');

// --- Helper function to generate a Signed URL ---
const getSignedUrl = async (profileImageUrl) => {
  if (!profileImageUrl) {
    return null;
  }
  // If it's already a full URL (public), just return it
  if (profileImageUrl.startsWith('http')) {
      return profileImageUrl;
  }
  
  try {
    const fileName = profileImageUrl.split('/').pop();
    const options = {
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    };
    const [url] = await bucket.file(fileName).getSignedUrl(options);
    return url;
  } catch (err) {
    console.error("Error generating signed URL:", err);
    return null;
  }
};

// @desc    Create a user
exports.createUser = async (req, res) => {
  const { name, userId, phone, email, password, role } = req.body;
  
  try {
    let profileImageUrl = null;
    
    if (req.file) {
      profileImageUrl = req.file.path; 
    }

    let user = await User.create({
      name,
      userId,
      phone,
      email,
      password,
      role,
      profileImageUrl 
    });

    let userResponse = user.toObject();
    
    // Generate URL for response
    userResponse.profileImageUrl = await getSignedUrl(user.profileImageUrl);

    res.status(201).json({ success: true, user: userResponse });

  } catch (err) {
    console.error(err);
    if (err.code === 11000) { 
      return res.status(400).json({ success: false, message: 'User ID, Phone, or Email already exists' });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};

// @desc    Get all users
exports.getUsers = async (req, res) => {
  let query = {};
  if (req.query.role) {
    query.role = req.query.role;
  }

  const sortCriteria = { isActive: -1, name: 1 }; 

  try {
    const users = await User.find(query)
      .select('-password')
      .sort(sortCriteria)
      .lean();

    for (let user of users) {
      user.profileImageUrl = await getSignedUrl(user.profileImageUrl);
    }

    res.status(200).json({ success: true, count: users.length, users });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc    Get single user
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password').lean();
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.profileImageUrl = await getSignedUrl(user.profileImageUrl);

    res.status(200).json({ success: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};


exports.updateUser = async (req, res) => {
  try {
    let user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // 1. Update basic fields
    const fields = ['name', 'userId', 'phone', 'email', 'role'];
    fields.forEach((field) => {
      if (req.body[field]) {
        user[field] = req.body[field];
      }
    });

    // 2. Variable to track what happened
    let successMessage = "User details updated (No password change)";

    // 3. Update Password
    if (req.body.password && req.body.password.trim().length > 0) {
      user.password = req.body.password; // Assign plain text
      successMessage = "✅ SERVER: Password Updated Successfully!"; // Custom message
    }

    // 4. Update Image
    if (req.file) {
      user.profileImageUrl = req.file.path;
    }

    // 5. Save (Triggers Hashing)
    await user.save();

    const userObj = user.toObject();
    
    // Send the custom message back to the app
    res.status(200).json({ success: true, user: userObj, message: successMessage });

  } catch (err) {
    console.error("Update Error:", err);
    res.status(400).json({ success: false, message: err.message });
  }
};

// ... (keep deleteUser)
// @desc    Delete user (Soft delete/Deactivate)
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Toggle active status
    user.isActive = !user.isActive;
    await user.save();
    
    res.status(200).json({ success: true, message: user.isActive ? 'User enabled' : 'User disabled' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};