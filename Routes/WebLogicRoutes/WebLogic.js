const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, IshareLoad, Transaction, IshareTransfer } = require('../../Schema/Schema');
const {
  authenticate,
  adminOnly,
  webRateLimit,
  validateObjectId
} = require('../../MiddleWare/Middle');

const router = express.Router();

// ==================== AUTH ROUTES ====================

// Register User (API key for all roles)
router.post('/auth/register', async (req, res) => {
  try {
    const { email, password, name, role, phoneNumber } = req.body;

    // Validate phone number is required
    if (!phoneNumber) {
      return res.status(400).json({ 
        error: 'Phone number is required' 
      });
    }

    // Clean and validate phone number
    const digitsOnly = String(phoneNumber).replace(/\D/g, '');
    if (!/^\d{9,10}$/.test(digitsOnly)) {
      return res.status(400).json({ 
        error: 'Phone number must be 9-10 digits (Ghana local format)',
        received: phoneNumber,
        digitsOnly: digitsOnly,
        length: digitsOnly.length
      });
    }

    // Check if user exists (use cleaned phone number for checking)
    const existingUser = await User.findOne({ 
      $or: [
        { email },
        { phoneNumber: digitsOnly }
      ]
    });
    
    if (existingUser) {
      if (existingUser.email === email) {
        return res.status(400).json({ error: 'Email already exists' });
      }
      if (existingUser.phoneNumber === digitsOnly) {
        return res.status(400).json({ error: 'Phone number already exists' });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate API key for ALL users (not just developers)
    const apiKey = crypto.randomBytes(32).toString('hex');

    const user = new User({
      email,
      password: hashedPassword,
      name,
      role: role || 'buyer',
      phoneNumber: digitsOnly, // Store cleaned phone number
      apiKey
    });

    await user.save();

    // Generate JWT
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        phoneNumber: user.phoneNumber,
        role: user.role,
        ishareBalance: user.ishareBalance,
        apiKey: user.apiKey
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login User
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email, isActive: true });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        phoneNumber: user.phoneNumber,
        role: user.role,
        ishareBalance: user.ishareBalance,
        apiKey: user.apiKey
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== USER ROUTES ====================

// Get User Profile
router.get('/user/profile', authenticate, (req, res) => {
  res.json({
    id: req.user._id,
    email: req.user.email,
    name: req.user.name,
    phoneNumber: req.user.phoneNumber,
    role: req.user.role,
    ishareBalance: req.user.ishareBalance,
    apiKey: req.user.apiKey,
    createdAt: req.user.createdAt
  });
});

// Get User Balance
router.get('/user/balance', authenticate, (req, res) => {
  res.json({
    ishareBalance: req.user.ishareBalance,
    balanceInGB: (req.user.ishareBalance / 1024).toFixed(2)
  });
});

// Update User Profile
router.put('/user/profile', authenticate, async (req, res) => {
  try {
    const { name } = req.body;
    
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { name },
      { new: true }
    ).select('-password');

    res.json({ message: 'Profile updated', user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Regenerate API Key
router.post('/user/regenerate-api-key', authenticate, async (req, res) => {
  try {
    const newApiKey = crypto.randomBytes(32).toString('hex');
    
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { apiKey: newApiKey },
      { new: true }
    ).select('-password');

    res.json({ 
      message: 'API key regenerated successfully',
      apiKey: user.apiKey
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ADMIN ROUTES ====================

// Load ISHARE for User (Admin only)
router.post('/admin/load-ishare', authenticate, adminOnly, async (req, res) => {
  try {
    const { userId, amountMB, reason } = req.body;

    if (!userId || !amountMB) {
      return res.status(400).json({ error: 'userId and amountMB are required' });
    }

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create load record
    const load = new IshareLoad({
      user: userId,
      amountMB,
      loadedBy: req.user._id,
      reason: reason || 'Admin Load'
    });

    await load.save();

    // Update user balance
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $inc: { ishareBalance: amountMB } },
      { new: true }
    );

    // Create transaction
    const transaction = new Transaction({
      user: userId,
      type: 'admin_load',
      amount: amountMB,
      method: req.method === 'api' ? 'api' : 'web',
      ishareLoad: load._id,
      performedBy: req.user._id,
      description: `Admin loaded ${amountMB}MB - ${reason || 'Admin Load'}`
    });

    await transaction.save();

    res.status(201).json({
      message: 'ISHARE loaded successfully',
      load: {
        id: load._id,
        userName: user.name,
        userPhone: user.phoneNumber,
        amountMB,
        reason: load.reason,
        newBalance: updatedUser.ishareBalance,
        loadedAt: load.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Credit ISHARE by email (Admin only)
router.post('/admin/credit-ishare', authenticate, adminOnly, async (req, res) => {
  try {
    const { userEmail, amountMB, reason } = req.body;

    if (!userEmail || !amountMB) {
      return res.status(400).json({ error: 'userEmail and amountMB are required' });
    }

    // Find the user by email
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create load record
    const load = new IshareLoad({
      user: user._id,
      amountMB,
      loadedBy: req.user._id,
      reason: reason || 'Admin Credit'
    });

    await load.save();

    // Update user balance
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $inc: { ishareBalance: amountMB } },
      { new: true }
    );

    // Create transaction
    const transaction = new Transaction({
      user: user._id,
      type: 'admin_load',
      amount: amountMB,
      method: 'web',
      ishareLoad: load._id,
      performedBy: req.user._id,
      description: `Admin credited ${amountMB}MB - ${reason || 'Admin Credit'}`
    });

    await transaction.save();

    res.status(201).json({
      message: 'ISHARE credited successfully',
      load: {
        id: load._id,
        userName: user.name,
        userEmail: user.email,
        userPhone: user.phoneNumber,
        amountMB,
        reason: load.reason,
        newBalance: updatedUser.ishareBalance,
        loadedAt: load.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debit ISHARE by email (Admin only)
router.post('/admin/debit-ishare', authenticate, adminOnly, async (req, res) => {
  try {
    const { userEmail, amountMB, reason } = req.body;

    if (!userEmail || !amountMB) {
      return res.status(400).json({ error: 'userEmail and amountMB are required' });
    }

    // Find the user by email
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has enough balance
    if (user.ishareBalance < amountMB) {
      return res.status(400).json({ 
        error: 'Insufficient balance',
        available: user.ishareBalance,
        requested: amountMB
      });
    }

    // Update user balance (deduct)
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $inc: { ishareBalance: -amountMB } },
      { new: true }
    );

    // Create transaction
    const transaction = new Transaction({
      user: user._id,
      type: 'admin_debit',
      amount: -amountMB,
      method: 'web',
      performedBy: req.user._id,
      description: `Admin debited ${amountMB}MB - ${reason || 'Admin Debit'}`
    });

    await transaction.save();

    res.status(200).json({
      message: 'ISHARE debited successfully',
      debit: {
        userName: user.name,
        userEmail: user.email,
        userPhone: user.phoneNumber,
        amountMB,
        reason: reason || 'Admin Debit',
        newBalance: updatedUser.ishareBalance,
        debitedAt: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk credit ISHARE (Admin only)
router.post('/admin/bulk-credit-ishare', authenticate, adminOnly, async (req, res) => {
  try {
    const { credits } = req.body; // Array of { userEmail, amountMB, reason }

    if (!Array.isArray(credits) || credits.length === 0) {
      return res.status(400).json({ error: 'credits array is required' });
    }

    const results = [];
    const errors = [];

    for (const credit of credits) {
      try {
        const { userEmail, amountMB, reason } = credit;

        if (!userEmail || !amountMB) {
          errors.push({ userEmail, error: 'userEmail and amountMB are required' });
          continue;
        }

        // Find the user by email
        const user = await User.findOne({ email: userEmail });
        if (!user) {
          errors.push({ userEmail, error: 'User not found' });
          continue;
        }

        // Create load record
        const load = new IshareLoad({
          user: user._id,
          amountMB,
          loadedBy: req.user._id,
          reason: reason || 'Bulk Credit'
        });

        await load.save();

        // Update user balance
        const updatedUser = await User.findByIdAndUpdate(
          user._id,
          { $inc: { ishareBalance: amountMB } },
          { new: true }
        );

        // Create transaction
        const transaction = new Transaction({
          user: user._id,
          type: 'admin_load',
          amount: amountMB,
          method: 'web',
          ishareLoad: load._id,
          performedBy: req.user._id,
          description: `Bulk credit ${amountMB}MB - ${reason || 'Bulk Credit'}`
        });

        await transaction.save();

        results.push({
          userEmail,
          userName: user.name,
          amountMB,
          newBalance: updatedUser.ishareBalance,
          success: true
        });

      } catch (error) {
        errors.push({ userEmail: credit.userEmail, error: error.message });
      }
    }

    res.status(200).json({
      message: `Bulk credit completed: ${results.length} successful, ${errors.length} failed`,
      results,
      errors
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get All Users with pagination (Admin only)
router.get('/admin/users', authenticate, adminOnly, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments();

    res.json({
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalUsers: total,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get All Transactions with pagination (Admin only)
router.get('/admin/transactions', authenticate, adminOnly, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const type = req.query.type;

    let query = {};
    if (type && type !== 'all') {
      query.type = type;
    }

    const transactions = await Transaction.find(query)
      .populate('user', 'name email phoneNumber')
      .populate('performedBy', 'name email')
      .populate('ishareLoad', 'amountMB reason')
      .populate('ishareTransfer', 'amountMB recipientPhoneNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Transaction.countDocuments(query);

    res.json({
      transactions,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalTransactions: total,
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Dashboard Stats (Admin only)
router.get('/admin/dashboard', authenticate, adminOnly, async (req, res) => {
  try {
    // Get user stats
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true });

    // Get ISHARE stats
    const allUsers = await User.find().select('ishareBalance');
    const totalDataLoaded = await IshareLoad.aggregate([
      { $group: { _id: null, total: { $sum: '$amountMB' } } }
    ]);
    const totalDataUsed = await Transaction.aggregate([
      { $match: { type: 'data_usage' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    const totalLoads = await IshareLoad.countDocuments();
    const remainingData = allUsers.reduce((sum, user) => sum + (user.ishareBalance || 0), 0);

    // Get recent activity (last 10 transactions)
    const recentActivity = await Transaction.find()
      .populate('user', 'name email')
      .sort({ createdAt: -1 })
      .limit(10)
      .select('type amount description createdAt user');

    res.json({
      dashboard: {
        users: {
          total: totalUsers,
          active: activeUsers
        },
        ishare: {
          totalDataLoaded: totalDataLoaded[0]?.total || 0,
          totalDataUsed: totalDataUsed[0]?.total || 0,
          remainingData,
          totalLoads
        },
        recentActivity
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update User (Admin only)
router.put('/admin/users/:userId', authenticate, adminOnly, async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email, role, isActive } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (role) updateData.role = role;
    if (typeof isActive === 'boolean') updateData.isActive = isActive;

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: 'User updated successfully',
      user
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export data (Admin only)
router.get('/admin/export/:type', authenticate, adminOnly, async (req, res) => {
  try {
    const { type } = req.params;

    let data;
    let filename;

    if (type === 'users') {
      data = await User.find().select('-password');
      filename = `users_export_${new Date().toISOString().split('T')[0]}.json`;
    } else if (type === 'transactions') {
      data = await Transaction.find()
        .populate('user', 'name email phoneNumber')
        .populate('performedBy', 'name email');
      filename = `transactions_export_${new Date().toISOString().split('T')[0]}.json`;
    } else {
      return res.status(400).json({ error: 'Invalid export type' });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get All Transfers (Admin only)
router.get('/admin/transfers', authenticate, adminOnly, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    
    let query = {};
    if (status && ['completed', 'failed', 'pending'].includes(status)) {
      query.status = status;
    }

    const transfers = await IshareTransfer.find(query)
      .populate('sender', 'name email phoneNumber')
      .populate('recipient', 'name email phoneNumber')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await IshareTransfer.countDocuments(query);

    res.json({
      transfers,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check Provider Balance (Admin only)
router.get('/admin/provider-balance', authenticate, adminOnly, async (req, res) => {
  try {
    const iShareService = require('../../services/ishareService');
    const balanceResult = await iShareService.checkBalance();

    res.json({
      success: true,
      providerBalance: {
        balance: balanceResult.balance,
        balanceInGB: balanceResult.balanceInGB,
        expireTime: balanceResult.expireTime,
        message: balanceResult.message,
        responseCode: balanceResult.responseCode
      }
    });

  } catch (error) {
    console.error('Provider Balance Check Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check provider balance',
      details: error.message
    });
  }
});

// UPDATED: Check phone numbers in database (Admin only - for debugging)
router.get('/admin/check-phone-numbers', authenticate, adminOnly, async (req, res) => {
  try {
    const users = await User.find({}, 'phoneNumber email name');
    const invalidNumbers = users.filter(user => {
      const phone = String(user.phoneNumber || '');
      const digitsOnly = phone.replace(/\D/g, '');
      return !/^\d{9,10}$/.test(digitsOnly);
    });
    
    const phoneStats = users.map(user => {
      const phone = String(user.phoneNumber || '');
      const digitsOnly = phone.replace(/\D/g, '');
      return {
        email: user.email,
        name: user.name,
        phoneNumber: user.phoneNumber,
        digitsOnly: digitsOnly,
        length: digitsOnly.length,
        type: typeof user.phoneNumber,
        startsWithZero: digitsOnly.startsWith('0'),
        isValid: /^\d{9,10}$/.test(digitsOnly)
      };
    });
    
    res.json({
      totalUsers: users.length,
      invalidNumbers: invalidNumbers.length,
      invalidUsers: invalidNumbers.map(user => ({
        email: user.email,
        name: user.name,
        phoneNumber: user.phoneNumber,
        length: String(user.phoneNumber || '').replace(/\D/g, '').length,
        type: typeof user.phoneNumber
      })),
      phoneStats: phoneStats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== TRANSFER ROUTES ====================

// UPDATED: Send ISHARE to phone number with actual API call
router.post('/transfer/send', authenticate, async (req, res) => {
  try {
    const { phoneNumber, amountMB, note } = req.body;
    
    console.log('Transfer request received:', { 
      phoneNumber, 
      amountMB, 
      note, 
      userPhone: req.user.phoneNumber,
      userEmail: req.user.email 
    });

    // Enhanced validation
    if (!phoneNumber) {
      return res.status(400).json({ 
        error: 'Phone number is required' 
      });
    }

    // Convert to string and validate
    const phoneStr = String(phoneNumber).trim();
    console.log('Phone number validation:', { original: phoneNumber, trimmed: phoneStr });

    // Remove any non-digit characters for validation
    const digitsOnly = phoneStr.replace(/\D/g, '');

    // Allow 9 digits (missing leading 2), 10 digits (with or without leading 0), or 12 digits (international)
    if (digitsOnly.length === 9) {
      // 9 digits - acceptable (will add 233 + 2 in formatting)
    } else if (digitsOnly.length === 10) {
      // 10 digits - acceptable (with or without leading 0)
    } else if (digitsOnly.length === 12 && digitsOnly.startsWith('233')) {
      // 12 digits international format - acceptable
    } else {
      return res.status(400).json({ 
        error: 'Phone number must be 9-10 digits (Ghana local) or 12 digits (international format)',
        received: phoneStr,
        digitsOnly: digitsOnly,
        length: digitsOnly.length,
        type: typeof phoneNumber
      });
    }

    if (!amountMB || amountMB < 50) {
      return res.status(400).json({ 
        error: 'Amount must be at least 50MB (provider requirement)' 
      });
    }

    if (req.user.ishareBalance < amountMB) {
      return res.status(400).json({ 
        error: 'Insufficient balance',
        available: req.user.ishareBalance,
        requested: amountMB
      });
    }

    // Generate unique transaction ID for tracking
    const iShareService = require('../../Services/Ishare');
    const transactionId = iShareService.generateTransactionId('WEB');

    console.log('Generated transaction ID:', transactionId);

    // Create transfer record with pending status
    const transfer = new IshareTransfer({
      sender: req.user._id,
      recipientPhoneNumber: phoneStr,
      recipient: null,
      amountMB,
      note: note || '',
      status: 'pending',
      externalTransactionId: transactionId
    });

    await transfer.save();
    console.log('Transfer record created:', transfer._id);

    try {
      // Call external ISHARE API to send the data
      console.log('Calling iShare API with phone:', phoneStr, 'amount:', amountMB);
      const apiResult = await iShareService.sendTransfer(phoneStr, amountMB, transactionId);
      
      console.log('API Result:', apiResult);

      if (apiResult.success) {
        // API call successful - update transfer status and deduct balance
        transfer.status = 'completed';
        transfer.systemTransactionId = apiResult.systemTransactionId;
        transfer.vendorTransactionId = apiResult.vendorTransactionId;
        await transfer.save();

        // Deduct amount from sender's balance
        const updatedSender = await User.findByIdAndUpdate(
          req.user._id,
          { $inc: { ishareBalance: -amountMB } },
          { new: true }
        );

        // Create successful transaction for sender
        const senderTransaction = new Transaction({
          user: req.user._id,
          type: 'transfer_sent',
          amount: -amountMB,
          method: 'web',
          ishareTransfer: transfer._id,
          description: `Sent ${amountMB}MB to ${phoneStr} - Transaction ID: ${transactionId}`
        });

        await senderTransaction.save();

        res.status(200).json({
          message: 'ISHARE sent successfully',
          transfer: {
            id: transfer._id,
            transactionId: transactionId,
            systemTransactionId: apiResult.systemTransactionId,
            vendorTransactionId: apiResult.vendorTransactionId,
            recipientPhoneNumber: phoneStr,
            amountMB,
            status: 'completed',
            note: transfer.note,
            transferDate: transfer.createdAt,
            providerMessage: apiResult.message
          },
          senderNewBalance: updatedSender.ishareBalance
        });

      } else {
        // API call failed - update transfer status with failure reason
        transfer.status = 'failed';
        transfer.failureReason = apiResult.message || 'Provider API call failed';
        await transfer.save();

        // Create failed transaction record (no balance deduction)
        const failedTransaction = new Transaction({
          user: req.user._id,
          type: 'transfer_failed',
          amount: 0,
          method: 'web',
          ishareTransfer: transfer._id,
          description: `Failed to send ${amountMB}MB to ${phoneStr} - ${transfer.failureReason}`
        });

        await failedTransaction.save();

        res.status(400).json({
          error: 'Transfer failed',
          message: apiResult.message || 'Provider API call failed',
          transfer: {
            id: transfer._id,
            transactionId: transactionId,
            recipientPhoneNumber: phoneStr,
            amountMB,
            status: 'failed',
            note: transfer.note,
            failureReason: transfer.failureReason,
            transferDate: transfer.createdAt
          },
          senderBalance: req.user.ishareBalance
        });
      }

    } catch (providerError) {
      console.error('Provider API Error Details:', {
        message: providerError.message,
        stack: providerError.stack,
        phoneNumber: phoneStr,
        amountMB,
        transactionId
      });

      // Provider API error - update transfer status
      transfer.status = 'failed';
      transfer.failureReason = providerError.message || 'Provider service unavailable';
      await transfer.save();

      // Create error transaction record
      const errorTransaction = new Transaction({
        user: req.user._id,
        type: 'transfer_error',
        amount: 0,
        method: 'web',
        ishareTransfer: transfer._id,
        description: `Transfer error for ${amountMB}MB to ${phoneStr} - ${transfer.failureReason}`
      });

      await errorTransaction.save();

      // Check if it's a phone number formatting error
      if (providerError.message.includes('Invalid phone number format')) {
        res.status(400).json({
          error: 'Invalid phone number format',
          message: 'The phone number could not be processed. Please ensure it is a valid 10-digit Ghana mobile number.',
          details: providerError.message,
          debugging: {
            originalInput: phoneNumber,
            processedInput: phoneStr,
            inputType: typeof phoneNumber,
            inputLength: phoneStr.length
          },
          transfer: {
            id: transfer._id,
            transactionId: transactionId,
            recipientPhoneNumber: phoneStr,
            amountMB,
            status: 'failed',
            note: transfer.note,
            failureReason: transfer.failureReason,
            transferDate: transfer.createdAt
          },
          senderBalance: req.user.ishareBalance
        });
      } else {
        res.status(500).json({
          error: 'Transfer failed due to provider service error',
          message: 'Unable to connect to provider service. Please try again later.',
          transfer: {
            id: transfer._id,
            transactionId: transactionId,
            recipientPhoneNumber: phoneStr,
            amountMB,
            status: 'failed',
            note: transfer.note,
            failureReason: transfer.failureReason,
            transferDate: transfer.createdAt
          },
          senderBalance: req.user.ishareBalance
        });
      }
    }

  } catch (error) {
    console.error('Transfer Route Error:', {
      message: error.message,
      stack: error.stack,
      body: req.body,
      user: req.user.email
    });
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// Get transfer history for user
router.get('/transfers', authenticate, async (req, res) => {
  try {
    const { type = 'all' } = req.query; // 'sent', 'received', or 'all'

    let query = {};
    
    if (type === 'sent') {
      query.sender = req.user._id;
    } else if (type === 'received') {
      query.recipient = req.user._id;
    } else {
      query = {
        $or: [
          { sender: req.user._id },
          { recipient: req.user._id }
        ]
      };
    }

    const transfers = await IshareTransfer.find(query)
      .populate('sender', 'name email phoneNumber')
      .populate('recipient', 'name email phoneNumber')
      .sort({ createdAt: -1 })
      .limit(50);

    const formattedTransfers = transfers.map(transfer => ({
      id: transfer._id,
      type: transfer.sender && transfer.sender._id.toString() === req.user._id.toString() ? 'sent' : 'received',
      amountMB: transfer.amountMB,
      recipientPhoneNumber: transfer.recipientPhoneNumber,
      senderName: transfer.sender?.name || 'Unknown',
      recipientName: transfer.recipient?.name || 'External Recipient',
      status: transfer.status,
      createdAt: transfer.createdAt,
      note: transfer.note,
      transactionId: transfer.externalTransactionId,
      failureReason: transfer.failureReason
    }));

    res.json({
      transfers: formattedTransfers,
      total: formattedTransfers.length
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check transfer status
router.get('/transfer/status/:transactionId', authenticate, async (req, res) => {
  try {
    const { transactionId } = req.params;

    // Find the transfer record
    const transfer = await IshareTransfer.findOne({
      externalTransactionId: transactionId,
      sender: req.user._id
    });

    if (!transfer) {
      return res.status(404).json({
        error: 'Transaction not found'
      });
    }

    // If transaction was successful, optionally check with provider for real-time status
    if (transfer.status === 'completed') {
      try {
        const iShareService = require('../../services/ishareService');
        const statusResult = await iShareService.checkTransactionStatus(transactionId);

        res.json({
          success: true,
          transaction: {
            id: transfer._id,
            transactionId: transactionId,
            status: transfer.status,
            amountMB: transfer.amountMB,
            recipientPhoneNumber: transfer.recipientPhoneNumber,
            note: transfer.note,
            createdAt: transfer.createdAt,
            systemTransactionId: transfer.systemTransactionId,
            vendorTransactionId: transfer.vendorTransactionId,
            providerStatus: statusResult
          }
        });

      } catch (providerError) {
        // Return local status if provider check fails
        res.json({
          success: true,
          transaction: {
            id: transfer._id,
            transactionId: transactionId,
            status: transfer.status,
            amountMB: transfer.amountMB,
            recipientPhoneNumber: transfer.recipientPhoneNumber,
            note: transfer.note,
            createdAt: transfer.createdAt,
            systemTransactionId: transfer.systemTransactionId,
            vendorTransactionId: transfer.vendorTransactionId,
            providerStatus: {
              error: 'Could not check provider status',
              message: providerError.message
            }
          }
        });
      }
    } else {
      // Return local status for pending/failed transfers
      res.json({
        success: true,
        transaction: {
          id: transfer._id,
          transactionId: transactionId,
          status: transfer.status,
          amountMB: transfer.amountMB,
          recipientPhoneNumber: transfer.recipientPhoneNumber,
          note: transfer.note,
          failureReason: transfer.failureReason,
          createdAt: transfer.createdAt
        }
      });
    }

  } catch (error) {
    console.error('Transaction Status Check Error:', error);
    res.status(500).json({
      error: error.message
    });
  }
});

// ==================== USAGE ROUTES ====================

// Use ISHARE Data
router.post('/use-data', authenticate, async (req, res) => {
  try {
    const { amount } = req.body; // Amount in MB

    if (amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Check if user has enough balance
    if (req.user.ishareBalance < amount) {
      return res.status(400).json({ 
        error: 'Insufficient balance',
        available: req.user.ishareBalance,
        requested: amount
      });
    }

    // Deduct from balance
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { ishareBalance: -amount } },
      { new: true }
    );

    // Create transaction
    const transaction = new Transaction({
      user: req.user._id,
      type: 'data_usage',
      amount: amount,
      method: 'web',
      description: `Used ${amount}MB of data`
    });

    await transaction.save();

    res.json({
      message: 'Data usage recorded',
      usedAmount: amount,
      remainingBalance: updatedUser.ishareBalance
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;