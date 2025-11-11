const axios = require('axios');
const logger = require('../config/logger');
const { getCashfreeBaseUrl } = require('../config/env');

/**
 * Cashfree Service
 * Handles Aadhaar verification via Cashfree API
 * Supports both sandbox and production environments
 */
class CashfreeService {
  constructor() {
    this.baseUrl = null;
    this.clientId = null;
    this.clientSecret = null;
    this.environment = null;
    this.testOtp = null;
    this.initialized = false;
  }

  /**
   * Initialize the service with configuration
   */
  initialize(config) {
    this.baseUrl = config.CASHFREE_BASE_URL || getCashfreeBaseUrl(config);
    this.clientId = config.CASHFREE_CLIENT_ID;
    this.clientSecret = config.CASHFREE_CLIENT_SECRET;
    this.environment = config.CASHFREE_ENV || 'sandbox';
    this.testOtp = config.CASHFREE_TEST_OTP || '111000';
    this.initialized = true;

    logger.info('✅ Cashfree Service initialized', {
      environment: this.environment,
      baseUrl: this.baseUrl,
      hasClientId: !!this.clientId,
      hasClientSecret: !!this.clientSecret
    });
  }

  /**
   * Get request headers for Cashfree API
   */
  getHeaders() {
    if (!this.initialized) {
      throw new Error('Cashfree service not initialized. Call initialize() first.');
    }

    return {
      'x-client-id': this.clientId,
      'x-client-secret': this.clientSecret,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Generate OTP for Aadhaar verification
   * @param {string} aadhaarNumber - 12-digit Aadhaar number
   * @returns {Promise<{success: boolean, refId?: string, message?: string, status?: string}>}
   */
  async generateAadhaarOTP(aadhaarNumber) {
    if (!this.initialized) {
      throw new Error('Cashfree service not initialized');
    }

    // Validate Aadhaar format
    if (!/^\d{12}$/.test(aadhaarNumber)) {
      throw new Error('Invalid Aadhaar number format. Must be 12 digits.');
    }

    try {
      logger.info('🔄 Generating Aadhaar OTP', {
        aadhaarNumber: this.maskAadhaar(aadhaarNumber),
        environment: this.environment
      });

      const response = await axios.post(
        `${this.baseUrl}/offline-aadhaar/otp`,
        {
          aadhaar_number: aadhaarNumber
        },
        {
          headers: this.getHeaders(),
          timeout: 30000 // 30 seconds
        }
      );

      if (response.data && response.data.ref_id) {
        logger.info('✅ Aadhaar OTP generated successfully', {
          refId: response.data.ref_id,
          status: response.data.status
        });

        return {
          success: true,
          refId: response.data.ref_id,
          message: response.data.message || 'OTP sent successfully',
          status: response.data.status
        };
      } else {
        throw new Error('Invalid response from Cashfree API');
      }
    } catch (error) {
      logger.error('❌ Cashfree OTP generation error', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status
      });

      // Extract error message from response
      const errorMessage = error.response?.data?.message 
        || error.response?.data?.error 
        || error.message 
        || 'Failed to generate OTP';

      throw new Error(errorMessage);
    }
  }

  /**
   * Verify Aadhaar OTP
   * @param {string} refId - Reference ID from generateAadhaarOTP
   * @param {string} otp - OTP entered by user
   * @returns {Promise<{success: boolean, status?: string, verifiedData?: object, maskedAadhaar?: string, message?: string}>}
   */
  async verifyAadhaarOTP(refId, otp) {
    if (!this.initialized) {
      throw new Error('Cashfree service not initialized');
    }

    if (!refId || !otp) {
      throw new Error('refId and otp are required');
    }

    try {
      logger.info('🔄 Verifying Aadhaar OTP', {
        refId,
        otpLength: otp.length,
        environment: this.environment
      });

      const response = await axios.post(
        `${this.baseUrl}/offline-aadhaar/verify`,
        {
          ref_id: refId,
          otp: otp
        },
        {
          headers: this.getHeaders(),
          timeout: 30000 // 30 seconds
        }
      );

      const data = response.data;

      if (data.status === 'VALID' || data.status === 'SUCCESS') {
        logger.info('✅ Aadhaar OTP verified successfully', {
          refId,
          status: data.status
        });

        // Always mask Aadhaar number for security compliance
        // Cashfree may return full aadhaar_number, but we should never store it
        const aadhaarFromResponse = data.aadhaar_number || data.masked_aadhaar || '';
        const maskedAadhaarValue = aadhaarFromResponse.length === 12 
          ? this.maskAadhaar(aadhaarFromResponse) 
          : (data.masked_aadhaar || 'XXXX XXXX XXXX');

        return {
          success: true,
          status: 'verified',
          refId: data.ref_id,
          maskedAadhaar: maskedAadhaarValue,
          verifiedData: {
            name: data.name,
            gender: data.gender,
            yearOfBirth: data.year_of_birth || data.yearOfBirth,
            address: data.address ? {
              line1: data.address.line1 || data.address,
              line2: data.address.line2,
              city: data.address.city,
              state: data.address.state,
              pincode: data.address.pincode || data.address.pinCode
            } : null,
            mobileHash: data.mobile_hash || data.mobileHash,
            photoLink: data.photo_link || data.photoLink
          },
          message: data.message || 'Aadhaar Verification Successful'
        };
      } else {
        logger.warn('⚠️ Aadhaar OTP verification failed', {
          refId,
          status: data.status,
          message: data.message
        });

        return {
          success: false,
          status: 'failed',
          message: data.message || 'Verification failed',
          refId: data.ref_id
        };
      }
    } catch (error) {
      logger.error('❌ Cashfree OTP verification error', {
        error: error.message,
        refId,
        response: error.response?.data,
        status: error.response?.status
      });

      // Extract error message from response
      const errorMessage = error.response?.data?.message 
        || error.response?.data?.error 
        || error.message 
        || 'Failed to verify OTP';

      throw new Error(errorMessage);
    }
  }

  /**
   * Mask Aadhaar number (format: XXXX XXXX 1234)
   * @param {string} aadhaarNumber - 12-digit Aadhaar number
   * @returns {string} Masked Aadhaar number
   */
  maskAadhaar(aadhaarNumber) {
    if (!aadhaarNumber || aadhaarNumber.length !== 12) {
      return 'XXXX XXXX XXXX';
    }
    const last4 = aadhaarNumber.slice(-4);
    return `XXXX XXXX ${last4}`;
  }

  /**
   * Get test OTP for sandbox environment
   * @returns {string} Test OTP value
   */
  getTestOtp() {
    return this.testOtp;
  }

  /**
   * Check if service is in sandbox mode
   * @returns {boolean}
   */
  isSandbox() {
    return this.environment === 'sandbox';
  }
}

// Export singleton instance
const cashfreeService = new CashfreeService();

module.exports = cashfreeService;

