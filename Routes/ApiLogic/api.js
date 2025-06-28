const express = require('express');
const { User, IshareLoad, Transaction, IshareTransfer } = require('../../Schema/Schema');
const {
  authenticateAPI,
  apiRateLimit
} = require('../../MiddleWare/Middle');

const router = express.Router();

// ==================== API INFO ROUTES ====================

// API Status & Info
router.get('/status', (req, res) => {
  res.json({
    service: 'ISHARE API',
    version: '2.0.0',
    status: 'active',
    endpoints: {
      profile: 'GET /api/user/profile',
      balance: 'GET /api/user/balance',
      useData: 'POST /api/use-data',
      transferSend: 'POST /api/transfer/send',
      transfers: 'GET /api/transfers',
      usageHistory: 'GET /api/usage-history',
      stats: 'GET /api/stats',
      regenerateKey: 'POST /api/user/regenerate-api-key'
    },
    authentication: 'X-API-Key header required',
    note: 'Simple API key authentication - no JWT tokens needed'
  });
});

// ==================== USER ROUTES ====================

// Get User Profile (API)
router.get('/user/profile', authenticateAPI, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      phoneNumber: req.user.phoneNumber,
      role: req.user.role,
      ishareBalance: req.user.ishareBalance,
      balanceInGB: (req.user.ishareBalance / 1024).toFixed(2),
      apiKey: req.user.apiKey,
      createdAt: req.user.createdAt
    }
  });
});

