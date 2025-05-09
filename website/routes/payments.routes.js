const express = require('express');
const { createOrder, verifyPayment, logError } = require('../controllers/payments.controller');
const router = express.Router();

// Payment endpoints
router.post('/createOrder', createOrder);
router.post('/verifyPayment', verifyPayment);

// Error logging endpoint
router.post('/logError', logError);

// Add OPTIONS handling for CORS preflight requests
router.options('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Expose-Headers', 'x-rtb-fingerprint-id');
    res.sendStatus(200);
});

module.exports = router;