# Betting Results Email Notification System

## Overview
Create an email notification system to inform bettors about their bet results, including individual bet outcomes, payout calculations, and overall statistics.

## Components

### 1. Database Schema Update
Add tracking field to betslips table:
- `resultsEmailSent` (boolean) - Track if results email has been sent
- `resultsEmailSentAt` (timestamp) - When the email was sent

### 2. Backend - Lambda Function

**Create `lambda/sendBetslipResults/index.js`:**

Features:
- Fetch betslip details with match results
- Calculate payout breakdown
- Generate HTML email with:
  - Bettor name and betslip ID
  - Individual bet results (match, team, outcome, amount)
  - Summary statistics (total pot, multiplier, won/lost/tied amounts)
  - Final payout amount
  - Payment status
- Send via AWS SES
- Update betslip with `resultsEmailSent: true`
- Support bulk sending (array of betslip IDs)

Email Template Structure:
```
Subject: Your International Cup Betting Results

Dear [Name],

Your betting results for the International Cup are ready!

BETSLIP ID: [betslipId]

═══════════════════════════════════════
YOUR BETS
═══════════════════════════════════════

Match 1 - Day 1
USA: Player A & Player B vs International: Player C & Player D
You bet on: USA ($20)
Result: ✅ WON

Match 2 - Day 1
...
Result: ❌ LOST

Match 3 - Day 2
...
Result: 🤝 TIE (Money Returned)

═══════════════════════════════════════
PAYOUT CALCULATION
═══════════════════════════════════════

Total Amount Wagered:        $100
Winning Bets:                $40
Lost Bets:                   $50
Tied Bets (Returned):        $10

Total Betting Pool:          $5,000
Pool After Ties:             $4,500
Total Winning Bets:          $2,000
Payout Multiplier:           2.25x

YOUR PAYOUT CALCULATION:
($40 × 2.25) + $10 = $100

═══════════════════════════════════════
FINAL PAYOUT: $100
═══════════════════════════════════════

Payment Status: [Pending/Paid Out]

Thank you for participating in the International Cup betting!
```

### 3. Infrastructure Updates

Add to `pairings-infrastructure.yaml`:

```yaml
SendBetslipResultsFunction:
  Type: AWS::Serverless::Function
  Properties:
    CodeUri: lambda/sendBetslipResults/
    Handler: index.handler
    Runtime: nodejs18.x
    Role: !GetAtt PairingsLambdaRole.Arn
    Timeout: 30
    Environment:
      Variables:
        BETSLIPS_TABLE: !Sub 'icup-betslips-${Environment}'
        MATCH_RESULTS_TABLE: !Sub 'icup-match-results-${Environment}'
        ADMIN_PASSWORD: !Ref AdminPassword
        FROM_EMAIL: !Ref FromEmail
    Events:
      SendResults:
        Type: Api
        Properties:
          RestApiId: !Ref PairingsApi
          Path: /betslips/send-results
          Method: POST
```

### 4. Frontend - Admin UI Updates

**Update `betting/admin.html` - Payouts Tab:**

Add columns:
- Email Status column showing if results email sent
- Send Email button (individual)
- Bulk Send button (top of table)

```html
<!-- In Payouts table header -->
<th>Email Sent</th>

<!-- In Payouts table row -->
<td>
  <span class="${payout.resultsEmailSent ? 'email-sent' : 'email-pending'}">
    ${payout.resultsEmailSent ? '✅ Sent' : '⏳ Pending'}
  </span>
</td>

<!-- Additional action button -->
<button class="email-btn ${payout.resultsEmailSent ? 'resend' : ''}" 
        onclick="bettingAdmin.sendResultsEmail('${payout.betslipId}')">
  ${payout.resultsEmailSent ? 'Resend' : 'Send Email'}
</button>

<!-- Bulk send button at top -->
<div class="bulk-actions">
  <button class="btn-bulk-email" onclick="bettingAdmin.bulkSendResultsEmails()">
    📧 Send All Pending Emails
  </button>
  <button class="btn-bulk-email-all" onclick="bettingAdmin.bulkSendResultsEmails(true)">
    📧 Resend All Emails
  </button>
</div>
```

