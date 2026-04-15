const { Storage } = require('@google-cloud/storage');
const {configDotenv} = require('dotenv');

const devMode = process.env.NODE_ENV !== 'production';

// Check if GCS credentials are properly configured
const isGCSConfigured = () => {
  return process.env.GCP_PROJECT_ID && 
         process.env.GCP_CLIENT_EMAIL && 
         process.env.GCP_PRIVATE_KEY &&
         process.env.GCP_PROJECT_ID !== 'your_gcp_project_id' &&
         process.env.GCP_CLIENT_EMAIL !== 'your_gcp_service_account_email' &&
         process.env.GCP_PRIVATE_KEY !== 'your_gcp_private_key';
};

let gcs = null;
let bucket = null;

if (isGCSConfigured()) {
  try {
    // Parse the private key to handle escaped newlines
    const privateKey = process.env.GCP_PRIVATE_KEY.replace(/\\n/g, '\n');
    
    gcs = devMode ? new Storage({
      projectId: process.env.GCP_PROJECT_ID,
      credentials: {
        client_email: process.env.GCP_CLIENT_EMAIL,
        private_key: privateKey,
      },
    }) : new Storage();

    const bucketName = 'ray-engineering-attendance-image';
    bucket = gcs.bucket(bucketName);
    
    console.log('✅ Google Cloud Storage initialized successfully');
  } catch (error) {
    console.warn('⚠️ Failed to initialize Google Cloud Storage:', error.message);
    console.warn('📁 Image uploads will use local storage fallback');
    gcs = null;
    bucket = null;
  }
} else {
  console.warn('⚠️ GCS credentials not configured. Using local storage fallback.');
  console.warn('💡 To enable GCS, update your .env file with valid GCS credentials.');
}

module.exports = { gcs, bucket, isGCSConfigured: !!bucket };