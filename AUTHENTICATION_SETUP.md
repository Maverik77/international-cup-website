# 🔐 Authentication Setup Guide
## International Cup Member Area

### ✅ **What's Been Set Up**

#### 1. **AWS Cognito User Pool**
- **User Pool ID**: `us-east-1_T5zttESw4`
- **Client ID**: `q27ncptlccjrjkjrap017scp0`
- **Client Secret**: `1cg3kjftid2ccr89asfjvrf2ojjljfiq1nojmbanu4utvr654hcg`
- **Domain**: `international-cup-auth.auth.us-east-1.amazoncognito.com`

#### 2. **Authentication Features**
- ✅ Email/Password sign up and sign in
- ✅ Email verification
- ✅ Password reset
- ✅ Social login preparation (Google, Facebook, Apple)
- ✅ Member dashboard with tournament registration
- ✅ Protected member-only content

#### 3. **File Structure**
```
international_cup_website/
├── members/
│   └── index.html          # Protected member area
├── auth/
│   └── callback.html       # OAuth callback handler
├── css/
│   └── auth.css           # Authentication styles
├── js/
│   ├── auth.js            # Authentication logic
│   └── members.js         # Member area functionality
└── index.html             # Updated with Members link
```

---

## 🚀 **Next Steps: Social Provider Setup**

### **Google OAuth Setup**
1. **Google Cloud Console**: https://console.cloud.google.com/
2. **Create OAuth 2.0 Client ID**:
   - Authorized redirect URIs: `https://international-cup-auth.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
3. **Configure in Cognito**:
   ```bash
   aws --profile icup_website_user cognito-idp create-identity-provider \
     --user-pool-id us-east-1_T5zttESw4 \
     --provider-name Google \
     --provider-type Google \
     --provider-details client_id="YOUR_GOOGLE_CLIENT_ID",client_secret="YOUR_GOOGLE_CLIENT_SECRET",authorize_scopes="email openid profile" \
     --attribute-mapping email=email,given_name=given_name,family_name=family_name,picture=picture
   ```

### **Facebook OAuth Setup**
1. **Facebook Developers**: https://developers.facebook.com/
2. **Create Facebook App** with Facebook Login
3. **Configure in Cognito**:
   ```bash
   aws --profile icup_website_user cognito-idp create-identity-provider \
     --user-pool-id us-east-1_T5zttESw4 \
     --provider-name Facebook \
     --provider-type Facebook \
     --provider-details client_id="YOUR_FACEBOOK_APP_ID",client_secret="YOUR_FACEBOOK_APP_SECRET",authorize_scopes="email public_profile" \
     --attribute-mapping email=email,given_name=first_name,family_name=last_name,picture=picture
   ```

### **Apple Sign In Setup**
1. **Apple Developer**: https://developer.apple.com/
2. **Configure Sign in with Apple**
3. **Configure in Cognito**:
   ```bash
   aws --profile icup_website_user cognito-idp create-identity-provider \
     --user-pool-id us-east-1_T5zttESw4 \
     --provider-name SignInWithApple \
     --provider-type SignInWithApple \
     --provider-details client_id="YOUR_APPLE_SERVICE_ID",team_id="YOUR_APPLE_TEAM_ID",key_id="YOUR_APPLE_KEY_ID",private_key="YOUR_APPLE_PRIVATE_KEY",authorize_scopes="email name" \
     --attribute-mapping email=email,given_name=firstName,family_name=lastName
   ```

### **Update User Pool Client**
After setting up providers, update the client:
```bash
aws --profile icup_website_user cognito-idp update-user-pool-client \
  --user-pool-id us-east-1_T5zttESw4 \
  --client-id q27ncptlccjrjkjrap017scp0 \
  --supported-identity-providers "COGNITO" "Google" "Facebook" "SignInWithApple"
```

---

## 🧪 **Testing the Authentication**

### **Local Testing**
1. **Start local server**:
   ```bash
   python3 -m http.server 8000
   ```
2. **Visit**: http://localhost:8000/members/
3. **Test flows**:
   - Email/password registration
   - Email/password sign in
   - Password reset
   - Member dashboard functionality

### **Production Testing**
1. **Deploy to S3**: The GitHub workflow will automatically deploy
2. **Visit**: https://lansdowne-international-cup.com/members/
3. **Test all authentication flows**

---

## 🔒 **Security Features**

### **Password Policy**
- Minimum 8 characters
- Requires uppercase, lowercase, and numbers
- No special characters required (for better UX)

### **Email Verification**
- Required for all new accounts
- Automatic verification emails sent

### **Session Management**
- JWT tokens with 30-day refresh
- Secure token storage
- Automatic session validation

### **Protected Routes**
- Member area requires authentication
- Graceful fallback to sign-in prompt
- Session persistence across page loads

---

## 🎯 **Member Area Features**

### **Dashboard Components**
- **Tournament Status**: Registration status and team assignment
- **Quick Actions**: Register, update profile, view pairings
- **Recent Updates**: Latest tournament announcements
- **Member Directory**: Browse and connect with other members

### **Registration Flow**
- Golf handicap collection
- Team preference (optional)
- Dietary restrictions
- Terms acceptance
- Automatic team assignment simulation

---

## 🚀 **Deployment**

### **Automatic Deployment**
- GitHub Actions workflow updated
- Includes `/members/` and `/auth/` folders
- Proper content-type headers set
- CloudFront cache invalidation

### **Manual Deployment**
```bash
# Build and deploy
mkdir -p build
cp index.html build/
cp -r css js members auth pics build/
aws --profile icup_website_user s3 sync build/ s3://international-cup-website-1757115851
aws --profile icup_website_user cloudfront create-invalidation --distribution-id E1SY6AVH5CLGVS --paths "/*"
```

---

## 📱 **User Experience**

### **Sign Up Flow**
1. Click "Members" → "Sign In to Continue"
2. Choose "Sign Up" → Enter details
3. Verify email → Sign in
4. Access member dashboard

### **Member Dashboard**
- Personalized welcome message
- Tournament registration status
- Quick action buttons
- Recent updates and announcements
- Member directory access

### **Responsive Design**
- Mobile-optimized authentication forms
- Touch-friendly social login buttons
- Responsive member dashboard
- Accessible keyboard navigation

---

## 🔧 **Configuration**

### **Environment Variables** (GitHub Secrets)
- `AWS_ACCESS_KEY_ID`: AWS access key
- `AWS_SECRET_ACCESS_KEY`: AWS secret key
- `AWS_REGION`: us-east-1
- `S3_BUCKET_NAME`: international-cup-website-1757115851
- `CLOUDFRONT_DISTRIBUTION_ID`: E1SY6AVH5CLGVS

### **Cognito Configuration** (in auth.js)
```javascript
const COGNITO_CONFIG = {
    UserPoolId: 'us-east-1_T5zttESw4',
    ClientId: 'q27ncptlccjrjkjrap017scp0',
    Domain: 'international-cup-auth.auth.us-east-1.amazoncognito.com',
    Region: 'us-east-1'
};
```

---

## 🎉 **What's Working Now**

✅ **Email/Password Authentication**
✅ **Member Dashboard**
✅ **Tournament Registration**
✅ **Member Directory**
✅ **Responsive Design**
✅ **Secure Session Management**
✅ **Automatic Deployment**

## 🔄 **Next: Social Provider Setup**

To complete the authentication system, set up the social providers using the commands above. Once configured, users will be able to sign in with Google, Facebook, and Apple in addition to email/password.

The member area is fully functional and ready for your tournament participants! 🏌️‍♂️⛳
