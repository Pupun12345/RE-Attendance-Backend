// middleware/upload.js
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {configDotenv} = require ('dotenv')
const { bucket, isGCSConfigured } = require('../config/initializeGCS');

configDotenv()

// Create uploads directory if it doesn't exist (for local fallback)
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// --- 1. Configuration ---

// Initialize GCS Storage


// Configure Multer to use memory storage
const multerStorage = multer.memoryStorage();

// Multer filter to allow images OR generic streams
const fileFilter = (req, file, cb) => {
  const isImage = file.mimetype.startsWith('image/');
  const isGenericStream = file.mimetype === 'application/octet-stream';

  if (isImage || isGenericStream) {
    cb(null, true); // Accept the file
  } else {
    console.warn(`File rejected: Invalid mimetype ${file.mimetype}`);
    cb('Error: Images Only!', false); // Reject it
  }
};

// Create the Multer upload instance
const upload = multer({
  storage: multerStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for image uploads
  },
});

// --- 2. Custom Middleware to Upload to GCS ---

// This middleware runs *after* multer processes the file
const uploadToGCS = async (req, res, next) => {
  console.log('🔄 uploadToGCS middleware triggered');
  console.log('📄 req.file:', req.file);
  
  if (!req.file) {
    console.log('❌ No file found in request');
    return next();
  }

  // Generate a unique filename - use timestamp since user.id may not be available during creation
  const timestamp = Date.now();
  const userId = req.user?.id || req.body?.userId || 'new';
  const fileName = `${req.file.fieldname}_${userId}_${timestamp}${path.extname(req.file.originalname)}`;
  
  console.log(`📝 Generated filename: ${fileName}`);
  
  // Check if GCS is configured and available
  if (isGCSConfigured && bucket) {
    try {
      console.log('☁️ Attempting GCS upload...');
      const file = bucket.file(fileName);
      await file.save(req.file.buffer, {
        metadata: {
          contentType: req.file.mimetype,
        },
        resumable: false,
      });

      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      console.log(`✅ File uploaded to GCS: ${publicUrl}`);
      req.file.path = publicUrl;
      return next();
    } catch (error) {
      console.error('❌ GCS Upload Error:', error.message);
      console.log('📁 Falling back to local storage...');
      // Fall through to local storage
    }
  } else {
    console.log('⚠️ GCS not configured, using local storage');
  }

  // Fallback to local storage
  try {
    console.log('💾 Saving file locally...');
    const localFilePath = path.join(uploadsDir, fileName);
    await fs.promises.writeFile(localFilePath, req.file.buffer);
    
    // Create a local URL path
    const localUrl = `/uploads/${fileName}`;
    console.log(`📁 File saved locally: ${localUrl}`);
    req.file.path = localUrl;
    next();
  } catch (error) {
    console.error('❌ Local storage error:', error);
    next(error);
  }
};


// --- 3. Export the Middlewares ---
module.exports = {
  uploadImage: upload.single('profileImage'), // For user profiles
  uploadComplaintImage: upload.single('complaintImage'), // For complaints
  uploadAttendanceImage: upload.single('attendanceImage'),
  uploadToGCS: uploadToGCS,
};