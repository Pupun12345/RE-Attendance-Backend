// controllers/userController.js
const User = require('../models/User');
const { Storage } = require('@google-cloud/storage');
const path = require('path');

// Initialize GCS
const gcs = new Storage({
  projectId: process.env.GCP_PROJECT_ID, // Use env var for safety
  keyFilename: path.join(__dirname, '../config/gcs-key.json') 
});
const bucketName = 'reattendance-profile-images';
const bucket = gcs.bucket(bucketName);

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

exports.createUser = async (req, res) => {
  const { name, userId, phone, email, password, role } = req.body;
  
  try {
    let profileImageUrl = null;
    
    // ✅ CHECK IF FILE EXISTS BEFORE ACCESSING .path
    if (req.file) {
      profileImageUrl = req.file.path; 
      console.log("File uploaded:", req.file.path); // Moved inside the check
    }

    // ❌ REMOVED THE CRASHING LINE: console.log(req.file.path)

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
  query.isActive = true; 
  
  try {
    const users = await User.find(query).select('-password').lean();

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

// @desc    Update user
exports.updateUser = async (req, res) => {
  try {
    const { password, ...body } = req.body;
    
    const user = await User.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true,
    }).lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.profileImageUrl = await getSignedUrl(user.profileImageUrl);
    
    res.status(200).json({ success: true, user });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// @desc    Delete user
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { isActive: false });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.status(200).json({ success: true, message: 'User disabled' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};