// Check User Balance (API)
router.get('/user/balance', authenticateAPI, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    res.json({
      success: true,
      ishareBalance: user.ishareBalance,
      balanceInGB: (user.ishareBalance / 1024).toFixed(2),
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        phoneNumber: user.phoneNumber
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Regenerate API Key (API)
router.post('/user/regenerate-api-key', authenticateAPI, async (req, res) => {
  try {
    const crypto = require('crypto');
    const newApiKey = crypto.randomBytes(32).toString('hex');
    
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { apiKey: newApiKey },
      { new: true }
    ).select('-password');

    res.json({ 
      success: true,
      message: 'API key regenerated successfully',
      apiKey: user.apiKey
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get Usage History (API)
router.get('/usage-history', authenticateAPI, async (req, res) => {
  try {
    const { type = 'all' } = req.query; // 'data_usage', 'transfers', 'loads', or 'all'
    
    let query = { user: req.user._id };
    
    if (type !== 'all') {
      if (type === 'transfers') {
        query.type = { $in: ['transfer_sent', 'transfer_received'] };
      } else {
        query.type = type;
      }
    }

    const transactions = await Transaction.find(query)
      .populate('ishareLoad', 'reason')
      .populate('ishareTransfer', 'recipientPhoneNumber note')
      .sort({ createdAt: -1 })
      .limit(100);
    
    res.json({
      success: true,
      history: transactions.map(tx => ({
        id: tx._id,
        type: tx.type,
        amount: tx.amount,
        method: tx.method,
        description: tx.description,
        date: tx.createdAt,
        details: tx.ishareLoad || tx.ishareTransfer || null
      }))
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// ==================== TRANSFER ROUTES ====================

// Send ISHARE Transfer (API) - NO RECIPIENT CHECK
router.post('/transfer/send', authenticateAPI, apiRateLimit, async (req, res) => {
  try {
    const { phoneNumber, amountMB, note } = req.body;

    // Validation
    if (!phoneNumber || !/^\d{10}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Phone number must be exactly 10 digits'
      });
    }

    if (!amountMB || amountMB < 1) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be at least 1MB'
      });
    }

    if (req.user.ishareBalance < amountMB) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient balance',
        details: {
          available: req.user.ishareBalance,
          requested: amountMB,
          deficit: amountMB - req.user.ishareBalance
        }
      });
    }

    // Create transfer record without checking if recipient exists
    const transfer = new IshareTransfer({
      sender: req.user._id,
      recipientPhoneNumber: phoneNumber,
      recipient: null, // No recipient user required
      amountMB,
      note: note || '',
      status: 'completed'
    });

    await transfer.save();

    // Deduct amount from sender's balance
    const updatedSender = await User.findByIdAndUpdate(
      req.user._id,
      { $inc: { ishareBalance: -amountMB } },
      { new: true }
    );

    // Create transaction for sender
    const senderTransaction = new Transaction({
      user: req.user._id,
      type: 'transfer_sent',
      amount: -amountMB, // Negative for deduction
      method: 'api',
      ishareTransfer: transfer._id,
      description: `Sent ${amountMB}MB to ${phoneNumber}`
    });

    await senderTransaction.save();

    res.status(200).json({
      success: true,
      message: 'ISHARE sent successfully',
      transfer: {
        id: transfer._id,
        recipientPhoneNumber: phoneNumber,
        amountMB,
        status: 'completed',
        note: transfer.note,
        transferDate: transfer.createdAt
      },
      senderNewBalance: updatedSender.ishareBalance
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get Transfer History (API)
router.get('/transfers', authenticateAPI, async (req, res) => {
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
      note: transfer.note
    }));

    res.json({
      success: true,
      transfers: formattedTransfers,
      total: formattedTransfers.length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== DATA USAGE ROUTES ====================

// Use ISHARE Data (API)
router.post('/use-data', authenticateAPI, apiRateLimit, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({
        success: false,
        error: 'amount is required'
      });
    }

    if (amount <= 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid amount' 
      });
    }

    if (req.user.ishareBalance < amount) {
      return res.status(400).json({ 
        success: false,
        error: 'Insufficient balance',
        details: {
          available: req.user.ishareBalance,
          requested: amount,
          deficit: amount - req.user.ishareBalance
        }
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
      method: 'api',
      description: `Used ${amount}MB of data`
    });

    await transaction.save();

    res.json({
      success: true,
      message: 'Data usage recorded successfully',
      usage: {
        userId: req.user._id,
        userEmail: req.user.email,
        userName: req.user.name,
        usedAmount: amount,
        remainingBalance: updatedUser.ishareBalance,
        usageDate: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Check Provider Balance (API) - Admin/Developer only
router.get('/provider/balance', authenticateAPI, async (req, res) => {
  try {
    // Only admins and developers can check provider balance
    if (req.user.role !== 'admin' && req.user.role !== 'developer') {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to check provider balance'
      });
    }

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

// Check Transaction Status (API)
router.get('/transfer/status/:transactionId', authenticateAPI, async (req, res) => {
  try {
    const { transactionId } = req.params;

    // Find the transfer record
    const transfer = await IshareTransfer.findOne({
      externalTransactionId: transactionId,
      sender: req.user._id
    });

    if (!transfer) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    // If transaction was successful, check with provider
    if (transfer.status === 'completed' || transfer.status === 'pending') {
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
            providerStatus: {
              error: 'Could not check provider status',
              message: providerError.message
            }
          }
        });
      }
    } else {
      // Return local status for failed transfers
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
      success: false,
      error: error.message
    });
  }
});

// Get User Stats (API)
router.get('/stats', authenticateAPI, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      // Admin stats - system-wide overview
      const totalUsers = await User.countDocuments({ isActive: true });
      const totalLoads = await IshareLoad.countDocuments();
      const totalTransfers = await IshareTransfer.countDocuments();
      
      const allLoads = await IshareLoad.find();
      const allTransfers = await IshareTransfer.find();
      const allUsage = await Transaction.find({ type: 'data_usage' });

      const totalDataLoaded = allLoads.reduce((sum, load) => sum + load.amountMB, 0);
      const totalDataTransferred = allTransfers.reduce((sum, transfer) => sum + transfer.amountMB, 0);
      const totalDataUsed = allUsage.reduce((sum, tx) => sum + tx.amount, 0);

      res.json({
        success: true,
        stats: {
          role: req.user.role,
          systemOverview: {
            totalUsers,
            totalLoads,
            totalTransfers,
            totalDataLoaded: `${totalDataLoaded} MB`,
            totalDataTransferred: `${totalDataTransferred} MB`,
            totalDataUsed: `${totalDataUsed} MB`
          },
          user: {
            name: req.user.name,
            email: req.user.email,
            phoneNumber: req.user.phoneNumber,
            currentBalance: `${req.user.ishareBalance} MB`
          }
        }
      });

    } else if (req.user.role === 'developer') {
      // Developer stats - loads they performed
      const loads = await IshareLoad.find({ 
        loadedBy: req.user._id
      }).populate('user', 'email name phoneNumber');

      const totalLoads = loads.length;
      const totalDataLoaded = loads.reduce((sum, load) => sum + load.amountMB, 0);

      // Get transfers they sent
      const transfersSent = await IshareTransfer.find({ sender: req.user._id });
      const totalTransfersSent = transfersSent.length;
      const totalDataSent = transfersSent.reduce((sum, transfer) => sum + transfer.amountMB, 0);

      res.json({
        success: true,
        stats: {
          role: req.user.role,
          activity: {
            totalLoads,
            totalDataLoaded: `${totalDataLoaded} MB`,
            totalTransfersSent,
            totalDataSent: `${totalDataSent} MB`
          },
          user: {
            name: req.user.name,
            email: req.user.email,
            phoneNumber: req.user.phoneNumber,
            currentBalance: `${req.user.ishareBalance} MB`
          }
        }
      });

    } else {
      // Regular user stats - their own activity
      const userLoads = await IshareLoad.find({ user: req.user._id });
      const userUsage = await Transaction.find({ 
        user: req.user._id,
        type: 'data_usage' 
      });
      const transfersSent = await IshareTransfer.find({ sender: req.user._id });
      const transfersReceived = await IshareTransfer.find({ recipient: req.user._id });

      const totalLoaded = userLoads.reduce((sum, load) => sum + load.amountMB, 0);
      const totalUsed = userUsage.reduce((sum, transaction) => sum + transaction.amount, 0);
      const totalSent = transfersSent.reduce((sum, transfer) => sum + transfer.amountMB, 0);
      const totalReceived = transfersReceived.reduce((sum, transfer) => sum + transfer.amountMB, 0);

      res.json({
        success: true,
        stats: {
          role: req.user.role,
          activity: {
            totalDataLoaded: `${totalLoaded} MB`,
            totalDataUsed: `${totalUsed} MB`,
            totalTransfersSent: transfersSent.length,
            totalDataSent: `${totalSent} MB`,
            totalTransfersReceived: transfersReceived.length,
            totalDataReceived: `${totalReceived} MB`,
            currentBalance: `${req.user.ishareBalance} MB`
          },
          user: {
            name: req.user.name,
            email: req.user.email,
            phoneNumber: req.user.phoneNumber
          }
        }
      });
    }
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

module.exports = router;