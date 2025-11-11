const express = require('express');
const router = express.Router();
const Verification = require('../models/Verification');
const cashfreeService = require('../services/cashfreeService');
const { serviceAuthMiddleware } = require('../middleware/auth');
const { isValidAadhaarFormat, cleanAadhaarNumber, isValidOtpFormat, maskAadhaar } = require('../utils/validation');
const { successResponse, errorResponse, getClientIp } = require('../utils/helpers');
const logger = require('../config/logger');

/**
 * POST /api/v1/verification/aadhaar/initiate
 * Initiate Aadhaar KYC - Generate OTP
 */
router.post('/aadhaar/initiate', serviceAuthMiddleware, async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;
    const { aadhaarNumber, consentGiven } = req.body;

    // Validation
    if (!userId) {
      return res.status(400).json(errorResponse(
        'Missing required field: userId',
        'User ID is required'
      ));
    }

    if (!aadhaarNumber) {
      return res.status(400).json(errorResponse(
        'Missing required field: aadhaarNumber',
        'Aadhaar number is required'
      ));
    }

    if (!consentGiven) {
      return res.status(400).json(errorResponse(
        'User consent required',
        'User consent is required for Aadhaar verification'
      ));
    }

    // Clean and validate Aadhaar number
    const cleanedAadhaar = cleanAadhaarNumber(aadhaarNumber);
    if (!isValidAadhaarFormat(cleanedAadhaar)) {
      return res.status(400).json(errorResponse(
        'Invalid Aadhaar number format',
        'Aadhaar number must be exactly 12 digits'
      ));
    }

    logger.info('🔄 Initiating Aadhaar verification', {
      userId,
      maskedAadhaar: maskAadhaar(cleanedAadhaar),
      ip: getClientIp(req)
    });

    // Check if verification already exists and is verified
    let verification = await Verification.findByUserId(userId);
    
    if (verification && verification.status === 'verified') {
      logger.warn('⚠️ User already verified', { userId });
      return res.status(400).json(errorResponse(
        'User is already verified',
        'This user has already completed Aadhaar verification'
      ));
    }

    // Generate OTP via Cashfree
    const otpResult = await cashfreeService.generateAadhaarOTP(cleanedAadhaar);

    if (!otpResult.success) {
      return res.status(400).json(errorResponse(
        otpResult.message || 'Failed to generate OTP',
        'Could not initiate Aadhaar verification'
      ));
    }

    // Save verification record
    const verificationData = {
      userId,
      type: 'aadhaar',
      status: 'otp_sent',
      provider: 'cashfree',
      transactionId: otpResult.refId,
      refId: otpResult.refId,
      maskedAadhaar: maskAadhaar(cleanedAadhaar),
      otpSent: true,
      otpSentAt: new Date(),
      consentGiven: true,
      consentGivenAt: new Date(),
      initiatedAt: new Date(),
      metadata: {
        ipAddress: getClientIp(req),
        userAgent: req.get('user-agent') || 'unknown',
        environment: process.env.CASHFREE_ENV || 'sandbox'
      }
    };

    if (verification) {
      // Update existing verification
      Object.assign(verification, verificationData);
      await verification.save();
    } else {
      // Create new verification
      verification = await Verification.create(verificationData);
    }

    logger.info('✅ Aadhaar verification initiated', {
      userId,
      refId: otpResult.refId,
      status: 'otp_sent'
    });

    const response = successResponse({
      transactionId: otpResult.refId,
      refId: otpResult.refId,
      maskedAadhaar: verificationData.maskedAadhaar
    }, 'OTP sent successfully');

    // In sandbox, include test OTP for testing convenience
    if (cashfreeService.isSandbox()) {
      response.data.testOtp = cashfreeService.getTestOtp();
      response.data.message = 'OTP sent successfully (Sandbox mode - use test OTP for testing)';
    }

    res.json(response);
  } catch (error) {
    logger.error('❌ Error initiating Aadhaar KYC', {
      error: error.message,
      stack: error.stack,
      userId: req.headers['x-user-id'] || req.body.userId
    });

    res.status(500).json(errorResponse(
      error.message || 'Failed to initiate Aadhaar verification',
      'An error occurred while initiating verification'
    ));
  }
});

/**
 * POST /api/v1/verification/aadhaar/verify
 * Verify Aadhaar OTP
 */
