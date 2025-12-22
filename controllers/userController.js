// controllers/userController.js
const User = require('../models/User');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const { bucket } = require('../config/initializeGCS');
const fs = require('fs');

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


// Helper function to upload base64 image to GCS
const uploadBase64ToGCS = async (base64String, userId) => {
  try {
    // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    // Determine file extension from base64 string or default to jpg
    let extension = '.jpg';
    if (base64String.includes('data:image/png')) {
      extension = '.png';
    } else if (base64String.includes('data:image/jpeg') || base64String.includes('data:image/jpg')) {
      extension = '.jpg';
    } else if (base64String.includes('data:image/webp')) {
      extension = '.webp';
    }
    
    const fileName = `profile_${userId}_${Date.now()}${extension}`;
    const file = bucket.file(fileName);

    await file.save(imageBuffer, {
      metadata: {
        contentType: `image/${extension.slice(1)}`,
      },
      resumable: false,
    });

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    console.log(`Base64 image uploaded to GCS: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.error('GCS Base64 Upload Error:', error);
    throw error;
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

    // 4. Update Image - Handle both multipart file and base64
    if (req.file) {
      // Multipart file upload (existing method)
      user.profileImageUrl = req.file.path;
    } else if (req.body.profileImageBase64) {
      // Base64 image upload (new method for Flutter app)
      try {
        const imageUrl = await uploadBase64ToGCS(req.body.profileImageBase64, user._id.toString());
        user.profileImageUrl = imageUrl;
      } catch (uploadError) {
        console.error('Failed to upload base64 image:', uploadError);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to upload profile image. Please try again.' 
        });
      }
    }

    // 5. Save (Triggers Hashing)
    await user.save();

    const userObj = user.toObject();
    userObj.profileImageUrl = await getSignedUrl(user.profileImageUrl);
    
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