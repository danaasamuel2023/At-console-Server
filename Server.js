// Load environment variables first
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const ConnectDB = require('./Connection/connection');
const { errorHandler, logger } = require('./MiddleWare/Middle');
const AdminRoutes = require("./Routes/AdminRoutes/Admin")

// Import route files
const userRoutes = require('./Routes/WebLogicRoutes/WebLogic');
const apiRoutes = require('./Routes/ApiLogic/api');
const app = express();

// Connect to Database
ConnectDB();

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] // Replace with your actual domain
    : ['http://localhost:3000', 'http://localhost:3001'], // Development origins
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(logger); // Request logging middleware

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    message: '🚀 ISHARE Marketplace API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    routes: {
      web: '/api/v1/*',
      developer: '/api/v1/dev/*'
    },
    documentation: {
      web_routes: [
        'POST /api/v1/auth/register - User registration',
        'POST /api/v1/auth/login - User login',
        'GET /api/v1/user/profile - Get user profile',
        'GET /api/v1/user/balance - Check balance',
        'GET /api/v1/ishare - Get pricing info',
        'POST /api/v1/ishare/calculate-price - Calculate price',
        'POST /api/v1/purchase - Purchase ISHARE data',
        'GET /api/v1/purchases - Purchase history',
        'POST /api/v1/use-data - Use data',
        'POST /api/v1/admin/ishare - Create pricing (Admin)',
        'GET /api/v1/admin/ishare - Get all pricing (Admin)',
        'PUT /api/v1/admin/ishare/:id - Update pricing (Admin)'
      ],
      api_routes: [
        'GET /api/v1/dev/status - API status',
        'GET /api/v1/dev/bundles - Get pricing',
        'POST /api/v1/dev/calculate-price - Calculate price',
        'POST /api/v1/dev/create-user - Create user',
        'GET /api/v1/dev/users - Get all users',
        'GET /api/v1/dev/user/:userId - Get specific user',
        'POST /api/v1/dev/purchase - Purchase for user',
        'POST /api/v1/dev/use-data - Record data usage',
        'POST /api/v1/dev/bulk-balance - Check multiple balances',
        'GET /api/v1/dev/stats - Developer statistics'
      ]
    }
  });
});

// API Routes
app.use('/api/v1', userRoutes);      // Web interface routes
app.use('/api/v1/dev', apiRoutes);   // Developer API routes
app.use('/api/v1/admin', AdminRoutes); // Admin routes

// Error handling middleware (must be after all routes)
app.use(errorHandler);

// 404 handler (must be last)
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    availableRoutes: {
      web: '/api/v1/*',
      developer: '/api/v1/dev/*'
    }
  });
});

// Server configuration
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log('\n🎉 ================================');
  console.log('🚀 ISHARE MARKETPLACE SERVER STARTED');
  console.log('🎉 ================================');
  console.log(`🌐 Server running on port: ${PORT}`);
  console.log(`🔗 Local URL: http://localhost:${PORT}`);
  console.log(`📱 Web Routes: http://localhost:${PORT}/api/v1`);
  console.log(`🔌 API Routes: http://localhost:${PORT}/api/v1/dev`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('🎉 ================================\n');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.error('❌ Unhandled Promise Rejection:', err.message);
  // Close server & exit process
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message);
  console.error(err.stack);
  process.exit(1);
});  

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Process terminated');
  });
});

module.exports = app;