const jwt = require('jsonwebtoken');
const { User } = require('../Schema/Schema'); // Adjust path to your models

// JWT Authentication middleware (for web dashboard)
const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid token or user inactive.' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

// API Key authentication for all users (not just developers)
const authenticateAPI = async (req, res, next) => {
  try {
    const apiKey = req.header('X-API-Key');
    
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required. Include X-API-Key header.' });
    }

    const user = await User.findOne({ 
      apiKey: apiKey, 
      isActive: true 
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid API key.' });
    }

    req.user = user;
    req.isAPIRequest = true;
    next();
  } catch (error) {
    res.status(401).json({ error: 'API authentication failed.' });
  }
};

// Flexible authentication - supports both API key and JWT
const authenticateFlexible = async (req, res, next) => {
  const apiKey = req.header('X-API-Key');
  const token = req.header('Authorization')?.replace('Bearer ', '');

  // Prefer API key if provided
  if (apiKey) {
    return authenticateAPI(req, res, next);
  }
  
  // Fall back to JWT authentication
  if (token) {
    return authenticate(req, res, next);
  }

  return res.status(401).json({ 
    error: 'Authentication required. Provide either X-API-Key header or Authorization Bearer token.' 
  });
};

// Authorization middleware for roles
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Access denied. Please authenticate.' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: `Access denied. Required role: ${roles.join(' or ')}` 
      });
    }

    next();
  };
};

// Admin only middleware
const adminOnly = authorize('admin');

// Developer only middleware
const developerOnly = authorize('developer');

// Admin or Developer middleware
const adminOrDeveloper = authorize('admin', 'developer');

// Purchase method tracking middleware
const trackPurchaseMethod = (req, res, next) => {
  // Determine if request is from API or web
  req.purchaseMethod = req.isAPIRequest ? 'api' : 'web';
  next();
};

// Rate limiting middleware
const rateLimit = (windowMs = 15 * 60 * 1000, max = 100) => {
  const requests = new Map();

  return (req, res, next) => {
    const key = req.user?.id || req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old requests
    if (requests.has(key)) {
      requests.set(key, requests.get(key).filter(time => time > windowStart));
    } else {
      requests.set(key, []);
    }

    const userRequests = requests.get(key);

    if (userRequests.length >= max) {
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }

    userRequests.push(now);
    next();
  };
};

// API Rate limiting (stricter for API users)
const apiRateLimit = rateLimit(15 * 60 * 1000, 50); // 50 requests per 15 minutes

// Web Rate limiting (more lenient for web users)
const webRateLimit = rateLimit(15 * 60 * 1000, 200); // 200 requests per 15 minutes

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      error: 'Validation Error',
      details: errors
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({
      error: `${field} already exists`
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired' });
  }

  // Default error
  res.status(500).json({
    error: 'Something went wrong!',
    ...(process.env.NODE_ENV === 'development' && { details: err.message })
  });
};

// Request logging middleware
const logger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const method = req.method;
    const url = req.originalUrl;
    const status = res.statusCode;
    const userInfo = req.user ? `User: ${req.user.id} (${req.user.role})` : 'Anonymous';
    const requestType = req.isAPIRequest ? 'API' : 'WEB';
    
    console.log(`[${new Date().toISOString()}] ${method} ${url} - ${status} - ${duration}ms - ${requestType} - ${userInfo}`);
  });
  
  next();
};

// Validate ObjectId middleware
const validateObjectId = (paramName) => {
  return (req, res, next) => {
    const id = req.params[paramName];
    
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: 'Invalid ID format' });
    }
    
    next();
  };
};

// Check if user owns resource
const checkOwnership = (model, paramName = 'id') => {
  return async (req, res, next) => {
    try {
      const resource = await model.findById(req.params[paramName]);
      
      if (!resource) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      // Admin can access everything
      if (req.user.role === 'admin') {
        req.resource = resource;
        return next();
      }

      // Check if user owns the resource
      const ownerId = resource.buyer || resource.user || resource.addedBy;
      if (ownerId && ownerId.toString() !== req.user.id) {
        return res.status(403).json({ error: 'Access denied. You do not own this resource.' });
      }

      req.resource = resource;
      next();
    } catch (error) {
      res.status(500).json({ error: 'Error checking ownership' });
    }
  };
};

module.exports = {
  authenticate,          // JWT only (for web dashboard)
  authenticateAPI,       // API key only (for API endpoints)
  authenticateFlexible,  // Both API key and JWT (flexible)
  authorize,
  adminOnly,
  developerOnly,
  adminOrDeveloper,
  trackPurchaseMethod,
  rateLimit,
  apiRateLimit,
  webRateLimit,
  errorHandler,
  logger,
  validateObjectId,
  checkOwnership
};