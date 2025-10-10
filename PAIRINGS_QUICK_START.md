# Pairings System Quick Start Guide

## ✅ What's Been Built

Your complete pairing reveal system is ready! Here's what was created:

### 🎯 Features
- **Admin Panel**: Password-protected pairing management at `/pairings/admin.html`
- **Display Screen**: Full-screen animated display at `/pairings/display.html`
- **Real-time Updates**: WebSocket synchronization between admin and display
- **Team Colors**: USA Red (#DC143C), International Navy (#000080)
- **Animated Reveals**: Dramatic reveal sequences for the pairings party
- **12 Team Matches** (Day 1) + **24 Singles Matches** (Day 2)

### 🏗️ Infrastructure
- **3 DynamoDB Tables**: Created and ready
  - `icup-pairings` ✅
  - `icup-reveal-state` ✅
  - `icup-websocket-connections` ✅
- **6 Lambda Functions**: Written and ready to deploy
- **CloudFormation Template**: Infrastructure as code
- **Deployment Script**: Automated deployment

## 🚀 Next Steps to Go Live

### Step 1: Deploy Backend (5 minutes)

The backend needs to be deployed to AWS using SAM. Here's how:

1. **Install AWS SAM CLI** (one-time setup):
   ```bash
   brew install aws-sam-cli
   ```

2. **Deploy the backend**:
   ```bash
   cd /Users/erikwagner/coding/international_cup_website
   ./deploy-pairings-backend.sh icup2024
   ```
   *(Replace `icup2024` with your desired admin password)*

3. **Note the outputs**:
   After deployment, you'll see:
   ```
   RestApiUrl: https://abc123.execute-api.us-east-1.amazonaws.com/prod
   WebSocketUrl: wss://xyz789.execute-api.us-east-1.amazonaws.com/prod
   ```
   **SAVE THESE URLS!** You'll need them for the next step.

### Step 2: Configure Frontend (2 minutes)

Update both HTML files with your API URLs:

**File 1:** `pairings/admin.html` (line 15-18)
```javascript
const CONFIG = {
    REST_API_URL: 'https://YOUR_ACTUAL_API_URL/prod',  // ← Replace with RestApiUrl
    WEBSOCKET_URL: 'wss://YOUR_ACTUAL_WS_URL/prod'      // ← Replace with WebSocketUrl
};
```

**File 2:** `pairings/display.html` (line 54-57)
```javascript
const CONFIG = {
    REST_API_URL: 'https://YOUR_ACTUAL_API_URL/prod',  // ← Replace with RestApiUrl
    WEBSOCKET_URL: 'wss://YOUR_ACTUAL_WS_URL/prod'      // ← Replace with WebSocketUrl
};
```

### Step 3: Test in Staging (5 minutes)

1. **Commit and push changes**:
   ```bash
   git add pairings/admin.html pairings/display.html
   git commit -m "config: update pairing system API URLs"
   git push origin feature/pairing-reveal
   ```

2. **Merge to staging**:
   ```bash
   git checkout staging
   git merge feature/pairing-reveal
   git push origin staging
   ```

3. **Wait for deployment** (~2 minutes)
   Watch GitHub Actions: https://github.com/Maverik77/international-cup-website/actions

4. **Test the system**:
   - **Admin**: https://staging.lansdowne-international-cup.com/pairings/admin.html
   - **Display**: https://staging.lansdowne-international-cup.com/pairings/display.html

### Step 4: Enter Pairings

1. **Open admin panel** and login (password: `icup2024` or your custom password)
2. **Click "Load Sample Data"** to test, or enter real player names
3. **Click "Save All Changes"** to persist to database

### Step 5: Test Reveals

1. **Open display screen** in a separate window/tab
2. **On admin panel**, click "Reveal Next Pairing"
3. **Watch the animation**: USA team appears, then International team
4. **Verify** it shows in the display grid
5. **Continue** revealing more pairings to test

### Step 6: Go Live (when ready)

Once tested in staging, promote to production:

```bash
git checkout main
git merge feature/pairing-reveal
git push origin main
```

Access at:
- **Admin**: https://www.lansdowne-international-cup.com/pairings/admin.html
- **Display**: https://www.lansdowne-international-cup.com/pairings/display.html

## 📖 Usage at Pairings Party

### Setup (30 minutes before)

1. **Connect Display**:
   - Connect laptop to projector/TV
   - Open display screen in browser
   - Press F11 for fullscreen
   - Verify "Connected ✓" appears

2. **Admin Setup**:
   - Open admin panel on your laptop/tablet
   - Login with password
   - Verify all pairings are entered correctly
   - Keep admin panel visible

### During Party

1. **Start Reveals**:
   - Click "Reveal Next Pairing" when ready
   - USA team/player appears first (RED)
   - International team/player appears second (NAVY)
   - Both slide into the grid

2. **Pace Yourself**:
   - Allow time for audience reaction
   - Space out reveals for dramatic effect
   - Monitor display screen

3. **Status Tracking**:
   - Watch "Revealed: X / 36" counter
   - See next pairing to be revealed
   - ✅ indicates already revealed

### If Something Goes Wrong

**Display not updating?**
- Check connection status (top-right of display)
- Refresh display page
- Auto-reconnects every 5 seconds

**Want to start over?**
- Click "Reset All Reveals" in admin panel
- Confirms before resetting

**Save changes not working?**
- Verify password is correct
- Check browser console for errors
- Try logout and login again

## 📁 Important Files

- **Admin Panel**: `/pairings/admin.html`
- **Display Screen**: `/pairings/display.html`
- **Styles**: `/css/pairings.css`
- **Backend Deployment**: `./deploy-pairings-backend.sh`
- **Infrastructure**: `pairings-infrastructure.yaml`
- **Full Documentation**: `PAIRINGS_SYSTEM.md`

## 🔒 Security Notes

- **Admin Password**: Default is `icup2024`, change for production
- **Update Password**: Redeploy backend with: `./deploy-pairings-backend.sh your-new-password`
- **Display Access**: No password required (read-only view)

## 💰 Cost

AWS costs for this system:
- **DynamoDB**: ~$0.25/month
- **Lambda**: ~$0.20/month (mostly free tier)
- **API Gateway**: ~$1.00/month
- **WebSocket**: ~$1.00/month
- **Total**: ~$2-3/month

During pairings party: < $0.10 for the event

## 🎨 Customization

**Change Colors**: Edit `/css/pairings.css`
```css
:root {
    --usa-red: #DC143C;      /* ← Change USA color */
    --intl-navy: #000080;    /* ← Change International color */
    --accent-gold: #FFD700;  /* ← Change accent color */
}
```

**Adjust Animation Speed**: Edit display.html
```javascript
setTimeout(resolve, 1500);  // ← Change delay (milliseconds)
```

## 📞 Support

**For issues:**
1. Check `PAIRINGS_SYSTEM.md` documentation
2. Review browser console for errors
3. Check CloudWatch logs for Lambda functions
4. Test in staging first

**Current Branch**: `feature/pairing-reveal`
**Status**: ✅ Ready for backend deployment

---

**Ready to deploy?** Run: `./deploy-pairings-backend.sh icup2024`

