// routes/users.js
const express = require('express');
const {
  createUser,
  getUsers,
  getUser,
  updateUser,
  deleteUser
} = require('../controllers/userController');
// ✅ 1. Import our new middleware object
const { uploadImage, uploadToGCS } = require('../middleware/upload');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes below are protected
router.use(protect);
// All routes below are only for admin/management
router.use(authorize('admin', 'management'));

router.route('/')
  // ✅ 2. Use the two middlewares in order
  .post(uploadImage, uploadToGCS, createUser) 
  .get(getUsers);

router.route('/:id')
  .get(getUser)
  .put(updateUser)
  .delete(deleteUser);

module.exports = router;