router.post('/aadhaar/verify', serviceAuthMiddleware, async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body.userId;
    const { transactionId, refId, otp } = req.body;

    // Validation
    if (!userId) {
      return res.status(400).json(errorResponse(
        'Missing required field: userId',
        'User ID is required'
      ));
    }

    const verificationRefId = refId || transactionId;
    if (!verificationRefId) {
      return res.status(400).json(errorResponse(
        'Missing required field: refId or transactionId',
        'Reference ID is required'
      ));
    }

    if (!otp) {
      return res.status(400).json(errorResponse(
        'Missing required field: otp',
        'OTP is required'
      ));
    }

    if (!isValidOtpFormat(otp)) {
      return res.status(400).json(errorResponse(
        'Invalid OTP format',
        'OTP must be 6 digits'
      ));
    }

    logger.info('🔄 Verifying Aadhaar OTP', {
      userId,
      refId: verificationRefId,
      ip: getClientIp(req)
    });

    // Get verification record
    const verification = await Verification.findOne({ 
      userId, 
      $or: [
        { refId: verificationRefId },
        { transactionId: verificationRefId }
      ]
    });

    if (!verification) {
      logger.warn('⚠️ Verification session not found', { userId, refId: verificationRefId });
      return res.status(404).json(errorResponse(
        'Verification session not found',
        'No active verification session found for this user'
      ));
    }

    if (verification.status !== 'otp_sent') {
      return res.status(400).json(errorResponse(
        'OTP not sent for this verification',
        `Verification status is: ${verification.status}`
      ));
    }

    // Check OTP attempts
    if (verification.hasExceededAttempts()) {
      verification.status = 'failed';
      verification.failedAt = new Date();
      verification.failureReason = 'Maximum OTP attempts exceeded';
      await verification.save();

      logger.warn('⚠️ Maximum OTP attempts exceeded', { userId, refId: verificationRefId });
      return res.status(400).json(errorResponse(
        'Maximum OTP attempts exceeded',
        'You have exceeded the maximum number of OTP verification attempts'
      ));
    }

    // Verify OTP via Cashfree
    const verifyResult = await cashfreeService.verifyAadhaarOTP(verificationRefId, otp);

    // Update verification record
    if (verifyResult.success) {
      verification.status = 'verified';
      verification.otpVerified = true;
      verification.otpVerifiedAt = new Date();
      verification.verifiedAt = new Date();
      verification.verifiedData = verifyResult.verifiedData;
      // Always update maskedAadhaar if provided, otherwise keep existing value
      if (verifyResult.maskedAadhaar) {
        verification.maskedAadhaar = verifyResult.maskedAadhaar;
      }
      verification.otpAttempts = 0; // Reset attempts on success
    } else {
      verification.otpAttempts = (verification.otpAttempts || 0) + 1;
      verification.status = verifyResult.message.includes('OTP') ? 'otp_sent' : 'failed';
      verification.failureReason = verifyResult.message;
      
      if (verification.otpAttempts >= 3) {
        verification.status = 'failed';
        verification.failedAt = new Date();
      }
    }

    await verification.save();

    if (verifyResult.success) {
      logger.info('✅ Aadhaar OTP verified successfully', {
        userId,
        refId: verificationRefId,
        status: 'verified'
      });

      res.json(successResponse({
        status: 'verified',
        maskedAadhaar: verifyResult.maskedAadhaar,
        verifiedData: {
          name: verifyResult.verifiedData.name,
          gender: verifyResult.verifiedData.gender,
          yearOfBirth: verifyResult.verifiedData.yearOfBirth
        }
      }, 'Aadhaar verification successful'));
    } else {
      logger.warn('⚠️ Aadhaar OTP verification failed', {
        userId,
        refId: verificationRefId,
        attempts: verification.otpAttempts,
        message: verifyResult.message
      });

      res.status(400).json(errorResponse(
        verifyResult.message || 'OTP verification failed',
        `Verification failed. ${3 - verification.otpAttempts} attempts remaining.`
      ));
    }
  } catch (error) {
    logger.error('❌ Error verifying Aadhaar OTP', {
      error: error.message,
      stack: error.stack,
      userId: req.headers['x-user-id'] || req.body.userId
    });

    res.status(500).json(errorResponse(
      error.message || 'Failed to verify OTP',
      'An error occurred while verifying OTP'
    ));
  }
});

/**
 * GET /api/v1/verification/status/:userId
 * Get verification status for a user
 */
router.get('/status/:userId', serviceAuthMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    const verification = await Verification.findByUserId(userId);

    if (!verification) {
      return res.json(successResponse({
        status: 'not_initiated',
        isVerified: false
      }, 'Verification not initiated'));
    }

    res.json(successResponse({
      status: verification.status,
      isVerified: verification.isVerified(),
      type: verification.type,
      maskedAadhaar: verification.maskedAadhaar,
      provider: verification.provider,
      verifiedAt: verification.verifiedAt,
      attemptsRemaining: Math.max(0, 3 - (verification.otpAttempts || 0))
    }));
  } catch (error) {
    logger.error('❌ Error fetching verification status', {
      error: error.message,
      userId: req.params.userId
    });

    res.status(500).json(errorResponse(
      error.message || 'Failed to fetch verification status',
      'An error occurred while fetching verification status'
    ));
  }
});

/**
 * GET /api/v1/verification/badge/:userId
 * Get verification badge data for display
 */
router.get('/badge/:userId', serviceAuthMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    const verification = await Verification.findByUserId(userId);

    if (!verification || !verification.isVerified()) {
      return res.json(successResponse({
        isVerified: false,
        badge: null
      }));
    }

    res.json(successResponse({
      isVerified: true,
      badge: {
        type: verification.type,
        status: verification.status,
        verifiedAt: verification.verifiedAt,
        maskedAadhaar: verification.maskedAadhaar,
        provider: verification.provider
      }
    }));
  } catch (error) {
    logger.error('❌ Error fetching verification badge', {
      error: error.message,
      userId: req.params.userId
    });

    res.status(500).json(errorResponse(
      error.message || 'Failed to fetch verification badge',
      'An error occurred while fetching verification badge'
    ));
  }
});

module.exports = router;

