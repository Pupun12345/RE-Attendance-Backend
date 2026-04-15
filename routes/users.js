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
  // Allow 'supervisor' to GET (view) the user list
  .get(authorize('admin', 'management', 'supervisor'), getUsers)
  
  // Keep POST (create) restricted to Admin/Management
  .post(authorize('admin', 'management'), uploadImage, uploadToGCS, createUser);

router.route('/:id')
  // Allow 'supervisor' to GET (view) single user details
  .get(authorize('admin', 'management', 'supervisor'), getUser)
  
  // UPDATE ROUTE: Added 'uploadImage' and 'uploadToGCS' here
  .put(authorize('admin', 'management'), uploadImage, uploadToGCS, updateUser)
  
  // DELETE ROUTE
  .delete(authorize('admin', 'management'), deleteUser);

module.exports = router;