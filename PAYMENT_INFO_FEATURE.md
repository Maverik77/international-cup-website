# Payment Info Feature - Implementation Summary

## Overview
Added payment information storage (Venmo/PayPal) and quick payment links to the betting admin payouts section, making it easy to pay out winners directly from the admin interface.

## Features

### 1. Payment Info Storage
- Store Venmo username for each bettor
- Store PayPal email/username for each bettor
- Payment info stored in the betslip record in DynamoDB
- Modal interface for adding/editing payment information

### 2. Payment Links
- **Venmo Links**: Click to open Venmo app/website with pre-filled:
  - Recipient username
  - Payment amount (calculated payout)
  - Note: "International Cup Betting Payout"
- **PayPal Links**: Click to open PayPal.me with pre-filled:
  - Recipient username/email
  - Payment amount (calculated payout)

### 3. User Interface
- New "Payment Links" column in Payouts table
- "Add Payment Info" button when no payment details exist
- Venmo and PayPal quick links when payment info is saved
- Edit button (✏️) to update existing payment information
- Modal dialog for entering/editing payment details

## Implementation Details

### Backend Changes

#### New Lambda Function: `updateBetslipPaymentInfo`
**Path**: `/betslips/{id}/payment-info` (PUT)
- Updates `venmoUsername` and `paypalUsername` fields on betslips
- Requires admin authentication
- Endpoint: `${API_URL}/betslips/{id}/payment-info`

#### Updated Lambda Function: `calculatePayouts`
- Now includes `venmoUsername` and `paypalUsername` in payout data
- Ensures payment info is available when rendering payouts

### Frontend Changes

#### HTML (`betting/admin.html`)
- Added Payment Info Modal with fields:
  - Bettor name (read-only)
  - Venmo username input
  - PayPal username/email input
- Added CSS styling for:
  - Payment links (Venmo blue, PayPal blue)
  - Add/Edit payment info buttons
  - Modal form inputs

#### JavaScript (`betting-admin.js`)
- `generatePaymentLinks(payout)`: Creates payment link HTML based on stored info
  - If no info: Shows "Add Payment Info" button
  - If info exists: Shows Venmo/PayPal links + edit button
- `openPaymentInfoModal(betslipId, name, venmoUsername, paypalUsername)`: Opens modal
- `closePaymentInfoModal()`: Closes modal
- `savePaymentInfo()`: Saves payment info to backend and refreshes UI

### Payment Link Formats

**Venmo:**
```
https://venmo.com/{username}?txn=pay&amount={amount}&note=International%20Cup%20Betting%20Payout
```

**PayPal:**
```
https://www.paypal.com/paypalme/{username}/{amount}
```

## Usage Instructions

### Adding Payment Info
1. Go to the Betting Admin page
2. Navigate to the "Payouts" tab
3. Click "➕ Add Payment Info" for any bettor without payment details
4. Enter their Venmo username (e.g., `@username`) and/or PayPal email
5. Click "💾 Save"

### Editing Payment Info
1. In the Payouts tab, click the "✏️" button next to existing payment links
2. Update the Venmo/PayPal information
3. Click "💾 Save"

### Sending Payments
1. In the Payouts tab, locate the bettor you want to pay
2. Click either the "💸 Venmo" or "💳 PayPal" link
3. The payment app/website will open with pre-filled:
   - Recipient
   - Amount (exact calculated payout)
   - Note/message
4. Review and complete the payment in Venmo/PayPal
5. Return to admin page and mark as "Paid Out"

## Deployment

### Backend (Staging)
```bash
./deploy-pairings-backend.sh staging icup2024staging
```

### Backend (Production)
```bash
./deploy-pairings-backend.sh prod icup2024
```

### Frontend
Staging:
```bash
aws s3 cp betting/admin.html s3://international-cup-website-staging-1757115851/betting/admin.html --profile icup_website_user
aws s3 cp js/betting-admin.js s3://international-cup-website-staging-1757115851/js/betting-admin.js --profile icup_website_user
```

Production:
```bash
aws s3 cp betting/admin.html s3://international-cup-website-1757115851/betting/admin.html --profile icup_website_user
aws s3 cp js/betting-admin.js s3://international-cup-website-1757115851/js/betting-admin.js --profile icup_website_user
```

### Cache Invalidation
```bash
# Staging
aws cloudfront create-invalidation --distribution-id E11VT1B5QAZ80O --paths "/betting/admin.html" "/js/betting-admin.js" --profile icup_website_user

# Production
aws cloudfront create-invalidation --distribution-id E1SY6AVH5CLGVS --paths "/betting/admin.html" "/js/betting-admin.js" --profile icup_website_user
```

## Testing

### Test in Staging
1. Visit staging admin page: `https://staging.{your-domain}/betting/admin.html`
2. Log in with staging password
3. Go to Payouts tab
4. Add payment info for a test betslip
5. Verify Venmo/PayPal links work correctly
6. Test editing payment info

### Test in Production
1. Visit production admin page: `https://{your-domain}/betting/admin.html`
2. Log in with production password
3. Follow same testing steps as staging

## Files Modified

### New Files
- `lambda/updateBetslipPaymentInfo/index.js` - New Lambda for updating payment info

### Modified Files
- `pairings-infrastructure.yaml` - Added UpdateBetslipPaymentInfoFunction
- `lambda/calculatePayouts/index.js` - Include payment info in payout response
- `betting/admin.html` - Added payment info modal and CSS
- `js/betting-admin.js` - Added payment link generation and modal handling

## Notes
- Payment info is optional - bettors without Venmo/PayPal will show "Add Payment Info"
- Venmo username can include or exclude the "@" symbol
- PayPal can accept either email address or PayPal.me username
- Payment links open in new tab
- All payment info changes are tracked with `paymentInfoUpdatedAt` timestamp
- Admin authentication required for all payment info operations

## Future Enhancements
- Bulk payment info import (CSV upload)
- Payment history tracking (record when payments were sent)
- Integration with payment APIs for automated payouts
- QR code generation for Venmo/PayPal payments