**CSS Additions:**
```css
.email-sent {
  color: #48bb78;
  font-weight: 600;
}

.email-pending {
  color: #e53e3e;
  font-weight: 600;
}

.email-btn {
  background: #667eea;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  margin-left: 0.5rem;
}

.email-btn.resend {
  background: #f59e0b;
}

.bulk-actions {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
  padding: 1rem;
  background: #f7fafc;
  border-radius: 8px;
}

.btn-bulk-email, .btn-bulk-email-all {
  padding: 0.75rem 1.5rem;
  background: #48bb78;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  font-size: 1rem;
}

.btn-bulk-email-all {
  background: #f59e0b;
}
```

### 5. Frontend JavaScript

**Update `js/betting-admin.js`:**

Add methods:
```javascript
async sendResultsEmail(betslipId, resend = false) {
  if (!confirm(`Send results email for betslip ${betslipId}?`)) {
    return;
  }
  
  try {
    const password = document.getElementById('admin-password').value;
    const response = await fetch(`${this.apiConfig.restApi}/betslips/send-results`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${password}`
      },
      body: JSON.stringify({ 
        betslipIds: [betslipId],
        resend: resend
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    alert(`Email sent successfully to ${data.sent} bettor(s)!`);
    
    // Reload payouts to show updated status
    await this.loadPayouts();
    
  } catch (error) {
    console.error('Error sending results email:', error);
    alert('Failed to send email. Please try again.');
  }
}

async bulkSendResultsEmails(resendAll = false) {
  const betslipsToSend = resendAll 
    ? this.payouts.map(p => p.betslipId)
    : this.payouts.filter(p => !p.resultsEmailSent).map(p => p.betslipId);
  
  if (betslipsToSend.length === 0) {
    alert('No emails to send!');
    return;
  }
  
  const action = resendAll ? 'resend' : 'send';
  if (!confirm(`${action} results emails to ${betslipsToSend.length} bettor(s)?`)) {
    return;
  }
  
  try {
    const password = document.getElementById('admin-password').value;
    const response = await fetch(`${this.apiConfig.restApi}/betslips/send-results`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${password}`
      },
      body: JSON.stringify({ 
        betslipIds: betslipsToSend,
        resend: resendAll
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    alert(`Successfully sent emails to ${data.sent} bettor(s)!\nFailed: ${data.failed}`);
    
    // Reload payouts to show updated status
    await this.loadPayouts();
    
  } catch (error) {
    console.error('Error sending bulk emails:', error);
    alert('Failed to send emails. Please try again.');
  }
}
```

Update `renderPayouts()` to include email status and buttons.

### 6. Update Other Lambda Functions

**Update `lambda/calculatePayouts/index.js`:**
Add `resultsEmailSent` field to returned payout data:
```javascript
return {
  betslipId: betslip.betslipId,
  name: betslip.name,
  email: betslip.email,
  // ... other fields
  resultsEmailSent: betslip.resultsEmailSent || false,
  resultsEmailSentAt: betslip.resultsEmailSentAt || null
};
```

**Update `lambda/getBetslips/index.js`:**
Include email fields in returned data.

### 7. Email Template Details

The Lambda will need to:
1. Fetch betslip with all bets
2. Fetch match results for all matches
3. Fetch players for player names
4. Calculate outcomes for each bet
5. Calculate summary statistics
6. Format HTML email with proper styling
7. Send via SES
8. Update betslip record

### 8. Deployment Steps

1. Update Lambda functions:
   - Create `sendBetslipResults`
   - Update `calculatePayouts`
   - Update `getBetslips`

2. Update infrastructure:
   - Add new Lambda definition
   - Ensure SES permissions exist

3. Deploy backend:
   ```bash
   ./deploy-pairings-backend.sh staging
   ./deploy-pairings-backend.sh prod
   ```

4. Update frontend:
   - Update `betting/admin.html`
   - Update `js/betting-admin.js`

5. Deploy frontend:
   ```bash
   aws s3 cp betting/admin.html s3://[bucket]/betting/admin.html
   aws s3 cp js/betting-admin.js s3://[bucket]/js/betting-admin.js
   aws cloudfront create-invalidation --distribution-id [id] --paths "/*"
   ```

## Features Summary

✅ Individual bet results display
✅ Payout calculation breakdown
✅ Professional HTML email template
✅ Track email send status
✅ Individual send capability
✅ Bulk send pending emails
✅ Resend all emails option
✅ Admin authentication required
✅ Error handling and reporting

## Testing Checklist

- [ ] Send single results email
- [ ] Verify email content is correct
- [ ] Test bulk send pending
- [ ] Test resend all
- [ ] Verify email status updates
- [ ] Test with different bet outcomes (won/lost/tied)
- [ ] Verify payout calculations in email
- [ ] Test error handling





