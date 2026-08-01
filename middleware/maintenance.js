// middleware/maintenance.js

// Maintenance mode is toggled entirely through the MAINTENANCE_MODE env var,
// so the API can be taken down/up from the Cloud Run console without a redeploy.
exports.isMaintenanceMode = () => process.env.MAINTENANCE_MODE === 'true';

// Block every API request while maintenance mode is on.
exports.maintenance = (req, res, next) => {
  if (!exports.isMaintenanceMode()) {
    return next();
  }

  // Keep the health check alive so Cloud Run does not mark the service unhealthy.
  if (req.path === '/' || req.path === '/health') {
    return next();
  }

  res.set('Retry-After', '86400');
  return res.status(503).json({
    success: false,
    maintenance: true,
    message:
      process.env.MAINTENANCE_MESSAGE ||
      'App is under maintenance. Please try again later.',
  });
};
