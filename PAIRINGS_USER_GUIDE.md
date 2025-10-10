# International Cup - Pairings Reveal System User Guide

## Overview

The International Cup Pairings Reveal System allows you to manage player rosters, set up match pairings, and control dramatic reveal animations on a display screen during the pairings party.

## Quick Start

### 1. Admin Panel Access

1. Navigate to `/pairings/admin.html`
2. Enter the admin password (default: `icup2024`)
3. Click **Login**

### 2. Set Up Player Roster

**Before creating pairings, you need to set up your player roster.**

#### Add Players:

1. In the **Player Roster Management** section, you'll see two columns:
   - 🇺🇸 **Team USA** (left)
   - 🌍 **Team International** (right)

2. Click **+ Add USA Player** or **+ Add International Player**

3. Fill in player details:
   - **First Name** (required)
   - **Last Name** (required)
   - **Nickname** (optional) - e.g., "Big Cat", "The Hammer"
   - **Tee Color** - Select Blue or White tees (default: Blue)

4. Click **Save Roster** to persist all players to the database

#### Load Sample Data:

For testing, click **Load Sample Data** to populate with example players.

#### Edit/Delete Players:

- To edit: Simply change the values in the input fields and click **Save Roster**
- To delete: Click the **Delete** button next to the player

### 3. Set Up Pairings

#### Day 1 - Team Matches (12 matches):

For each match:

1. **Select Reveal Order:**
   - Choose **USA First** to reveal the USA team first
   - Choose **International First** to reveal the International team first

2. **Select Players:**
   - Use the dropdowns to select players for each position
   - USA Player 1, USA Player 2 (left side)
   - International Player 1, International Player 2 (right side)

3. Player names display as:
   - "First Last" (if no nickname)
   - "First Last (Nickname)" (if nickname exists)

#### Day 2 - Singles Matches (24 matches):

For each match:

1. **Select Reveal Order:**
   - Choose **USA First** or **International First**

2. **Select Players:**
   - USA Player (left side)
   - International Player (right side)

#### Save Pairings:

Click **Save All Pairings** to persist all match configurations to the database.

### 4. Display Screen Setup

1. Open `/pairings/display.html` on your display screen/projector
2. The screen connects automatically via WebSocket
3. Wait for "Connected ✓" status (disappears after 2 seconds)
4. Screen shows two columns:
   - **Day 1 - Team Matches** (left)
   - **Day 2 - Singles Matches** (right)

### 5. Reveal Pairings During Event

#### Two-Step Reveal Process:

Each match has a **two-step reveal**:

1. **Step 1 - First Side:**
   - Click **Reveal First Side** on any match
   - On the display screen:
     - Large animated box appears
     - Shows first team/player (based on reveal order)
     - Stays on screen until you proceed

2. **Step 2 - Second Side:**
   - Click **Reveal Second Side**
   - On the display screen:
     - Second team/player appears next to first
     - Both teams visible for 3 seconds
     - Automatically transitions to match grid
     - Match now permanently visible in overview

#### Reveal Status:

Each match card shows current status:
- **Not Started** (gray) - Not revealed yet
- **Side 1 Revealed** (orange) - First side shown
- **Both Revealed** (green) - Fully revealed and in grid

#### Reveal Order Examples:

**Example 1: USA First**
- Step 1: USA team appears (red box)
- Step 2: International team appears (navy box)
- Both shown together, then added to grid

**Example 2: International First**
- Step 1: International team appears (navy box)
- Step 2: USA team appears (red box)
- Both shown together, then added to grid

### 6. Reset Reveals

To start over:

1. Click **Reset All Reveals** in admin panel
2. Confirm the action
3. All matches return to "Not Started" status
4. Display screen clears all revealed matches

## Display Screen Features

### Responsive Layout

- Automatically scales to fit your screen size
- All matches visible without scrolling
- Font sizes adjust based on viewport
- Optimized for 1920x1080 projectors

### Team Colors

- **USA Side:** Red background (`#DC143C`)
- **International Side:** Navy background (`#000080`)
- **Accent:** Gold (`#FFD700`)

### Animation Details

- **Large reveal boxes:** 60px padding, 3.5rem font size
- **Animation duration:** 1.2 seconds
- **Hold time:** 3 seconds (both teams visible)
- **Transition:** Smooth fade to grid

## Tips & Best Practices

### Before the Event:

1. ✅ Set up all players in the roster (both teams)
2. ✅ Configure all pairings for Day 1 and Day 2
3. ✅ Set reveal order for each match
4. ✅ Save roster and pairings
5. ✅ Test reveals with a few matches
6. ✅ Reset all reveals before the event

### During the Event:

1. 🎭 Reveal matches in any order you want
2. 🎬 Control the pace - wait for crowd reactions
3. 🔄 Each match is independent - reveal strategically
4. 📺 Keep display screen visible throughout

### After Reveal:

- All revealed matches remain visible in the grid
- Unrevealed matches are hidden (no spoilers!)
- Display auto-updates via WebSocket

## Troubleshooting

### "Connection Error" on Login:

- Check that REST API URL is correct in admin.html
- Verify admin password
- Check AWS Lambda functions are deployed

### Display Screen Shows "Disconnected":

- Check that WebSocket URL is correct in display.html
- Verify AWS API Gateway WebSocket is active
- Screen will auto-reconnect after 5 seconds

### Players Not Appearing in Dropdowns:

- Make sure you've saved the roster
- Refresh the admin page
- Check browser console for errors

### Reveals Not Appearing on Display:

- Verify display screen shows "Connected ✓"
- Check that pairings are saved
- Try refreshing the display screen

## API Endpoints

### REST API (Admin Only)

- `GET /players` - Fetch all players
- `POST /players` - Update player roster (requires password)
- `GET /pairings` - Fetch all pairings
- `POST /pairings` - Update pairings (requires password)
- `POST /reveal` - Trigger reveal step (requires password)

### WebSocket (Display Screen)

- `wss://[endpoint]/prod` - Real-time reveal updates
- Auto-reconnects on disconnect
- Broadcasts reveal events to all connected displays

## Data Persistence

All data is stored in DynamoDB:

- **icup-players** - Player roster
- **icup-pairings** - Match pairings and reveal state
- **icup-reveal-state** - Current reveal progress
- **icup-websocket-connections** - Active display connections

## Security

- Admin functions require password authentication
- Password header: `X-Admin-Password`
- Display screen has read-only access
- No authentication required for viewing

## Browser Compatibility

Tested and supported:
- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

## Mobile Support

Admin panel is responsive and works on tablets, but large screen recommended for best experience.

Display screen is optimized for landscape orientation and large displays.

## Need Help?

For technical issues:
1. Check browser console for errors
2. Verify API URLs in HTML files
3. Confirm AWS resources are deployed
4. Check admin password is correct

For feature requests or bugs, contact the development team.

---

**Enjoy your pairings party! 🏌️⛳🎉**

