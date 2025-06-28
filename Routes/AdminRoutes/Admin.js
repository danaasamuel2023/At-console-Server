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

module.exports = router;