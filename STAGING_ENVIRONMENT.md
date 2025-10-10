# Staging Environment Documentation

## Overview

The International Cup website has two deployment environments:
- **Production**: `https://www.lansdowne-international-cup.com`
- **Staging**: `https://staging.lansdowne-international-cup.com`

## Environment Details

### Production Environment
- **Domain**: www.lansdowne-international-cup.com
- **S3 Bucket**: international-cup-website-1757115851
- **CloudFront Distribution**: E1SY6AVH5CLGVS
- **Branch**: `main`
- **Purpose**: Live public-facing website

### Staging Environment
- **Domain**: staging.lansdowne-international-cup.com
- **S3 Bucket**: international-cup-website-staging-1757115851
- **CloudFront Distribution**: E11VT1B5QAZ80O
- **Branch**: `staging`
- **Purpose**: Testing and preview before production deployment

## Deployment Workflow

### Automatic Deployments

**Staging Deployment:**
1. Push or merge changes to the `staging` branch
2. GitHub Actions automatically:
   - Runs tests and validation
   - Builds the site
   - Deploys to staging S3 bucket
   - Invalidates CloudFront cache
   - Makes changes live at staging URL

**Production Deployment:**
1. Push or merge changes to the `main` branch
2. GitHub Actions automatically:
   - Runs tests and validation
   - Builds the site
   - Deploys to production S3 bucket
   - Invalidates CloudFront cache
   - Makes changes live at production URL

### Workflow Branches

```
feature/new-feature → staging (test) → main (production)
```

## How to Use Staging

### 1. Test New Features
```bash
# Create a feature branch
git checkout -b feature/new-feature

# Make your changes
# ... edit files ...

# Commit changes
git add .
git commit -m "feat: add new feature"

# Push to staging for testing
git checkout staging
git merge feature/new-feature
git push origin staging

# View at: https://staging.lansdowne-international-cup.com
```

### 2. Promote Staging to Production
Once staging has been tested and approved:
```bash
# Merge staging into main
git checkout main
git merge staging
git push origin main

# Production will auto-deploy
# View at: https://www.lansdowne-international-cup.com
```

### 3. Direct Staging Updates
For quick staging-only updates:
```bash
git checkout staging
# ... make changes ...
git add .
git commit -m "test: experimental feature"
git push origin staging
```

## Key Differences Between Environments

| Feature | Production | Staging |
|---------|-----------|---------|
| Domain | www.lansdowne-international-cup.com | staging.lansdowne-international-cup.com |
| SSL Certificate | ✅ ACM Certificate | ✅ ACM Certificate |
| Search Indexing | Allowed (robots.txt) | Blocked (robots.txt) |
| Cache Duration | Standard (3600s HTML) | Standard (3600s HTML) |
| AWS Resources | Separate S3 + CloudFront | Separate S3 + CloudFront |
| Authentication | Same (shared) | Same (shared) |

## GitHub Secrets Required

### Shared Secrets (Both Environments)
- `AWS_ACCESS_KEY_ID` - AWS credentials
- `AWS_SECRET_ACCESS_KEY` - AWS credentials
- `AWS_REGION` - AWS region (e.g., us-east-1)

### Production-Specific Secrets
- `S3_BUCKET_NAME` - international-cup-website-1757115851
- `CLOUDFRONT_DISTRIBUTION_ID` - E1SY6AVH5CLGVS

### Staging-Specific Secrets
- `S3_BUCKET_NAME_STAGING` - international-cup-website-staging-1757115851
- `CLOUDFRONT_DISTRIBUTION_ID_STAGING` - E11VT1B5QAZ80O

## Manual Operations

### Manual Cache Invalidation

**Staging:**
```bash
aws cloudfront create-invalidation \
  --distribution-id E11VT1B5QAZ80O \
  --paths "/*" \
  --profile icup_website_user
```

**Production:**
```bash
aws cloudfront create-invalidation \
  --distribution-id E1SY6AVH5CLGVS \
  --paths "/*" \
  --profile icup_website_user
```

### Manual File Upload

**Staging:**
```bash
aws s3 sync build/ s3://international-cup-website-staging-1757115851 \
  --delete \
  --profile icup_website_user
```

**Production:**
```bash
aws s3 sync build/ s3://international-cup-website-1757115851 \
  --delete \
  --profile icup_website_user
```

## Testing Checklist

Before promoting staging to production, verify:

- [ ] All pages load correctly
- [ ] Navigation works as expected
- [ ] Forms submit successfully (if applicable)
- [ ] Images and assets load properly
- [ ] Mobile responsive design works
- [ ] SSL certificate is valid (https://)
- [ ] No console errors in browser
- [ ] News/dynamic content displays correctly
- [ ] Member authentication works (if testing auth features)
- [ ] Tournament results display properly

## Troubleshooting

### Staging Changes Not Appearing
1. Check GitHub Actions workflow succeeded
2. Verify CloudFront invalidation completed
3. Clear browser cache (Cmd+Shift+R / Ctrl+Shift+R)
4. Check DNS propagation: `dig staging.lansdowne-international-cup.com`

### SSL Certificate Errors
- Ensure certificate is validated in ACM (us-east-1 region)
- Verify CloudFront distribution has correct certificate attached
- Check DNS records point to CloudFront distribution

### Deployment Failures
1. Check GitHub Actions logs for errors
2. Verify AWS credentials haven't expired
3. Ensure S3 bucket permissions are correct
4. Confirm CloudFront distribution ID in secrets

### DNS Issues
```bash
# Check DNS resolution
dig staging.lansdowne-international-cup.com

# Should return CloudFront domain: d19pjlph5b6mla.cloudfront.net
```

## Cost Considerations

Both environments use AWS resources:
- **S3 Storage**: ~$0.01-0.05/month per environment
- **CloudFront**: ~$0.01-1.00/month per environment
- **Route 53**: ~$0.50/month (shared hosted zone)
- **Data Transfer**: Varies by traffic

**Estimated Total**: $2-5/month for both environments

## Best Practices

1. **Always test in staging first** - Never push untested code directly to production
2. **Keep staging in sync** - Regularly merge main back to staging to avoid drift
3. **Use feature branches** - Develop in feature branches, test in staging, promote to production
4. **Monitor deployments** - Check GitHub Actions logs for each deployment
5. **Clear cache when needed** - Use manual invalidation for immediate updates
6. **Document breaking changes** - Note any changes that might affect users

## Support & Maintenance

### AWS Infrastructure Updates
All AWS resources managed via AWS CLI with profile: `icup_website_user`

### Certificate Renewal
ACM certificates auto-renew as long as DNS validation records remain in Route 53.

### Monitoring
- CloudWatch metrics available for both CloudFront distributions
- S3 bucket metrics available in AWS Console
- GitHub Actions provides deployment logs and history

## Emergency Procedures

### Rollback Production
```bash
# Find last good commit
git log --oneline

# Revert to specific commit
git checkout main
git revert <commit-hash>
git push origin main

# Or reset to previous commit (use with caution)
git reset --hard <commit-hash>
git push origin main --force
```

### Disable Staging (if needed)
```bash
# Disable CloudFront distribution
aws cloudfront update-distribution \
  --id E11VT1B5QAZ80O \
  --enabled false \
  --profile icup_website_user
```

## Additional Resources

- [AWS Setup Guide](./aws-setup.md)
- [Custom Domain Setup](./custom-domain-setup.md)
- [Deployment Summary](./DEPLOYMENT_SUMMARY.md)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [CloudFront Documentation](https://docs.aws.amazon.com/cloudfront/)

