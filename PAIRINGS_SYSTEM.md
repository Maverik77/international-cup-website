## International Cup Pairings Reveal System

## Overview

The Pairings Reveal System is a real-time, interactive platform for revealing tournament pairings at the International Cup pairings party. Similar to the Ryder Cup, it provides:

- **Admin Panel**: Password-protected interface to manage pairings and control reveals
- **Display Screen**: Full-screen display optimized for projectors/TVs with animated reveals
- **Real-time Updates**: WebSocket-based instant synchronization between admin and display
- **Animated Reveals**: Dramatic reveal sequences showing USA team first, then International team

## Architecture

### Frontend
- **Admin Panel** (`/pairings/admin.html`) - Password-protected pairing management
- **Display Screen** (`/pairings/display.html`) - Large screen view with animations
- **CSS** (`/css/pairings.css`) - Styles and animations

### Backend (AWS Serverless)
- **DynamoDB Tables**: 
  - `icup-pairings` - Stores all pairing data
  - `icup-reveal-state` - Tracks reveal progress
  - `icup-websocket-connections` - Active WebSocket connections
- **Lambda Functions**:
  - `getPairings` - Fetch current pairings
  - `updatePairings` - Save pairing changes (password-protected)
  - `revealNext` - Trigger next reveal animation
  - `websocketConnect/Disconnect` - WebSocket connection management
- **API Gateway**:
  - REST API for CRUD operations
  - WebSocket API for real-time updates

## Deployment

### Step 1: Deploy Backend

1. **Install AWS SAM CLI** (if not already installed):
   ```bash
   brew install aws-sam-cli
   # or
   pip install aws-sam-cli
   ```

2. **Install Lambda dependencies**:
   ```bash
   cd lambda
   npm install
   cd ..
   ```

3. **Deploy the backend**:
   ```bash
   ./deploy-pairings-backend.sh
   ```
   
   Or with custom admin password:
   ```bash
   ./deploy-pairings-backend.sh your-custom-password
   ```

4. **Note the outputs**:
   The deployment will output:
   - REST API URL (e.g., `https://abc123.execute-api.us-east-1.amazonaws.com/prod`)
   - WebSocket URL (e.g., `wss://xyz789.execute-api.us-east-1.amazonaws.com/prod`)

### Step 2: Configure Frontend

1. **Update Admin Panel** (`pairings/admin.html`):
   ```javascript
   const CONFIG = {
       REST_API_URL: 'https://YOUR_API_GATEWAY_URL/prod',
       WEBSOCKET_URL: 'wss://YOUR_WEBSOCKET_URL/prod'
   };
   ```

2. **Update Display Screen** (`pairings/display.html`):
   ```javascript
   const CONFIG = {
       REST_API_URL: 'https://YOUR_API_GATEWAY_URL/prod',
       WEBSOCKET_URL: 'wss://YOUR_WEBSOCKET_URL/prod'
   };
   ```

### Step 3: Deploy Frontend

Push changes to your branch:
```bash
git add .
git commit -m "feat(pairings): add pairing reveal system"
git push origin feature/pairing-reveal
```

Merge to staging for testing:
```bash
git checkout staging
git merge feature/pairing-reveal
git push origin staging
```

Test at: `https://staging.lansdowne-international-cup.com/pairings/admin.html`

## Usage Guide

### Admin Panel Setup

1. **Access Admin Panel**:
   Navigate to `/pairings/admin.html`

2. **Login**:
   Enter admin password (default: `icup2024`)

3. **Load Sample Data** (optional):
   Click "Load Sample Data" to populate with test names

4. **Enter Pairings**:
   - **Day 1 Team Matches**: Enter 4 players per match (2 USA + 2 International)
   - **Day 2 Singles Matches**: Enter 2 players per match (1 USA + 1 International)

5. **Save Changes**:
   Click "Save All Changes" to persist to database

### Display Screen Setup

1. **Connect Display**:
   - Connect TV/projector to computer
   - Open browser and navigate to `/pairings/display.html`
   - Press F11 for fullscreen mode

2. **Verify Connection**:
   - Green "Connected ✓" indicator should appear briefly
   - Status will auto-hide after 2 seconds

3. **Position Display**:
   - Display should show split view: Day 1 teams on left, Day 2 singles on right
   - Initially empty until reveals begin

### Revealing Pairings at Party

1. **Admin Controls**:
   - Click "Reveal Next Pairing" to show next match
   - Each click triggers the reveal sequence

2. **Reveal Sequence**:
   - USA team/player appears first (red background)
   - Brief pause (1.5 seconds)
   - International team/player appears (navy background)
   - Both slide into grid display

3. **Progress Tracking**:
   - Status shows "Revealed: X / 36"
   - Next pairing to reveal is displayed
   - Revealed pairings show ✅ checkmark

4. **Reset if Needed**:
   - Click "Reset All Reveals" to start over
   - Confirms before resetting

## Data Structure

### Team Match
```json
{
  "id": "day1-team-1",
  "type": "team",
  "day": 1,
  "match_number": 1,
  "usa_team": {
    "player1": "John Smith",
    "player2": "Mike Johnson"
  },
  "intl_team": {
    "player1": "Pierre Dubois",
    "player2": "Hans Schmidt"
  },
  "revealed": false,
  "reveal_stage": 0
}
```

### Singles Match
```json
{
  "id": "day2-singles-1",
  "type": "singles",
  "day": 2,
  "match_number": 1,
  "usa_player": "John Smith",
  "intl_player": "Pierre Dubois",
  "revealed": false,
  "reveal_stage": 0
}
```

