const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const VerificationSchema = new Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  type: {
    type: String,
    enum: ['aadhaar', 'pan', 'driving_license'],
    default: 'aadhaar',
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'otp_sent', 'otp_verified', 'verified', 'failed', 'expired'],
    default: 'pending',
    index: true
  },
  // Aadhaar fields (masked)
  maskedAadhaar: {
    type: String,
    // Format: XXXX XXXX 1234
  },
  // KYC Provider fields
  provider: {
    type: String,
    enum: ['cashfree', 'signzy', 'karza', 'mock'],
    default: 'cashfree'
  },
  transactionId: {
    type: String
  },
  refId: {
    type: String
  },
  // Verification data (masked/encrypted)
  verifiedData: {
    name: String,
    yearOfBirth: String,
    gender: String,
    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String
    },
    mobileHash: String,
    photoLink: String
  },
  // OTP fields
  otpSent: {
    type: Boolean,
    default: false
  },
  otpSentAt: Date,
  otpVerified: {
    type: Boolean,
    default: false
  },
  otpVerifiedAt: Date,
  otpAttempts: {
    type: Number,
    default: 0,
    max: 3
  },
  // Compliance
  consentGiven: {
    type: Boolean,
    default: false
  },
  consentGivenAt: Date,
  // Timestamps
  initiatedAt: Date,
  verifiedAt: Date,
  failedAt: Date,
  failureReason: String,
  // Metadata
  metadata: {
    ipAddress: String,
    userAgent: String,
    environment: String // sandbox or production
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for common queries
VerificationSchema.index({ userId: 1, status: 1 });
VerificationSchema.index({ transactionId: 1 });
VerificationSchema.index({ refId: 1 });
VerificationSchema.index({ createdAt: -1 });
VerificationSchema.index({ provider: 1, status: 1 });

// Pre-save hook to update updatedAt
VerificationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to find by userId
VerificationSchema.statics.findByUserId = function(userId) {
  return this.findOne({ userId });
};

// Static method to find by refId
VerificationSchema.statics.findByRefId = function(refId) {
  return this.findOne({ refId });
};

// Instance method to check if verification is complete
VerificationSchema.methods.isVerified = function() {
  return this.status === 'verified';
};

// Instance method to check if OTP attempts exceeded
VerificationSchema.methods.hasExceededAttempts = function() {
  return this.otpAttempts >= 3;
};

const Verification = model('Verification', VerificationSchema);

module.exports = Verification;

