# Pairings System Quick Start Guide

## ✅ What's Been Built

Your complete pairing reveal system is ready! Here's what was created:

### 🎯 Features
- **Player Roster Management**: Add/edit players with names, nicknames, and tee colors
- **Admin Panel**: Password-protected pairing management at `/pairings/admin.html`
- **Display Screen**: Full-screen animated display at `/pairings/display.html`
- **Two-Step Reveals**: Stage first side, then reveal opponent
- **Flexible Reveal Order**: Choose USA-first or International-first per match
- **Real-time Updates**: WebSocket synchronization between admin and display
- **Team Colors**: USA Red (#DC143C), International Navy (#000080)
- **Responsive Display**: Fits all matches without scrolling
- **12 Team Matches** (Day 1) + **24 Singles Matches** (Day 2)

### 🏗️ Infrastructure
- **4 DynamoDB Tables**: Deployed and ready
  - `icup-pairings` ✅
  - `icup-reveal-state` ✅
  - `icup-websocket-connections` ✅
  - `icup-players` ✅ (NEW)
- **7 Lambda Functions**: Deployed ✅
  - `GetPairingsFunction`
  - `UpdatePairingsFunction`
  - `GetPlayersFunction` (NEW)
  - `UpdatePlayersFunction` (NEW)
  - `RevealPairingFunction` (NEW - replaces RevealNext)
  - `WebSocketConnectFunction`
  - `WebSocketDisconnectFunction`
- **CloudFormation Template**: Infrastructure as code
- **Deployment Script**: Automated deployment

## 🚀 Current Status

### ✅ Backend Deployed

The backend has been successfully deployed to AWS:

- **REST API URL**: `https://35taqw9rrk.execute-api.us-east-1.amazonaws.com/prod`
- **WebSocket URL**: `wss://5xshmnvtv2.execute-api.us-east-1.amazonaws.com/prod`
- **Admin Password**: `icup2024`

Frontend files (`admin.html` and `display.html`) are already configured with these URLs!

### 📍 What's Left

1. **Test in staging** (merge feature branch to staging)
2. **Test player roster management**
3. **Test two-step reveals**
4. **Go live** (merge to main when ready)

## 🧪 Testing Steps

### Step 1: Merge to Staging Branch

```bash
git checkout staging
git merge feature/pairing-reveal
git push origin staging
```

Wait ~2 minutes for GitHub Actions deployment.

### Step 2: Test Player Roster

1. **Open admin panel**: https://staging.lansdowne-international-cup.com/pairings/admin.html
2. **Login** (password: `icup2024`)
3. **Click "Load Sample Data"** to populate test players
4. **Click "Save Roster"** to persist
5. **Verify** players appear in dropdowns below

### Step 3: Set Up Test Pairings

1. **For Match 1 (Day 1)**:
   - Set reveal order: **USA First**
   - Select USA Player 1: John Smith
   - Select USA Player 2: Mike Johnson
   - Select International Player 1: Pierre Dubois
   - Select International Player 2: Hans Schmidt

2. **For Match 2 (Day 1)**:
   - Set reveal order: **International First**
   - Select players from dropdowns

3. **Click "Save All Pairings"**

### Step 4: Test Two-Step Reveals

1. **Open display screen** in new window: https://staging.lansdowne-international-cup.com/pairings/display.html
2. **Verify** "Connected ✓" appears
3. **On admin panel**, find Match 1:
   - Click **"Reveal First Side"**
   - **Watch display**: USA team appears (red box)
   - **Status changes** to "Side 1 Revealed"
4. **Click "Reveal Second Side"**:
   - **Watch display**: International team appears (navy box)
   - **Both teams hold** for 3 seconds
   - **Match appears** in grid
   - **Status changes** to "Both Revealed"

5. **Test Match 2** with International-first order:
   - Click **"Reveal First Side"**
   - **Watch display**: International team appears first
   - Click **"Reveal Second Side"**
   - **Watch display**: USA team appears second

6. **Click "Reset All Reveals"**:
   - Confirm reset
   - **Verify** display clears
   - **All matches** return to "Not Started"

### Step 5: Go Live (when ready)

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

1. **Enter All Players**:
   - Open admin panel
   - Add all USA players (names, nicknames, tee colors)
   - Add all International players
   - **Save Roster**

2. **Configure All Pairings**:
   - Set up all 12 Day 1 team matches
   - Set up all 24 Day 2 singles matches
   - Choose reveal order for each match
   - **Save All Pairings**

3. **Connect Display**:
   - Connect laptop to projector/TV
   - Open display screen in browser: `/pairings/display.html`
   - Press F11 for fullscreen
   - Verify "Connected ✓" appears

4. **Admin Setup**:
   - Open admin panel on your laptop/tablet
   - Login with password
   - Keep admin panel visible

### During Party

1. **Two-Step Reveal Process**:
   - **Step 1**: Click **"Reveal First Side"** on any match
     - First team/player appears on display (based on reveal order)
     - Large animated box with team color
     - Stays visible until you proceed
   - **Step 2**: Click **"Reveal Second Side"**
     - Second team/player appears next to first
     - Both visible for 3 seconds
     - Automatically added to match grid

2. **Flexible Order**:
   - Reveal any match in any order
   - USA-first or International-first per match
   - Each match is independent

3. **Pace Yourself**:
   - Allow time for audience reaction between steps
   - Build anticipation before revealing opponent
   - Space out reveals for dramatic effect

4. **Status Tracking**:
   - **Not Started** (gray) - Not revealed yet
   - **Side 1 Revealed** (orange) - Waiting for second side
   - **Both Revealed** (green) - Complete, visible in grid

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

