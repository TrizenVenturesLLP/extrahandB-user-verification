#!/bin/bash

# Test script for Verification Service
# Tests the complete Aadhaar verification flow

SERVICE_URL="http://localhost:4004"
SERVICE_AUTH="test-shared-secret-token-12345-change-in-production"
USER_ID="test-user-123"
TEST_AADHAAR="655675523712"
TEST_OTP="111000"

echo "🧪 Testing Verification Service"
echo "================================"
echo ""

# Step 1: Test Health Check
echo "1️⃣ Testing Health Check..."
HEALTH_RESPONSE=$(curl -s "$SERVICE_URL/health")
echo "Response: $HEALTH_RESPONSE"
echo ""

# Step 2: Initiate Verification
echo "2️⃣ Initiating Aadhaar Verification..."
echo "   Aadhaar: $TEST_AADHAAR"
INITIATE_RESPONSE=$(curl -s -X POST "$SERVICE_URL/api/v1/verification/aadhaar/initiate" \
  -H "Content-Type: application/json" \
  -H "X-Service-Auth: $SERVICE_AUTH" \
  -H "X-User-Id: $USER_ID" \
  -d "{\"aadhaarNumber\": \"$TEST_AADHAAR\", \"consentGiven\": true}")

echo "Response: $INITIATE_RESPONSE"
echo ""

# Extract refId from response
REF_ID=$(echo $INITIATE_RESPONSE | grep -o '"refId":"[^"]*' | cut -d'"' -f4)

if [ -z "$REF_ID" ]; then
  echo "❌ Failed to get refId from initiate response"
  echo "Full response: $INITIATE_RESPONSE"
  exit 1
fi

echo "✅ Got refId: $REF_ID"
echo ""

# Step 3: Verify OTP
echo "3️⃣ Verifying OTP..."
echo "   refId: $REF_ID"
echo "   OTP: $TEST_OTP"
VERIFY_RESPONSE=$(curl -s -X POST "$SERVICE_URL/api/v1/verification/aadhaar/verify" \
  -H "Content-Type: application/json" \
  -H "X-Service-Auth: $SERVICE_AUTH" \
  -H "X-User-Id: $USER_ID" \
  -d "{\"refId\": \"$REF_ID\", \"otp\": \"$TEST_OTP\"}")

echo "Response: $VERIFY_RESPONSE"
echo ""

# Step 4: Check Status
echo "4️⃣ Checking Verification Status..."
STATUS_RESPONSE=$(curl -s -X GET "$SERVICE_URL/api/v1/verification/status/$USER_ID" \
  -H "X-Service-Auth: $SERVICE_AUTH")

echo "Response: $STATUS_RESPONSE"
echo ""

# Step 5: Check Badge
echo "5️⃣ Checking Verification Badge..."
BADGE_RESPONSE=$(curl -s -X GET "$SERVICE_URL/api/v1/verification/badge/$USER_ID" \
  -H "X-Service-Auth: $SERVICE_AUTH")

echo "Response: $BADGE_RESPONSE"
echo ""

echo "✅ Testing Complete!"

