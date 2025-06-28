const express = require('express');
const { User, IshareLoad, Transaction } = require('../../Schema/Schema');
const {
  authenticate,
  adminOnly,
  validateObjectId
} = require('../../MiddleWare/Middle');

const router = express.Router();

// ==================== USER MANAGEMENT ====================

// Get All Users
router.get('/users', authenticate, adminOnly, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalUsers = await User.countDocuments();

    res.json({
      success: true,
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalUsers / limit),
        totalUsers,
        usersPerPage: limit
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get User by ID
router.get('/users/:id', authenticate, adminOnly, validateObjectId('id'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Get user's load history
    const loads = await IshareLoad.find({ user: user._id })
      .populate('loadedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(10);

    // Get user's usage history
    const usage = await Transaction.find({ 
      user: user._id,
      type: 'data_usage' 
    })
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      user,
      recentLoads: loads,
      recentUsage: usage
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Update User
router.put('/users/:id', authenticate, adminOnly, validateObjectId('id'), async (req, res) => {
  try {
    const { name, email, role, isActive } = req.body;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, email, role, isActive },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      user
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Delete User (Soft delete - set isActive to false)
router.delete('/users/:id', authenticate, adminOnly, validateObjectId('id'), async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User deactivated successfully',
      user
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// ==================== ISHARE CREDIT MANAGEMENT ====================

// Credit ISHARE to User
router.post('/credit-ishare', authenticate, adminOnly, async (req, res) => {
  try {
    const { userEmail, amountMB, reason } = req.body;

    if (!userEmail || !amountMB) {
      return res.status(400).json({
        success: false,
        error: 'userEmail and amountMB are required'
      });
    }

    if (amountMB <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be greater than 0'
      });
    }

    // Find user
    const user = await User.findOne({ 
      email: userEmail,
      isActive: true 
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Create load record
    const ishareLoad = new IshareLoad({
      user: user._id,
      amountMB,
      loadedBy: req.user._id,
      reason: reason || 'Admin Credit'
    });

    await ishareLoad.save();

    // Create transaction
    const transaction = new Transaction({
      user: user._id,
      type: 'admin_load',
      amount: amountMB,
      method: 'web',
      ishareLoad: ishareLoad._id,
      performedBy: req.user._id,
      description: `Admin credited ${amountMB}MB - ${reason || 'No reason provided'}`
    });

    await transaction.save();

    // Update user balance
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $inc: { ishareBalance: amountMB } },
      { new: true }
    ).select('-password');

    res.status(201).json({
      success: true,
      message: 'ISHARE credited successfully',
      credit: {
        id: ishareLoad._id,
        userEmail: user.email,
        userName: user.name,
        amountMB,
        reason: ishareLoad.reason,
        previousBalance: updatedUser.ishareBalance - amountMB,
        newBalance: updatedUser.ishareBalance,
        creditedBy: req.user.name,
        creditDate: ishareLoad.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Bulk Credit ISHARE to Multiple Users
router.post('/bulk-credit-ishare', authenticate, adminOnly, async (req, res) => {
  try {
    const { credits } = req.body; // Array of { userEmail, amountMB, reason }

    if (!Array.isArray(credits) || credits.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'credits array is required'
      });
    }

    const results = [];
    const errors = [];

    for (const credit of credits) {
      try {
        const { userEmail, amountMB, reason } = credit;

        if (!userEmail || !amountMB || amountMB <= 0) {
          errors.push({
            userEmail,
            error: 'Invalid userEmail or amountMB'
          });
          continue;
        }

        // Find user
        const user = await User.findOne({ 
          email: userEmail,
          isActive: true 
        });

        if (!user) {
          errors.push({
            userEmail,
            error: 'User not found'
          });
          continue;
        }

        // Create load record
        const ishareLoad = new IshareLoad({
          user: user._id,
          amountMB,
          loadedBy: req.user._id,
          reason: reason || 'Bulk Admin Credit'
        });

        await ishareLoad.save();

        // Create transaction
        const transaction = new Transaction({
          user: user._id,
          type: 'admin_load',
          amount: amountMB,
          method: 'web',
          ishareLoad: ishareLoad._id,
          performedBy: req.user._id,
          description: `Bulk admin credit ${amountMB}MB - ${reason || 'No reason provided'}`
        });

        await transaction.save();

        // Update user balance
        const updatedUser = await User.findByIdAndUpdate(
          user._id,
          { $inc: { ishareBalance: amountMB } },
          { new: true }
        );

        results.push({
          userEmail,
          userName: user.name,
          amountMB,
          newBalance: updatedUser.ishareBalance,
          status: 'success'
        });

      } catch (err) {
        errors.push({
          userEmail: credit.userEmail,
          error: err.message
        });
      }
    }

    res.status(201).json({
      success: true,
      message: `Bulk credit completed. ${results.length} successful, ${errors.length} failed`,
      results,
      errors
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Debit ISHARE from User (Reduce balance)
router.post('/debit-ishare', authenticate, adminOnly, async (req, res) => {
  try {
    const { userEmail, amountMB, reason } = req.body;

    if (!userEmail || !amountMB) {
      return res.status(400).json({
        success: false,
        error: 'userEmail and amountMB are required'
      });
    }

    if (amountMB <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be greater than 0'
      });
    }

    // Find user
    const user = await User.findOne({ 
      email: userEmail,
      isActive: true 
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (user.ishareBalance < amountMB) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient balance',
        available: user.ishareBalance,
        requested: amountMB
      });
    }

    // Create transaction
    const transaction = new Transaction({
      user: user._id,
      type: 'data_usage',
      amount: amountMB,
      method: 'web',
      performedBy: req.user._id,
      description: `Admin debit ${amountMB}MB - ${reason || 'No reason provided'}`
    });

    await transaction.save();

    // Update user balance
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $inc: { ishareBalance: -amountMB } },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'ISHARE debited successfully',
      debit: {
        userEmail: user.email,
        userName: user.name,
        amountMB,
        reason: reason || 'Admin Debit',
        previousBalance: updatedUser.ishareBalance + amountMB,
        newBalance: updatedUser.ishareBalance,
        debitedBy: req.user.name,
        debitDate: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// ==================== TRANSACTION MANAGEMENT ====================

// Get All Transactions
router.get('/transactions', authenticate, adminOnly, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const type = req.query.type; // Filter by transaction type

    const filter = {};
    if (type && ['admin_load', 'data_usage'].includes(type)) {
      filter.type = type;
    }

    const transactions = await Transaction.find(filter)
      .populate('user', 'name email ishareBalance')
      .populate('performedBy', 'name email')
      .populate('ishareLoad', 'reason amountMB')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalTransactions = await Transaction.countDocuments(filter);

    res.json({
      success: true,
      transactions,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalTransactions / limit),
        totalTransactions,
        transactionsPerPage: limit
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get Transaction by ID
router.get('/transactions/:id', authenticate, adminOnly, validateObjectId('id'), async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id)
      .populate('user', 'name email ishareBalance')
      .populate('performedBy', 'name email')
      .populate('ishareLoad', 'reason amountMB');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    res.json({
      success: true,
      transaction
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get User's Transaction History
router.get('/users/:id/transactions', authenticate, adminOnly, validateObjectId('id'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const transactions = await Transaction.find({ user: req.params.id })
      .populate('performedBy', 'name email')
      .populate('ishareLoad', 'reason amountMB')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalTransactions = await Transaction.countDocuments({ user: req.params.id });

    res.json({
      success: true,
      transactions,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalTransactions / limit),
        totalTransactions,
        transactionsPerPage: limit
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// ==================== STATISTICS & REPORTS ====================

// Dashboard Statistics
router.get('/dashboard', authenticate, adminOnly, async (req, res) => {
  try {
    // User statistics
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true });
    const newUsersToday = await User.countDocuments({
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
    });

    // ISHARE statistics
    const totalLoads = await IshareLoad.countDocuments();
    const totalDataLoaded = await IshareLoad.aggregate([
      { $group: { _id: null, total: { $sum: "$amountMB" } } }
    ]);

    const totalDataUsed = await Transaction.aggregate([
      { $match: { type: 'data_usage' } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    // Recent activity
    const recentTransactions = await Transaction.find()
      .populate('user', 'name email')
      .populate('performedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(10);

    // User balances summary
    const balanceStats = await User.aggregate([
      {
        $group: {
          _id: null,
          totalBalance: { $sum: "$ishareBalance" },
          avgBalance: { $avg: "$ishareBalance" },
          maxBalance: { $max: "$ishareBalance" },
          minBalance: { $min: "$ishareBalance" }
        }
      }
    ]);

    res.json({
      success: true,
      dashboard: {
        users: {
          total: totalUsers,
          active: activeUsers,
          newToday: newUsersToday,
          inactive: totalUsers - activeUsers
        },
        ishare: {
          totalLoads,
          totalDataLoaded: totalDataLoaded[0]?.total || 0,
          totalDataUsed: totalDataUsed[0]?.total || 0,
          remainingData: (totalDataLoaded[0]?.total || 0) - (totalDataUsed[0]?.total || 0)
        },
        balances: balanceStats[0] || {
          totalBalance: 0,
          avgBalance: 0,
          maxBalance: 0,
          minBalance: 0
        },
        recentActivity: recentTransactions
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Export Data (CSV format)
router.get('/export/:type', authenticate, adminOnly, async (req, res) => {
  try {
    const { type } = req.params;
    
    if (!['users', 'transactions', 'loads'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid export type. Use: users, transactions, or loads'
      });
    }

    let data = [];
    let filename = '';

    switch (type) {
      case 'users':
        data = await User.find().select('-password').lean();
        filename = `users_export_${new Date().toISOString().split('T')[0]}.json`;
        break;
      
      case 'transactions':
        data = await Transaction.find()
          .populate('user', 'name email')
          .populate('performedBy', 'name email')
          .lean();
        filename = `transactions_export_${new Date().toISOString().split('T')[0]}.json`;
        break;
      
      case 'loads':
        data = await IshareLoad.find()
          .populate('user', 'name email')
          .populate('loadedBy', 'name email')
          .lean();
        filename = `loads_export_${new Date().toISOString().split('T')[0]}.json`;
        break;
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.json({
      success: true,
      exportDate: new Date().toISOString(),
      type,
      count: data.length,
      data
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

router.get('/admin/test-provider-connectivity', authenticate, adminOnly, async (req, res) => {
  try {
    console.log('=== Admin Connectivity Test Started ===');
    console.log('Admin User:', req.user.email);
    
    const iShareService = require('../../Services/Ishare');
    const testResult = await iShareService.testConnectivity();

    res.json({
      success: testResult.connectivity,
      testResult,
      timestamp: new Date().toISOString(),
      testedBy: req.user.email
    });

  } catch (error) {
    console.error('Connectivity test route error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.stack,
      timestamp: new Date().toISOString(),
      testedBy: req.user.email
    });
  }
});

// Debug transfer with detailed logging (Admin only)
router.post('/admin/debug-transfer', authenticate, adminOnly, async (req, res) => {
  try {
    const { phoneNumber, amountMB = 50 } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required for debug transfer' });
    }

    const iShareService = require('../../Services/Ishare');
    const transactionId = iShareService.generateTransactionId('DEBUG');

    console.log('=== DEBUG TRANSFER START ===');
    console.log('Admin User:', req.user.email);
    console.log('Target Phone:', phoneNumber);
    console.log('Amount:', amountMB);
    console.log('Transaction ID:', transactionId);
    console.log('Timestamp:', new Date().toISOString());

    // Test the transfer without saving to database
    const result = await iShareService.sendTransfer(phoneNumber, amountMB, transactionId);

    console.log('=== DEBUG TRANSFER RESULT ===');
    console.log('Result:', JSON.stringify(result, null, 2));

    res.json({
      success: true,
      debugResult: result,
      testParameters: {
        phoneNumber,
        amountMB,
        transactionId,
        timestamp: new Date().toISOString(),
        testedBy: req.user.email
      },
      interpretation: {
        isSuccessful: result.success,
        responseCode: result.responseCode,
        errorMessage: result.success ? null : result.message,
        recommendations: result.success ? 
          ['Transfer should work normally'] : 
          [
            'Check error code: ' + result.responseCode,
            'Error message: ' + result.message,
            'Review phone number format',
            'Check provider balance',
            'Verify credentials'
          ]
      }
    });

  } catch (error) {
    console.error('=== DEBUG TRANSFER ERROR ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);

    res.json({
      success: false,
      error: error.message,
      errorDetails: {
        name: error.constructor.name,
        code: error.code,
        stack: error.stack
      },
      testParameters: {
        phoneNumber: req.body.phoneNumber,
        amountMB: req.body.amountMB || 50,
        timestamp: new Date().toISOString(),
        testedBy: req.user.email
      },
      recommendations: [
        'Check network connectivity',
        'Verify provider endpoint is accessible',
        'Check if credentials are correct',
        'Review phone number format'
      ]
    });
  }
});

// Test phone number formatting (Admin only)
router.post('/admin/test-phone-format', authenticate, adminOnly, async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const iShareService = require('../../Services/Ishare');
    
    console.log('=== PHONE FORMAT TEST ===');
    console.log('Admin User:', req.user.email);
    console.log('Input:', phoneNumber);

    const formatted = iShareService.formatMsisdn(phoneNumber);

    console.log('Formatted:', formatted);

    res.json({
      success: true,
      input: phoneNumber,
      formatted: formatted,
      inputType: typeof phoneNumber,
      inputLength: String(phoneNumber).length,
      formattedLength: formatted.length,
      analysis: {
        isValid: formatted.length === 12,
        startsWithCountryCode: formatted.startsWith('233'),
        mobilePrefix: formatted.substring(0, 5),
        recommendation: formatted.length === 12 ? 'Phone number formatted correctly' : 'Phone number format issue'
      },
      timestamp: new Date().toISOString(),
      testedBy: req.user.email
    });

  } catch (error) {
    console.error('Phone format test error:', error);
    res.json({
      success: false,
      input: req.body.phoneNumber,
      error: error.message,
      analysis: {
        isValid: false,
        reason: error.message,
        recommendation: 'Fix phone number format according to error message'
      },
      timestamp: new Date().toISOString(),
      testedBy: req.user.email
    });
  }
});

// Test provider credentials (Admin only)
router.get('/admin/test-provider-credentials', authenticate, adminOnly, async (req, res) => {
  try {
    console.log('=== Provider Credentials Test ===');
    console.log('Admin User:', req.user.email);
    
    const iShareService = require('../../Services/Ishare');
    
    // Test balance check to verify credentials
    const balanceResult = await iShareService.checkBalance();
    
    res.json({
      success: balanceResult.success,
      credentialsValid: balanceResult.success,
      balanceCheck: balanceResult,
      providerInfo: {
        endpoint: process.env.ISHARE_ENDPOINT || 'http://41.215.168.146:443/FlexiShareBundles.asmx',
        username: process.env.ISHARE_USERNAME || 'NetwiseSolutions',
        dealerMsisdn: process.env.ISHARE_DEALER_MSISDN || '233270241113'
      },
      analysis: {
        canConnect: balanceResult.responseCode !== null,
        authenticationWorking: balanceResult.responseCode === '200',
        recommendation: balanceResult.success ? 
          'Credentials are working correctly' : 
          `Check credentials. Error: ${balanceResult.message}`
      },
      timestamp: new Date().toISOString(),
      testedBy: req.user.email
    });

  } catch (error) {
    console.error('Credentials test error:', error);
    res.json({
      success: false,
      credentialsValid: false,
      error: error.message,
      analysis: {
        canConnect: false,
        authenticationWorking: false,
        recommendation: 'Check network connectivity and credentials'
      },
      timestamp: new Date().toISOString(),
      testedBy: req.user.email
    });
  }
});

// Get detailed provider configuration (Admin only)
router.get('/admin/provider-config', authenticate, adminOnly, async (req, res) => {
  try {
    res.json({
      configuration: {
        endpoint: process.env.ISHARE_ENDPOINT || 'http://41.215.168.146:443/FlexiShareBundles.asmx',
        username: process.env.ISHARE_USERNAME || 'NetwiseSolutions',
        dealerMsisdn: process.env.ISHARE_DEALER_MSISDN || '233270241113',
        passwordSet: !!(process.env.ISHARE_PASSWORD || 'f2fe6a63d960578490f3097d9447fcd0')
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        mongoUri: process.env.MONGODB_URI ? 'Set (MongoDB Atlas)' : 'Not set',
        jwtSecret: process.env.JWT_SECRET ? 'Set' : 'Not set'
      },
      serverInfo: {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.version,
        platform: process.platform
      },
      viewedBy: req.user.email
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATED: Check Provider Balance with enhanced logging (Admin only)
router.get('/admin/provider-balance', authenticate, adminOnly, async (req, res) => {
  try {
    console.log('=== Provider Balance Check ===');
    console.log('Admin User:', req.user.email);
    
    const iShareService = require('../../Services/Ishare');
    const balanceResult = await iShareService.checkBalance();

    console.log('Balance Result:', JSON.stringify(balanceResult, null, 2));

    res.json({
      success: balanceResult.success,
      providerBalance: {
        balance: balanceResult.balance,
        balanceInGB: balanceResult.balanceInGB,
        expireTime: balanceResult.expireTime,
        message: balanceResult.message,
        responseCode: balanceResult.responseCode
      },
      analysis: {
        hasBalance: balanceResult.balance > 0,
        balanceStatus: balanceResult.balance > 1000 ? 'Good' : 
                      balanceResult.balance > 100 ? 'Low' : 'Critical',
        recommendation: balanceResult.balance > 100 ? 
          'Balance is sufficient for transfers' : 
          'Balance is low, consider topping up'
      },
      timestamp: new Date().toISOString(),
      checkedBy: req.user.email
    });

  } catch (error) {
    console.error('Provider Balance Check Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check provider balance',
      details: error.message,
      timestamp: new Date().toISOString(),
      checkedBy: req.user.email
    });
  }
});

module.exports = router;