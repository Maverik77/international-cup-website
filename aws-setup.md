# AWS Setup Guide for International Cup Website

This guide will help you set up AWS infrastructure to host your responsive website using S3 for storage and CloudFront for global content delivery.

## Prerequisites

- AWS Account with appropriate permissions
- AWS CLI installed and configured
- GitHub repository with your website code

## Step 1: Create S3 Bucket

### Using AWS Console:

1. **Create S3 Bucket**
   - Go to AWS S3 Console
   - Click "Create bucket"
   - Choose a unique bucket name (e.g., `international-cup-website-2024`)
   - Select your preferred region
   - Uncheck "Block all public access" (we'll configure specific permissions)
   - Click "Create bucket"

2. **Configure Bucket for Static Website Hosting**
   ```bash
   # Using AWS CLI
   aws s3 website s3://your-bucket-name --index-document index.html --error-document index.html
   ```

3. **Set Bucket Policy**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "PublicReadGetObject",
         "Effect": "Allow",
         "Principal": "*",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::your-bucket-name/*"
       }
     ]
   }
   ```

### Using AWS CLI:

```bash
# Create bucket
aws s3 mb s3://your-bucket-name

# Enable static website hosting
aws s3 website s3://your-bucket-name --index-document index.html --error-document index.html

# Set bucket policy (save the JSON above to bucket-policy.json)
aws s3api put-bucket-policy --bucket your-bucket-name --policy file://bucket-policy.json
```

## Step 2: Create CloudFront Distribution

### Using AWS Console:

1. **Create Distribution**
   - Go to CloudFront Console
   - Click "Create Distribution"
   - Choose "Web" distribution

2. **Origin Settings**
   - Origin Domain Name: Select your S3 bucket
   - Origin Path: Leave empty
   - Origin ID: Auto-generated (or customize)

3. **Default Cache Behavior Settings**
   - Viewer Protocol Policy: Redirect HTTP to HTTPS
   - Allowed HTTP Methods: GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE
   - Cache Based on Selected Request Headers: None
   - Forward Cookies: None
   - Query String Forwarding: None
   - Smooth Streaming: No
   - Compress Objects Automatically: Yes

4. **Distribution Settings**
   - Price Class: Use Only U.S., Canada and Europe (or your preference)
   - Alternate Domain Names (CNAMEs): Add your custom domain if you have one
   - SSL Certificate: Default CloudFront Certificate (or upload custom)
   - Default Root Object: index.html
   - Logging: Off (or configure if needed)
   - Distribution State: Enabled

5. **Click "Create Distribution"**

### Using AWS CLI:

```bash
# Create distribution (save this JSON to cloudfront-config.json)
aws cloudfront create-distribution --distribution-config file://cloudfront-config.json
```

CloudFront configuration JSON:
```json
{
  "CallerReference": "international-cup-website-$(date +%s)",
  "Comment": "International Cup Website Distribution",
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "S3-your-bucket-name",
        "DomainName": "your-bucket-name.s3.amazonaws.com",
        "S3OriginConfig": {
          "OriginAccessIdentity": ""
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-your-bucket-name",
    "ViewerProtocolPolicy": "redirect-to-https",
    "MinTTL": 0,
    "ForwardedValues": {
      "QueryString": false,
      "Cookies": {
        "Forward": "none"
      }
    },
    "TrustedSigners": {
      "Enabled": false,
      "Quantity": 0
    }
  },
  "Enabled": true,
  "PriceClass": "PriceClass_100"
}
```

## Step 3: Configure GitHub Secrets

Add the following secrets to your GitHub repository:

1. Go to your GitHub repository
2. Navigate to Settings → Secrets and variables → Actions
3. Add the following repository secrets:

- `AWS_ACCESS_KEY_ID`: Your AWS access key
- `AWS_SECRET_ACCESS_KEY`: Your AWS secret access key
- `AWS_REGION`: Your AWS region (e.g., `us-east-1`)
- `S3_BUCKET_NAME`: Your S3 bucket name
- `CLOUDFRONT_DISTRIBUTION_ID`: Your CloudFront distribution ID

### Creating AWS IAM User for GitHub Actions:

```bash
# Create IAM user
aws iam create-user --user-name github-actions-deploy

# Create and attach policy
aws iam put-user-policy --user-name github-actions-deploy --policy-name S3CloudFrontDeployPolicy --policy-document file://deploy-policy.json

# Create access keys
aws iam create-access-key --user-name github-actions-deploy
```

Deploy policy JSON (save as `deploy-policy.json`):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:PutObjectAcl"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket-name",
        "arn:aws:s3:::your-bucket-name/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateInvalidation",
        "cloudfront:GetInvalidation",
        "cloudfront:ListInvalidations"
      ],
      "Resource": "*"
    }
  ]
}
```

## Step 4: Custom Domain (Optional)

If you want to use a custom domain:

1. **Purchase Domain** (Route 53 or external registrar)

2. **Create SSL Certificate**
   ```bash
   # Request certificate in us-east-1 (required for CloudFront)
   aws acm request-certificate --domain-name yourdomain.com --domain-name www.yourdomain.com --validation-method DNS --region us-east-1
   ```

3. **Update CloudFront Distribution**
   - Add your domain to Alternate Domain Names (CNAMEs)
   - Select your SSL certificate

4. **Configure DNS**
   - Create CNAME record pointing to CloudFront distribution domain

## Step 5: Performance Optimization

### Enable Gzip Compression:
```json
{
  "Compress": true
}
```

### Cache Headers for Different File Types:
```bash
# CSS and JS files (1 year cache)
aws s3 cp build/ s3://your-bucket-name/ --recursive --exclude "*" --include "*.css" --cache-control "max-age=31536000"
aws s3 cp build/ s3://your-bucket-name/ --recursive --exclude "*" --include "*.js" --cache-control "max-age=31536000"

# HTML files (1 hour cache)
aws s3 cp build/ s3://your-bucket-name/ --recursive --exclude "*" --include "*.html" --cache-control "max-age=3600"
```

## Step 6: Security Enhancements

### Content Security Policy Header:
Add to your HTML or configure in CloudFront:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;">
```

### HTTPS Redirect:
Ensure CloudFront is configured to redirect HTTP to HTTPS.

## Step 7: Monitoring and Logging

### CloudWatch Monitoring:
- Enable CloudFront logging
- Set up CloudWatch alarms for error rates
- Monitor S3 bucket metrics

### Cost Optimization:
- Use appropriate CloudFront price class
- Set up S3 lifecycle policies for old files
- Monitor AWS costs regularly

## Deployment Process

Once everything is set up:

1. Push code to your main branch
2. GitHub Actions will automatically:
   - Build the project
   - Deploy to S3
   - Invalidate CloudFront cache
   - Notify of deployment status

## Troubleshooting

### Common Issues:

1. **403 Forbidden Error**
   - Check S3 bucket policy
   - Verify CloudFront origin settings

2. **Slow Updates**
   - CloudFront cache invalidation may take 10-15 minutes
   - Check cache headers

3. **GitHub Actions Failures**
   - Verify AWS credentials and permissions
   - Check secret names match exactly

4. **SSL Certificate Issues**
   - Ensure certificate is in us-east-1 region
   - Verify domain validation

## Estimated Costs

For a typical small website:
- S3 Storage: $0.01-$0.05/month
- CloudFront: $0.01-$1.00/month
- Data Transfer: Varies by traffic
- Total: Usually under $2/month for small sites

## Next Steps

1. Set up monitoring and alerts
2. Configure custom domain and SSL
3. Implement analytics (Google Analytics, AWS CloudWatch)
4. Set up backup and disaster recovery
5. Consider implementing a CDN for images

## Support

For issues with this setup:
1. Check AWS documentation
2. Review GitHub Actions logs
3. Verify all configurations match this guide
4. Test with a simple HTML file first 