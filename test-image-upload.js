// Test script to verify image upload and URL saving
const fs = require('fs');
const path = require('path');

// Create a sample test image file for testing
const testImageContent = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

async function testImageUpload() {
  try {
    const FormData = require('form-data');
    const fetch = require('node-fetch');
    
    const form = new FormData();
    form.append('name', 'Test User');
    form.append('userId', 'testuser' + Date.now());
    form.append('phone', '1234567890');
    form.append('email', 'test@example.com');
    form.append('password', 'password123');
    form.append('role', 'worker');
    form.append('profileImage', testImageContent, {
      filename: 'test.png',
      contentType: 'image/png'
    });

    console.log('🧪 Testing user creation with image...');
    
    // You'll need admin credentials to create users
    const response = await fetch('http://localhost:3000/api/v1/users', {
      method: 'POST',
      body: form,
      headers: {
        'Authorization': 'Bearer YOUR_ADMIN_JWT_TOKEN'
      }
    });

    const result = await response.json();
    console.log('📊 Test Result:', result);

  } catch (error) {
    console.error('❌ Test Error:', error.message);
    console.log('💡 Note: You need to manually test with a valid admin JWT token');
    console.log('💡 To get token: POST to /api/v1/auth/login with admin credentials');
  }
}

if (require.main === module) {
  testImageUpload();
}

module.exports = testImageUpload;