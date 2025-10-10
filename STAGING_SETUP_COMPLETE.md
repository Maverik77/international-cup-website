# Staging Environment Setup - COMPLETE ✅

## Summary

Your staging environment has been successfully set up! Here's what was accomplished:

### AWS Infrastructure Created

1. **S3 Bucket**: `international-cup-website-staging-1757115851`
   - Static website hosting enabled
   - Public read access configured
   - Ready to receive deployments

2. **CloudFront Distribution**: `E11VT1B5QAZ80O`
   - Domain: `d19pjlph5b6mla.cloudfront.net`
   - SSL certificate attached
   - Custom domain configured
   - Status: Deploying (will be ready in 5-20 minutes)

3. **SSL Certificate**: `arn:aws:acm:us-east-1:792782029232:certificate/18391cbc-1e6c-4ead-838b-6bbfd77ded29`
   - Domain: `staging.lansdowne-international-cup.com`
   - Status: ✅ ISSUED
   - Auto-renewal enabled

4. **DNS Records**: Created in Route 53
   - A record: `staging.lansdowne-international-cup.com` → CloudFront
   - AAAA record: IPv6 support
   - CNAME record: Certificate validation

### GitHub Configuration

1. **Branches**:
   - `staging` branch created and pushed
   - `main` branch updated with new workflow
   - Both branches in sync

2. **GitHub Actions Workflow**:
   - Split into `deploy-production` and `deploy-staging` jobs
   - Automatic deployments based on branch
   - Full cache invalidation (`/*`) for both environments

3. **Documentation**:
   - `STAGING_ENVIRONMENT.md` created with comprehensive guide
   - Usage instructions, troubleshooting, and best practices

## ⚠️ REQUIRED: Add GitHub Secrets

To complete the setup, you need to add these secrets to your GitHub repository:

### Go to: https://github.com/Maverik77/international-cup-website/settings/secrets/actions

Add these **NEW** secrets:

1. **S3_BUCKET_NAME_STAGING**
   ```
   international-cup-website-staging-1757115851
   ```

2. **CLOUDFRONT_DISTRIBUTION_ID_STAGING**
   ```
   E11VT1B5QAZ80O
   ```

### Existing Secrets (verify these are set):
- ✅ `AWS_ACCESS_KEY_ID` (already configured)
- ✅ `AWS_SECRET_ACCESS_KEY` (already configured)
- ✅ `AWS_REGION` (already configured)
- ✅ `S3_BUCKET_NAME` (production bucket)
- ✅ `CLOUDFRONT_DISTRIBUTION_ID` (production distribution)

## Testing Your Setup

### 1. Wait for CloudFront Deployment
The CloudFront distribution is currently deploying. Check status:
```bash
aws cloudfront get-distribution --id E11VT1B5QAZ80O --profile icup_website_user --query 'Distribution.Status'
```

When it returns `Deployed`, you're ready to test!

### 2. Test Staging Deployment
Once GitHub secrets are added:
```bash
# Make a small change
echo "<!-- Staging test -->" >> index.html

# Push to staging
git checkout staging
git add index.html
git commit -m "test: staging deployment"
git push origin staging
```

Watch GitHub Actions: https://github.com/Maverik77/international-cup-website/actions

### 3. Access Your Sites

**Staging:** https://staging.lansdowne-international-cup.com
**Production:** https://www.lansdowne-international-cup.com

## Deployment Workflow

```
┌─────────────────┐
│  Feature Work   │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Push to staging │ → https://staging.lansdowne-international-cup.com
└────────┬────────┘
         │ (test & verify)
         v
┌─────────────────┐
│  Merge to main  │ → https://www.lansdowne-international-cup.com
└─────────────────┘
```

## What Happens on Each Push

### Push to `staging` branch:
1. ✅ Runs tests
2. ✅ Builds site
3. ✅ Deploys to staging S3 bucket
4. ✅ Invalidates staging CloudFront cache
5. ✅ Live at staging.lansdowne-international-cup.com

### Push to `main` branch:
1. ✅ Runs tests
2. ✅ Builds site
3. ✅ Deploys to production S3 bucket
4. ✅ Invalidates production CloudFront cache
5. ✅ Live at www.lansdowne-international-cup.com

## Key Differences

| Feature | Production | Staging |
|---------|-----------|---------|
| URL | www.lansdowne-international-cup.com | staging.lansdowne-international-cup.com |
| Branch | `main` | `staging` |
| Search Indexing | ✅ Allowed | ❌ Blocked |
| Purpose | Public site | Testing & preview |

## Cost Impact

Adding staging environment adds:
- S3 Storage: ~$0.01-0.05/month
- CloudFront: ~$0.01-1.00/month
- Total increase: ~$1-2/month

## Next Steps

1. **Add GitHub Secrets** (see above)
2. **Wait for CloudFront** to finish deploying (~5-20 min)
3. **Test staging deployment** with a small change
4. **Verify staging URL** loads correctly
5. **Use staging for all testing** before production

## Resources

- **Staging Guide**: `STAGING_ENVIRONMENT.md`
- **AWS Setup**: `aws-setup.md`
- **Domain Setup**: `custom-domain-setup.md`
- **GitHub Actions**: `.github/workflows/deploy.yml`

## Troubleshooting

If staging deployment fails after adding secrets:
```bash
# Check CloudFront status
aws cloudfront get-distribution --id E11VT1B5QAZ80O --profile icup_website_user

# Manual deployment test
aws s3 ls s3://international-cup-website-staging-1757115851 --profile icup_website_user

# Check DNS
dig staging.lansdowne-international-cup.com
```

## Support

For issues, check:
1. GitHub Actions logs
2. CloudFront distribution status (must be "Deployed")
3. DNS propagation (can take 5-10 minutes)
4. Browser cache (hard refresh: Cmd+Shift+R)

---

**Status**: ✅ Infrastructure Complete | ⏳ Waiting for GitHub Secrets

Once secrets are added, your dual-environment setup will be fully operational!

