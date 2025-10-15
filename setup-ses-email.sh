#!/bin/bash

# Setup SES Email Identity
# This script verifies an email address in Amazon SES for sending confirmation emails

set -e

# Configuration
AWS_PROFILE="icup_website_user"
SENDER_EMAIL="${1:-noreply@lansdowne-international-cup.com}"

echo "🔐 Setting up SES Email Identity"
echo "================================="
echo ""
echo "Sender Email: $SENDER_EMAIL"
echo "AWS Profile: $AWS_PROFILE"
echo ""

# Check if email is already verified
echo "Checking verification status..."
VERIFICATION_STATUS=$(aws ses get-identity-verification-attributes \
    --identities "$SENDER_EMAIL" \
    --profile "$AWS_PROFILE" \
    --query "VerificationAttributes.\"$SENDER_EMAIL\".VerificationStatus" \
    --output text 2>/dev/null || echo "NotFound")

if [ "$VERIFICATION_STATUS" == "Success" ]; then
    echo "✅ Email $SENDER_EMAIL is already verified!"
    exit 0
fi

if [ "$VERIFICATION_STATUS" == "Pending" ]; then
    echo "⏳ Email verification is pending. Please check your inbox for the verification email."
    exit 0
fi

# Verify the email address
echo "📧 Sending verification email to $SENDER_EMAIL..."
aws ses verify-email-identity \
    --email-address "$SENDER_EMAIL" \
    --profile "$AWS_PROFILE"

echo ""
echo "✅ Verification email sent!"
echo ""
echo "📬 IMPORTANT: Check the inbox for $SENDER_EMAIL"
echo "   and click the verification link in the email from Amazon SES."
echo ""
echo "⏰ The verification link expires in 24 hours."
echo ""
echo "To check verification status, run:"
echo "  aws ses get-identity-verification-attributes --identities $SENDER_EMAIL --profile $AWS_PROFILE"
echo ""

