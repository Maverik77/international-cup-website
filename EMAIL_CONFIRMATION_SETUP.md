# Email Confirmation Setup

This document explains how to set up automated email confirmations for betslip submissions using AWS SES (Simple Email Service).

## Overview

When a user submits a betslip, they will automatically receive a beautifully formatted confirmation email containing:
- Their bet slip ID
- All bet details with player names
- A direct link to view their betslip online
- Payment instructions
- Total amount

## Setup Steps

### 1. Verify Sender Email Address

AWS SES requires you to verify the email address you want to send from. You have two options:

#### Option A: Use a real email address you control
```bash
./setup-ses-email.sh your-email@example.com
```

Then check your inbox and click the verification link.

#### Option B: Use a custom domain email
If you own the domain `lansdowne-international-cup.com`, you can verify the entire domain:

```bash
aws ses verify-domain-identity \
  --domain lansdowne-international-cup.com \
  --profile icup_website_user
```

Then add the provided DNS records to your domain's DNS configuration.

### 2. Check Verification Status

```bash
aws ses get-identity-verification-attributes \
  --identities your-email@example.com \
  --profile icup_website_user
```

Look for `VerificationStatus: "Success"`

### 3. Request Production Access (Optional)

By default, SES is in "Sandbox" mode, which only allows:
- Sending to verified email addresses
- Maximum 200 emails per 24 hours

To send to any email address (for production use):

1. Go to AWS Console → SES → Account dashboard
2. Click "Request production access"
3. Fill out the form explaining your use case
4. AWS typically approves within 24 hours

### 4. Deploy with Email Enabled

The email functionality is included in the infrastructure deployment:

```bash
# Build
sam build --template pairings-infrastructure.yaml --profile icup_website_user

# Deploy to staging
sam deploy \
  --template-file .aws-sam/build/template.yaml \
  --profile icup_website_user \
  --stack-name icup-pairings-staging \
  --parameter-overrides \
    Environment=staging \
    AdminPassword=icup2024 \
    SenderEmail=your-verified-email@example.com \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --no-confirm-changeset
```

## Testing

1. **Submit a test bet:**
   - Go to staging betting page
   - Fill out the form with your email
   - Submit bets

2. **Check your inbox:**
   - You should receive a confirmation email within seconds
   - Click the "View Your Bet Slip" button
   - Verify it takes you to the lookup page with your betslip

## Email Template

The email includes:
- **Professional design** with gradient header
- **Responsive layout** that works on mobile and desktop
- **All bet details** including player names and amounts
- **Direct link** to lookup page with betslip ID pre-filled
- **Payment reminder** with betslip ID to include in payment note
- **Plain text alternative** for email clients that don't support HTML

## Costs

AWS SES costs:
- **First 62,000 emails/month**: $0 (free tier)
- **Additional emails**: $0.10 per 1,000 emails

For a tournament with even 1,000 participants, the cost would be less than $1.

## Troubleshooting

### Email not received

1. **Check verification status:**
   ```bash
   aws ses get-identity-verification-attributes \
     --identities your-email@example.com \
     --profile icup_website_user
   ```

2. **Check spam folder:** First emails from new senders often go to spam

3. **Check SES sandbox mode:** In sandbox, you can only send to verified addresses

4. **Check Lambda logs:**
   ```bash
   aws logs tail /aws/lambda/SendBetslipConfirmationFunction \
     --follow \
     --profile icup_website_user
   ```

### "Email address not verified" error

You need to verify the sender email address first:
```bash
./setup-ses-email.sh your-email@example.com
```

### Emails going to spam

1. Verify your domain (not just email address)
2. Set up SPF, DKIM, and DMARC records
3. AWS provides these records when you verify your domain

## Alternative: Using Your Personal Email

For testing or small tournaments, you can use your personal email (Gmail, etc.):

1. Verify your personal email:
   ```bash
   ./setup-ses-email.sh youremail@gmail.com
   ```

2. Deploy with that email:
   ```bash
   SenderEmail=youremail@gmail.com
   ```

3. Note: Users will see the email coming from your personal address

## Production Recommendations

For production use:
1. ✅ Verify a custom domain email (e.g., `noreply@lansdowne-international-cup.com`)
2. ✅ Request production access from AWS
3. ✅ Set up proper DNS records (SPF, DKIM, DMARC)
4. ✅ Monitor bounces and complaints in SES console
5. ✅ Consider setting up a reply-to email for questions

## Files

- `lambda/sendBetslipConfirmation/index.js` - Email sending Lambda function
- `lambda/createBetslip/index.js` - Triggers email after creating betslip
- `setup-ses-email.sh` - Helper script to verify email addresses
- `pairings-infrastructure.yaml` - Infrastructure with SES permissions

