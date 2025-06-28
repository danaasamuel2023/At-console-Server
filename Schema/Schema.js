// models/Schema.js (Updated)
const mongoose = require('mongoose');

// User Schema
const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  // Phone number is required for all users
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    validate: {
      validator: function(v) {
        // Allow 9-10 digits (Ghana local formats)
        const digitsOnly = String(v).replace(/\D/g, '');
        return /^\d{9,10}$/.test(digitsOnly);
      },
      message: 'Phone number must be 9-10 digits (Ghana local format)'
    }
  },
  role: {
    type: String,
    enum: ['buyer', 'developer', 'admin'],
    default: 'buyer'
  },
  // API key available for all roles
  apiKey: {
    type: String,
    unique: true,
    sparse: true
  },
  ishareBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// ISHARE Load Schema (for tracking loads by admin)
const ishareLoadSchema = new mongoose.Schema({
  title: {
    type: String,
    default: 'ISHARE Load'
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amountMB: {
    type: Number, // Amount loaded in MB
    required: true,
    min: 1
  },
  loadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Admin who loaded this
    required: true
  },
  reason: {
    type: String, // Reason for loading (optional)
    default: 'Admin Load'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// UPDATED: ISHARE Transfer Schema with better error tracking
const ishareTransferSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipientPhoneNumber: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        // Allow 9-10 digits (Ghana local formats)
        const digitsOnly = String(v).replace(/\D/g, '');
        return /^\d{9,10}$/.test(digitsOnly);
      },
      message: 'Recipient phone number must be 9-10 digits (Ghana local format)'
    }
  },
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // Will be null if recipient doesn't have an account
  },
  amountMB: {
    type: Number,
    required: true,
    min: 1
  },
  status: {
    type: String,
    enum: ['completed', 'failed', 'pending'],
    default: 'pending'
  },
  note: {
    type: String,
    maxlength: 200
  },
  // NEW: External transaction tracking
  externalTransactionId: {
    type: String, // Our generated transaction ID
    unique: true,
    sparse: true
  },
  systemTransactionId: {
    type: String, // Provider's system transaction ID
    sparse: true
  },
  vendorTransactionId: {
    type: String, // Provider's vendor transaction ID
    sparse: true
  },
  failureReason: {
    type: String, // Reason for failure if status is 'failed'
    maxlength: 500
  },
  // Provider response details
  providerResponse: {
    type: mongoose.Schema.Types.Mixed // Store full provider response for debugging
  }
}, {
  timestamps: true
});

// UPDATED: Transaction Schema with better transfer support
const transactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: [
      'admin_load', 
      'admin_debit', 
      'data_usage', 
      'transfer_sent', 
      'transfer_received', 
      'transfer_failed',
      'transfer_error'
    ],
    required: true
  },
  amount: {
    type: Number, // Amount in MB (can be negative for deductions)
    required: true
  },
  method: {
    type: String,
    enum: ['web', 'api'],
    required: true
  },
  ishareLoad: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IshareLoad' // Reference to load record
  },
  ishareTransfer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'IshareTransfer'
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // Admin who performed the action (for loads)
  },
  description: {
    type: String,
    default: ''
  },
  // NEW: Additional metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed // Store additional transaction details
  }
}, {
  timestamps: true
});

// Indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ phoneNumber: 1 });
userSchema.index({ apiKey: 1 });

ishareTransferSchema.index({ sender: 1, createdAt: -1 });
ishareTransferSchema.index({ recipient: 1, createdAt: -1 });
ishareTransferSchema.index({ externalTransactionId: 1 });
ishareTransferSchema.index({ status: 1 });

transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ type: 1, createdAt: -1 });

ishareLoadSchema.index({ user: 1, createdAt: -1 });
ishareLoadSchema.index({ loadedBy: 1, createdAt: -1 });

// Create models
const User = mongoose.model('User', userSchema);
const IshareLoad = mongoose.model('IshareLoad', ishareLoadSchema);
const IshareTransfer = mongoose.model('IshareTransfer', ishareTransferSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = {
  User,
  IshareLoad,
  IshareTransfer,
  Transaction
};