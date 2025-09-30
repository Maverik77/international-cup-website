# Quick News Deployment Guide

## Overview
The `deploy-news.sh` script allows you to quickly deploy news updates to your live website without waiting for GitHub Actions. This is perfect for urgent news updates or quick content changes.

## Usage

### 1. Edit your news
Edit the `data/news.json` file with your new content.

### 2. Run the deployment script
```bash
./deploy-news.sh
```

### 3. Confirm deployment
The script will show you the current content and ask for confirmation before deploying.

## What the Script Does

1. **Validates** that `data/news.json` exists
2. **Shows** you the current content before deploying
3. **Uploads** the file to S3 bucket: `international-cup-website-1757115851`
4. **Invalidates** CloudFront cache for immediate updates
5. **Confirms** successful deployment

## Features

- ✅ **Safety first**: Shows content and asks for confirmation
- ✅ **Error handling**: Checks for AWS CLI and file existence
- ✅ **Colored output**: Easy to read status messages
- ✅ **Fast deployment**: Bypasses GitHub Actions for quick updates
- ✅ **Cache invalidation**: Changes appear immediately (1-2 minutes)

## Requirements

- AWS CLI installed and configured
- `icup_website_user` AWS profile configured
- Run from the project root directory

## Example Output

```
🚀 International Cup News Deployment Script
============================================
📄 Current news.json content:
[... your news content ...]

🤔 Deploy this news.json to the live website? (y/N): y
📤 Uploading data/news.json to S3...
✅ Successfully uploaded to S3!
🔄 Invalidating CloudFront cache...
✅ CloudFront cache invalidated!

🎉 Deployment Complete!
Your news is now live at:
CloudFront: https://d27vw8m1q99ri5.cloudfront.net/data/news.json
Website: https://d27vw8m1q99ri5.cloudfront.net

💡 Tip: Changes may take 1-2 minutes to appear due to CloudFront propagation.
```

## Troubleshooting

### "AWS CLI is not installed"
Install AWS CLI: https://aws.amazon.com/cli/

### "data/news.json not found"
Make sure you're running the script from the project root directory.

### "Failed to upload to S3"
Check your AWS credentials and profile configuration:
```bash
aws configure list --profile icup_website_user
```

## When to Use This vs GitHub Actions

**Use this script when:**
- You need immediate news updates
- Testing content changes
- Making quick corrections
- You're working locally and want fast feedback

**Use GitHub Actions when:**
- Making comprehensive site updates
- Want version control and deployment history
- Deploying multiple files at once
- Following standard deployment workflow

