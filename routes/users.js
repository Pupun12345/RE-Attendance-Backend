// routes/users.js
const express = require('express');
const {
  createUser,
  getUsers,
  getUser,
  updateUser,
  deleteUser
} = require('../controllers/userController');
const { uploadImage, uploadToGCS } = require('../middleware/upload');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes below are protected (User must be logged in)
router.use(protect);

// --- Routes ---

router.route('/')
  // ✅ 1. Allow 'supervisor' to GET (view) the user list
  // - Fixed restriction here
  .get(authorize('admin', 'management', 'supervisor'), getUsers)
  
  // 🔒 2. Keep POST (create) restricted to Admin/Management
  .post(authorize('admin', 'management'), uploadImage, uploadToGCS, createUser);

router.route('/:id')
  // ✅ 3. Allow 'supervisor' to GET (view) single user details
  .get(authorize('admin', 'management', 'supervisor'), getUser)
  
  // 🔒 4. Keep PUT (update) and DELETE restricted to Admin/Management
  .put(authorize('admin', 'management'), updateUser)
  .delete(authorize('admin', 'management'), deleteUser);

module.exports = router;