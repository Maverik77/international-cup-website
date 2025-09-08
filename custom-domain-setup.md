# Custom Domain Setup Guide
## 🌐 lansdowne-international-cup.com

### ✅ **Step 1: Domain Registration** (COMPLETED)
- Domain: `lansdowne-international-cup.com`
- Registrar: AWS Route 53
- Status: ✅ Registered

### 🔐 **Step 2: SSL Certificate Setup**

#### A. Certificate Request (Completed)
```bash
aws --profile icup_website_user acm request-certificate \
  --domain-name lansdowne-international-cup.com \
  --subject-alternative-names www.lansdowne-international-cup.com \
  --validation-method DNS \
  --region us-east-1
```

#### B. Get Certificate ARN
```bash
aws --profile icup_website_user acm list-certificates --region us-east-1
```

#### C. Get DNS Validation Records
```bash
# Replace CERTIFICATE_ARN with actual ARN from step B
aws --profile icup_website_user acm describe-certificate \
  --certificate-arn CERTIFICATE_ARN \
  --region us-east-1
```

### 🌍 **Step 3: DNS Configuration**

#### A. Find Hosted Zone ID
```bash
aws --profile icup_website_user route53 list-hosted-zones
```

#### B. Add DNS Validation Records
You'll need to add the CNAME records from the certificate validation to your Route 53 hosted zone.

#### C. Create Alias Records (After CloudFront Update)
```bash
# A record for root domain
# AAAA record for IPv6
# CNAME for www subdomain
```

### ☁️ **Step 4: CloudFront Distribution Update**

#### A. Get Current Distribution Config
```bash
aws --profile icup_website_user cloudfront get-distribution-config \
  --id E1SY6AVH5CLGVS
```

#### B. Update Distribution with Custom Domain
- Add custom domain names
- Add SSL certificate ARN
- Update viewer protocol policy to redirect HTTP to HTTPS

### 🧪 **Step 5: Testing**
- Test certificate validation
- Test domain resolution
- Test HTTPS redirect
- Test both www and non-www versions

---

## 🚀 **Quick Setup via AWS Console** (Alternative)

### Route 53 Console Steps:
1. **Certificate Manager**: https://console.aws.amazon.com/acm/
   - Validate certificate via DNS
   
2. **CloudFront Console**: https://console.aws.amazon.com/cloudfront/
   - Edit distribution E1SY6AVH5CLGVS
   - Add alternate domain names
   - Select custom SSL certificate
   
3. **Route 53 Console**: https://console.aws.amazon.com/route53/
   - Create A/AAAA records pointing to CloudFront

---

## 📋 **Current Status**
- [x] Domain registered
- [x] SSL certificate requested
- [x] Certificate validated
- [x] CloudFront updated
- [x] DNS configured
- [x] Testing completed

## 🛠️ **Operational Notes**
- **ACM renewal**: ACM auto‑renews if the DNS validation CNAMEs remain in Route 53. Verify status: `aws --profile icup_website_user acm describe-certificate --region us-east-1 --certificate-arn <CERT_ARN> --query 'Certificate.RenewalSummary'`.
- **Add/remove domains**: CloudFront requires the cert to include every alias. To add a domain, request/modify an ACM cert in `us-east-1` that includes the new SAN, validate via DNS, then update CloudFront `Aliases` and `ViewerCertificate`.
- **CloudFront updates**: Changes take ~5–20 minutes to deploy. Check: `aws --profile icup_website_user cloudfront get-distribution --id E1SY6AVH5CLGVS --query 'Distribution.Status'` until `Deployed`.
- **DNS aliases**: Apex uses Route 53 ALIAS A/AAAA to CloudFront. CloudFront hosted zone ID: `Z2FDTNDATAQYW2`. TTL is irrelevant for ALIAS but we keep 300s for CNAMEs.
- **Cache invalidation**: To flush cached content after deploys: `aws --profile icup_website_user cloudfront create-invalidation --distribution-id E1SY6AVH5CLGVS --paths '/*'`.
- **Redirects**: HTTP→HTTPS already enabled. `www` currently CNAMEs to apex; change behavior by adjusting Route 53 as desired.
- **HSTS (optional)**: Add Strict‑Transport‑Security via a CloudFront Response Headers Policy or a Function. Example header: `max-age=31536000; includeSubDomains; preload`.
- **Troubleshooting**:
  - **SSL mismatch**: If 525/SSL errors, ensure both domains are on the ACM cert and attached to CloudFront.
  - **404/403**: Confirm S3 website endpoint is origin and content exists; invalidations may be needed.
  - **DNS not resolving**: Verify Route 53 records and that nameservers on the domain match the hosted zone.
- **Region gotcha**: CloudFront custom certs must be in `us-east-1` (N. Virginia), even if your app is elsewhere.

## 🔗 **Final Result**
Your website will be accessible at:
- https://lansdowne-international-cup.com
- https://www.lansdowne-international-cup.com
- Automatic HTTP → HTTPS redirect 
