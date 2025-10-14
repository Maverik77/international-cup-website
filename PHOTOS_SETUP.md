# Photo Gallery Setup Guide

This guide explains how to manage photos for the International Cup website using the photo gallery feature.

## Overview

The photo gallery is organized by year and uses a simple JSON file to store photo metadata. You can either:
- Host photos on Google Photos and link to them
- Host photos directly on S3/CloudFront
- Use any other image hosting service

## Quick Start

### Adding a New Year Album

1. **Prepare Your Photos**
   - Collect all photos for the tournament year
   - Recommended: Resize images to reasonable web sizes (1920px max width is good)
   - Create thumbnail versions (optional - can use full images)

2. **Upload Photos to Google Photos (Recommended)**
   - Create a new album in Google Photos for the year (e.g., "International Cup 2025")
   - Upload all photos to this album
   - Click "Share" → Get shareable link
   - For each photo you want on the website:
     - Open the photo
     - Right-click → "Open image in new tab"
     - Copy the URL (it will look like `https://lh3.googleusercontent.com/...`)

3. **Update `data/photos.json`**

Add a new album entry at the top of the array (newest first):

```json
{
  "year": "2025",
  "title": "International Cup 2025",
  "description": "Highlights from the 2025 tournament at Lansdowne Golf Club",
  "photos": [
    {
      "url": "https://lh3.googleusercontent.com/YOUR_PHOTO_ID_HERE",
      "thumbnail": "https://lh3.googleusercontent.com/YOUR_PHOTO_ID_HERE=s400",
      "caption": "Tournament Day 1 - Opening Ceremony",
      "width": 1920,
      "height": 1080
    },
    {
      "url": "https://lh3.googleusercontent.com/ANOTHER_PHOTO_ID",
      "thumbnail": "https://lh3.googleusercontent.com/ANOTHER_PHOTO_ID=s400",
      "caption": "Team USA on the 18th hole",
      "width": 1920,
      "height": 1080
    }
  ]
}
```

**Google Photos URL Tips:**
- Full size: Use the URL as-is
- Thumbnail: Add `=s400` at the end (400px width)
- Other sizes: `=s800`, `=s1200`, etc.

4. **Deploy the Changes**

```bash
# Commit your changes
git add data/photos.json
git commit -m "Add 2025 tournament photos"
git push origin main
```

The changes will be live in 2-3 minutes via GitHub Actions.

## Alternative: Using S3/CloudFront

If you prefer to host photos directly:

1. **Upload photos to S3**

```bash
# Upload to the pics folder
aws s3 cp your-photo.jpg s3://international-cup-website-1757115851/pics/2025/ --profile icup_website_user
```

2. **Get CloudFront URLs**

The URL will be: `https://d27vw8m1q99ri5.cloudfront.net/pics/2025/your-photo.jpg`

3. **Update photos.json** with these URLs

## Photo Specifications

### Recommended Sizes
- **Full Size**: 1920px width (or original if smaller)
- **Thumbnail**: 400-600px width
- **Format**: JPEG (.jpg) for photos, PNG for graphics
- **Quality**: 85% for JPEGs is a good balance

### Image Optimization
For best performance, optimize images before uploading:

**Using ImageMagick:**
```bash
# Resize to 1920px width, maintain aspect ratio
convert original.jpg -resize 1920x original-web.jpg

# Create thumbnail (400px width)
convert original.jpg -resize 400x thumbnail.jpg
```

**Using Online Tools:**
- [TinyPNG](https://tinypng.com/) - Compress images
- [Squoosh](https://squoosh.app/) - Resize and optimize

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

## Updating Existing Albums

To add more photos to an existing year:

1. Add new photo objects to the `photos` array in that year's entry
2. Commit and push changes
3. Changes will be live automatically

## Captions

Keep captions concise and descriptive:
- ✅ Good: "Team USA celebrates victory on the 18th green"
- ✅ Good: "Day 2 Singles Matches - Morning tee times"
- ❌ Too long: "This is a photo from the second day of the tournament..."

## File Structure

```
international_cup_website/
├── photos.html          # Photo gallery page
├── css/photos.css       # Gallery styles
├── js/photos.js         # Gallery functionality
├── data/photos.json     # Photo metadata (THIS IS WHAT YOU EDIT)
└── pics/                # Optional: Store photos here in S3
    ├── 2024/
    ├── 2025/
    └── ...
```

## Troubleshooting

### Photos not showing up
1. Check that URLs are publicly accessible
2. Verify JSON syntax is correct (use [JSONLint](https://jsonlint.com/))
3. Check browser console for errors (F12)

### Slideshow not working
- Make sure you have at least 2 photos in the album
- Check that the lightbox is open before starting slideshow

### Performance issues
- Optimize/compress images before uploading
- Use appropriate thumbnail sizes
- Don't exceed 50 photos per album

## Security Notes

- All photo URLs are public (anyone with the URL can view)
- Don't include sensitive information in photos
- Use Google Photos or S3 for reliable hosting
- Consider watermarking if copyright is a concern

## Questions?

Contact the website administrator or refer to the main README.md for general website information.

