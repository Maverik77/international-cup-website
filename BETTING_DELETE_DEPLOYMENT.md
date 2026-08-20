# Betting Delete Functionality - Deployment Guide

## Overview

This document explains how to deploy the new "Delete Bet" functionality to both staging and production environments.

## What's Been Added

1. **Lambda Function**: `deleteBetslip` - Deletes a betslip from DynamoDB
   - Location: `lambda/deleteBetslip/index.js`
   - Requires admin authentication
   - Permanently deletes a betslip by ID

2. **Frontend Changes**:
   - Added delete button to betting admin page (`betting/admin.html`)
   - Added `deleteBetslip()` method to `js/betting-admin.js`
   - Includes confirmation dialog to prevent accidental deletions
   - Shows success/error messages

3. **Infrastructure Changes**:
   - Added `DeleteBetslipFunction` to `pairings-infrastructure.yaml`
   - Updated CORS to allow DELETE method
   - API endpoint: `DELETE /betslips/{betslipId}`

## Deployment Instructions

### Deploy to Staging

1. **Deploy the Backend (Lambda + API Gateway)**:
   ```bash
   ./deploy-pairings-backend.sh staging
   ```
   
   Or if you need to specify a custom admin password:
   ```bash
   ./deploy-pairings-backend.sh staging your-admin-password
   ```

2. **Deploy the Frontend**:
   ```bash
   # Upload the updated HTML and JS files to the staging S3 bucket
   aws s3 cp betting/admin.html s3://international-cup-website-staging-1757115851/betting/admin.html --profile icup_website_user
   aws s3 cp js/betting-admin.js s3://international-cup-website-staging-1757115851/js/betting-admin.js --profile icup_website_user
   ```

3. **Invalidate CloudFront Cache** (if using CloudFront):
   ```bash
   # Get the CloudFront distribution ID for staging
   aws cloudfront create-invalidation --distribution-id YOUR_STAGING_DIST_ID --paths "/betting/admin.html" "/js/betting-admin.js" --profile icup_website_user
   ```

### Deploy to Production

1. **Test thoroughly on staging first!**

2. **Deploy the Backend**:
   ```bash
   # Deploy to production
   ./deploy-pairings-backend.sh prod
   
   # Or with custom admin password:
   ./deploy-pairings-backend.sh prod your-admin-password
   ```

3. **Deploy the Frontend**:
   ```bash
   # Upload to production S3 bucket
   aws s3 cp betting/admin.html s3://international-cup-website-1757115851/betting/admin.html --profile icup_website_user
   aws s3 cp js/betting-admin.js s3://international-cup-website-1757115851/js/betting-admin.js --profile icup_website_user
   ```

4. **Invalidate CloudFront Cache**:
   ```bash
   aws cloudfront create-invalidation --distribution-id YOUR_PROD_DIST_ID --paths "/betting/admin.html" "/js/betting-admin.js" --profile icup_website_user
   ```

## Usage

1. Navigate to the betting admin page: `https://[your-domain]/betting/admin.html`
2. Enter the admin password to authenticate
3. Find the bet slip you want to delete
4. Click the red "Delete" button next to "View Details"
5. Confirm the deletion in the dialog box
6. The bet slip will be permanently deleted and the list will refresh

## Important Notes

⚠️ **WARNINGS**:
- Deletion is permanent and cannot be undone
- The delete button requires admin authentication
- A confirmation dialog prevents accidental deletions
- After deletion, the betslip is completely removed from DynamoDB

## API Endpoint Details

- **Method**: DELETE
- **Path**: `/betslips/{betslipId}`
- **Headers**: 
  - `Authorization: Bearer {admin-password}`
- **Response**: 
  ```json
  {
    "success": true,
    "message": "Betslip deleted successfully",
    "betslipId": "abc123..."
  }
  ```

## Rollback Plan

If you need to rollback:

1. Revert the infrastructure changes:
   ```bash
   git checkout HEAD~1 pairings-infrastructure.yaml
   sam build --template pairings-infrastructure.yaml --profile icup_website_user
   sam deploy ...
   ```

2. Revert frontend changes:
   ```bash
   git checkout HEAD~1 betting/admin.html js/betting-admin.js
   # Re-upload to S3
   ```

## Testing Checklist

Before deploying to production, verify on staging:

- [ ] Admin login works
- [ ] Delete button appears next to each betslip
- [ ] Confirmation dialog appears when clicking delete
- [ ] Canceling confirmation does not delete
- [ ] Confirming deletion removes the betslip
- [ ] Success message appears after deletion
- [ ] Betslip list refreshes after deletion
- [ ] Cannot access delete endpoint without authentication
- [ ] Deleted betslip is gone from DynamoDB

## Support

If you encounter issues during deployment:
1. Check CloudWatch Logs for the Lambda function
2. Verify the API Gateway endpoint is configured correctly
3. Ensure CORS is allowing DELETE method
4. Confirm admin password is set correctly in environment variables

