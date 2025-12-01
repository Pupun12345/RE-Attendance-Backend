// controllers/userController.js
const User = require('../models/User');
const { Storage } = require('@google-cloud/storage'); // ✅ 1. Import GCS
const path = require('path');

// ✅ 2. Initialize GCS (same as in middleware/upload.js)
const gcs = new Storage({
  projectId: 'YOUR-GCP-PROJECT-ID', // <-- Replace with your Project ID
  keyFilename: path.join(__dirname, '../config/gcs-key.json') 
});
const bucketName = 'reattendance-profile-images'; // <-- Your bucket name
const bucket = gcs.bucket(bucketName);

// --- Helper function to generate a Signed URL ---
const getSignedUrl = async (profileImageUrl) => {
  if (!profileImageUrl) {
    return null;
  }
  
  try {
    // Get the filename from the full URL
    const fileName = profileImageUrl.split('/').pop();
    
    const options = {
      version: 'v4',
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
    };

    // Get a v4 signed URL for reading the file
    const [url] = await bucket.file(fileName).getSignedUrl(options);
    return url;

  } catch (err) {
    console.error("Error generating signed URL:", err);
    return null; // Return null if GCS fails
  }
};
// --- End Helper ---


exports.createUser = async (req, res) => {
  const { name, userId, phone, email, password, role } = req.body;
  
  try {
    let profileImageUrl = null;
    if (req.file) {
      // req.file.path is the public URL from GCS middleware
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

    // ✅ 3. Convert to a plain object to send back
    let userResponse = user.toObject();
    
    // ✅ 4. Generate a new signed URL for the response
    userResponse.profileImageUrl = await getSignedUrl(user.profileImageUrl);

    res.status(201).json({ success: true, user: userResponse }); // Send the modified object

  } catch (err) {
    console.error(err);
    if (err.code === 11000) { 
      return res.status(400).json({ success: false, message: 'User ID, Phone, or Email already exists' });
    }
    res.status(400).json({ success: false, message: err.message });
  }
};


// @desc    Get all users (with filter)
// @route   GET /api/v1/users
exports.getUsers = async (req, res) => {
  let query = {};
  if (req.query.role) {
    query.role = req.query.role;
  }
  query.isActive = true; 
  
  try {
    const users = await User.find(query).select('-password').lean(); // ✅ Use .lean() to get plain objects

    // ✅ 5. Loop and generate signed URLs for all users
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
// @route   GET /api/v1/users/:id
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password').lean(); // ✅ Use .lean()
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // ✅ 6. Generate signed URL for the single user
    user.profileImageUrl = await getSignedUrl(user.profileImageUrl);

    res.status(200).json({ success: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
};

// @desc    Update user
// @route   PUT /api/v1/users/:id
exports.updateUser = async (req, res) => {
  try {
    // Exclude password from body, it should be updated via a separate route
    const { password, ...body } = req.body;
    
    const user = await User.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true,
    }).lean(); // ✅ Use .lean()

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // ✅ 7. Generate signed URL for the updated user
    user.profileImageUrl = await getSignedUrl(user.profileImageUrl);
    
    res.status(200).json({ success: true, user });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// @desc    Delete user (set inactive)
// @route   DELETE /api/v1/users/:id
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