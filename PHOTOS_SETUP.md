# Photo Gallery Setup Guide

This guide explains how to manage photos for the International Cup website using the photo gallery feature.

## Overview

The photo gallery automatically fetches all photos from a Google Photos shared album. Simply:
1. Create a shared album in Google Photos
2. Add photos to it
3. Paste the share link in `data/photos.json`
4. Done! All photos appear automatically on the website

## Quick Start - 3 Simple Steps

### Step 1: Create a Google Photos Album

1. Go to [Google Photos](https://photos.google.com/)
2. Click "Albums" → "Create album"
3. Name it (e.g., "International Cup 2025")
4. Upload all your tournament photos to this album

### Step 2: Get the Share Link

1. Open the album you just created
2. Click the "Share" button (top right)
3. Click "Create link" or "Get link"
4. Copy the share URL (it will look like `https://photos.app.goo.gl/xxxxx`)

### Step 3: Update `data/photos.json`

Add a new album entry at the top of the array (newest first):

```json
{
  "year": "2025",
  "title": "International Cup 2025",
  "description": "Highlights from the 2025 tournament at Lansdowne Golf Club",
  "shareUrl": "https://photos.app.goo.gl/YOUR_SHARE_LINK_HERE"
}
```

**That's it!** All photos from the Google Photos album will automatically appear on the website.

### Deploy the Changes

```bash
# Commit your changes
git add data/photos.json
git commit -m "Add 2025 tournament photos"
git push origin main
```

The changes will be live in 2-3 minutes via GitHub Actions.

## Adding More Photos to an Existing Album

To add more photos after the album is already set up:

1. Go to the Google Photos album
2. Click "Add photos"
3. Upload the new photos
4. **No code changes needed!** The new photos will automatically appear on the website within a few minutes

The website caches photo data for performance, so new photos may take 5-10 minutes to appear.

## Managing Multiple Years

Your `data/photos.json` can have multiple years:

```json
[
  {
    "year": "2025",
    "title": "International Cup 2025",
    "description": "Highlights from the 2025 tournament",
    "shareUrl": "https://photos.app.goo.gl/2025AlbumLinkHere"
  },
  {
    "year": "2024",
    "title": "International Cup 2024",
    "description": "Highlights from the 2024 tournament",
    "shareUrl": "https://photos.app.goo.gl/2024AlbumLinkHere"
  },
  {
    "year": "2023",
    "title": "International Cup 2023",
    "description": "Memorable moments from 2023",
    "shareUrl": "https://photos.app.goo.gl/2023AlbumLinkHere"
  }
]
```

## Photo Quality Tips

For best results:
- **Upload high-quality original photos** - Google Photos handles optimization
- **Use landscape orientation** when possible (4:3 or 16:9 ratio works best)
- **Avoid screenshots** - upload original camera photos
- **No file size limit** in Google Photos (uses your Google Drive storage)

## Photo Gallery Features

### For Users
- **Year Selection**: Click on a year to view photos from that tournament
- **Slideshow**: Auto-advance through photos with play/pause controls
- **Lightbox**: Click any photo to view full-size with navigation
- **Keyboard Navigation**: Arrow keys (←/→) to navigate, Esc to close
- **Mobile Support**: Swipe gestures work on touch devices

### Slideshow Controls
- **Start Slideshow**: Automatically cycles through photos every 3 seconds
- **Pause**: Stop auto-advance
- **Manual Navigation**: Use arrow buttons or keyboard even during slideshow

## How It Works

When someone visits the photos page:

1. The website reads `data/photos.json` to get album share URLs
2. Our backend fetches all photos from the Google Photos album
3. Photos are displayed in a grid with lightbox and slideshow features
4. Results are cached for 24 hours for performance

**You never need to manually list individual photos** - just maintain the Google Photos album!

## File Structure

```
international_cup_website/
├── photos.html                      # Photo gallery page
├── css/photos.css                   # Gallery styles
├── js/photos.js                     # Gallery functionality
├── data/photos.json                 # Album configuration (EDIT THIS FILE)
└── lambda/googlePhotosProxy/        # Backend API to fetch photos
    └── index.js
```

## Troubleshooting

### Photos not showing up
1. **Check the share link** - Make sure the Google Photos album is set to "Anyone with the link"
2. **Verify JSON syntax** - Use [JSONLint](https://jsonlint.com/) to validate `data/photos.json`
3. **Check browser console** - Press F12 and look for error messages
4. **Wait a few minutes** - Photos are cached, so changes may take 5-10 minutes

### "No photos found" message
- Verify the shareUrl is correct in `data/photos.json`
- Make sure the Google Photos album is publicly shared
- Check that photos exist in the album

### Slideshow not working
- Make sure you have at least 2 photos in the album
- Click "Start Slideshow" after opening the album

### Some photos missing
- Google Photos may not include all photo types (videos won't appear)
- Check that all photos are in the album (not just added to Google Photos)

## Security Notes

- All photo URLs are public (anyone with the URL can view)
- Don't include sensitive information in photos
- Use Google Photos or S3 for reliable hosting
- Consider watermarking if copyright is a concern

## Questions?

Contact the website administrator or refer to the main README.md for general website information.

