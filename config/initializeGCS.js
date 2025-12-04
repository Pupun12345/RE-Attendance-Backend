const { Storage } = require('@google-cloud/storage');
const {configDotenv} = require('dotenv');

const devMode = process.env.NODE_ENV !== 'production';

const gcs = devMode ? new Storage({
  projectId: process.env.GCP_PROJECT_ID,
  // GCP private key should have escaped newlines
    credentials: {
        client_email: process.env.GCP_CLIENT_EMAIL,
        private_key: process.env.GCP_PRIVATE_KEY,
    },

}) : new Storage();

const bucketName = 'ray-engineering-attendance-image';
const bucket = gcs.bucket(bucketName);


module.exports = { gcs, bucket };