## Troubleshooting

### Display Not Updating

1. **Check Connection Status**:
   - Look for connection indicator in top-right
   - Should show "Connected ✓"

2. **Check WebSocket URL**:
   - Verify WebSocket URL is correct in `display.html`
   - Check browser console for errors

3. **Reconnection**:
   - Display auto-reconnects every 5 seconds if disconnected
   - Manually refresh page if needed

### Admin Changes Not Saving

1. **Verify Password**:
   - Incorrect password will show 401 error in console
   - Clear localStorage and re-login if needed

2. **Check API URL**:
   - Verify REST API URL is correct in `admin.html`
   - Check browser console for errors

3. **Database Connection**:
   - Verify DynamoDB tables exist
   - Check Lambda function logs in CloudWatch

### WebSocket Issues

1. **Check Lambda Permissions**:
   - Verify Lambda has permissions to post to WebSocket connections
   - Check IAM role in CloudFormation stack

2. **Check Connection Table**:
   - Verify `icup-websocket-connections` table exists
   - Check for stale connections

3. **API Gateway Logs**:
   - Enable CloudWatch logs for WebSocket API
   - Check for connection/disconnection events

### Animation Not Working

1. **Check CSS Loading**:
   - Verify `/css/pairings.css` is loading correctly
   - Check browser console for 404 errors

2. **Browser Compatibility**:
   - Use modern browsers (Chrome, Firefox, Edge, Safari)
   - Ensure JavaScript is enabled

3. **Clear Cache**:
   - Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)

## Security

### Admin Password
- Stored as environment variable in Lambda functions
- Change default password before production use
- Update in CloudFormation parameters:
  ```bash
  ./deploy-pairings-backend.sh your-secure-password
  ```

### API Security
- CORS restricted to your domain
- Admin endpoints require password header
- API Gateway throttling enabled

### WebSocket Security
- Connection limit per client
- Automatic cleanup of stale connections
- No authentication required for display (read-only)

## Cost Estimate

AWS resources (serverless, pay-per-use):
- **DynamoDB**: ~$0.25/month (low usage)
- **Lambda**: ~$0.20/month (free tier covers most)
- **API Gateway**: ~$1.00/month
- **WebSocket**: ~$1.00/month
- **Total**: ~$2-3/month

During pairings party (active use):
- WebSocket messages: ~$0.001 per 1000 messages
- Lambda invocations: ~$0.0001 per invoke
- Total for event: < $0.10

## Best Practices

### Before the Party

1. **Test Everything**:
   - Deploy to staging first
   - Test full reveal sequence
   - Verify WebSocket connectivity

2. **Backup Data**:
   - Export pairings from DynamoDB
   - Save locally as JSON

3. **Prepare Display**:
   - Test projector/TV setup
   - Ensure good WiFi connection
   - Have backup laptop ready

### During the Party

1. **Keep Admin Panel Open**:
   - Monitor connection status
   - Watch for any errors

2. **Pace Reveals**:
   - Allow time for audience reaction
   - Don't rush through pairings

3. **Have Backup**:
   - Print pairing list as fallback
   - Have manual refresh button ready

### After the Party

1. **Keep Data**:
   - Don't reset reveals immediately
   - Export final pairings

2. **Leave Display Running**:
   - Keep full grid visible for photos
   - Display remains accessible

## Future Enhancements

Potential improvements for future tournaments:

- **Multiple Administrators**: Support multiple logged-in admins
- **Undo Function**: Ability to un-reveal last pairing
- **Custom Animations**: Different animations per round
- **Sound Effects**: Audio cues during reveals
- **Photo Integration**: Display player photos
- **Mobile App**: Native iOS/Android apps
- **Live Scoring**: Integrate with live tournament scoring
- **Historical Data**: Archive past pairings

## Support

For issues or questions:
1. Check this documentation
2. Review CloudWatch logs
3. Test in staging environment
4. Contact system administrator

## Technical Details

### File Structure
```
/pairings/
├── admin.html          # Admin panel
├── display.html        # Display screen
/css/
├── pairings.css        # Styles and animations
/lambda/
├── getPairings/        # Fetch pairings Lambda
├── updatePairings/     # Update pairings Lambda
├── revealNext/         # Reveal control Lambda
├── websocketConnect/   # WebSocket connect Lambda
├── websocketDisconnect/# WebSocket disconnect Lambda
└── package.json        # Lambda dependencies
/
├── pairings-infrastructure.yaml  # CloudFormation template
└── deploy-pairings-backend.sh   # Deployment script
```

### API Endpoints

**REST API:**
- `GET /pairings` - Fetch all pairings and reveal state
- `POST /pairings` - Update pairings (requires password)
- `POST /reveal/next` - Trigger next reveal (requires password)

**WebSocket API:**
- `wss://[api-id].execute-api.us-east-1.amazonaws.com/prod`
- Messages:
  - `{ type: 'reveal', pairing: {...} }` - New pairing revealed
  - `{ type: 'reset' }` - Reveals reset

### Database Schema

**icup-pairings:**
- Primary Key: `id` (String)
- Attributes: type, day, match_number, teams/players, revealed, reveal_stage

**icup-reveal-state:**
- Primary Key: `id` (String, always "current")
- Attributes: currentRevealIndex, revealedIds, lastUpdated

**icup-websocket-connections:**
- Primary Key: `connectionId` (String)
- Attributes: connectedAt

## License

Copyright © 2024 International Cup. All rights reserved.

