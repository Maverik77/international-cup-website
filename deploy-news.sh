#!/bin/bash

# Quick News.json Deployment Script
# This script uploads the local data/news.json file to S3 and invalidates CloudFront cache
# Usage: ./deploy-news.sh

# Configuration
S3_BUCKET="international-cup-website-1757115851"
CLOUDFRONT_DISTRIBUTION_ID="E1SY6AVH5CLGVS"
AWS_PROFILE="icup_website_user"
NEWS_FILE="data/news.json"
S3_PATH="s3://${S3_BUCKET}/data/news.json"
CLOUDFRONT_PATH="/data/news.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 International Cup News Deployment Script${NC}"
echo -e "${BLUE}============================================${NC}"

# Check if news.json file exists
if [ ! -f "$NEWS_FILE" ]; then
    echo -e "${RED}❌ Error: $NEWS_FILE not found!${NC}"
    echo -e "${YELLOW}Make sure you're running this script from the project root directory.${NC}"
    exit 1
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ Error: AWS CLI is not installed!${NC}"
    echo -e "${YELLOW}Please install AWS CLI first: https://aws.amazon.com/cli/${NC}"
    exit 1
fi

# Display current news.json content
echo -e "${YELLOW}📄 Current news.json content:${NC}"
cat "$NEWS_FILE"
echo ""

# Confirm deployment
read -p "🤔 Deploy this news.json to the live website? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}⏸️  Deployment cancelled.${NC}"
    exit 0
fi

echo -e "${BLUE}📤 Uploading $NEWS_FILE to S3...${NC}"

# Upload to S3
if aws s3 cp "$NEWS_FILE" "$S3_PATH" --profile "$AWS_PROFILE"; then
    echo -e "${GREEN}✅ Successfully uploaded to S3!${NC}"
else
    echo -e "${RED}❌ Failed to upload to S3!${NC}"
    exit 1
fi

echo -e "${BLUE}🔄 Invalidating CloudFront cache...${NC}"

# Invalidate CloudFront cache
if aws cloudfront create-invalidation \
    --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
    --paths "$CLOUDFRONT_PATH" \
    --profile "$AWS_PROFILE" > /dev/null; then
    echo -e "${GREEN}✅ CloudFront cache invalidated!${NC}"
else
    echo -e "${RED}❌ Failed to invalidate CloudFront cache!${NC}"
    echo -e "${YELLOW}⚠️  File uploaded but cache invalidation failed. Changes may take up to 24 hours to appear.${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo -e "${BLUE}Your news is now live at:${NC}"
echo -e "${YELLOW}CloudFront: https://d27vw8m1q99ri5.cloudfront.net/data/news.json${NC}"
echo -e "${YELLOW}Website: https://d27vw8m1q99ri5.cloudfront.net${NC}"
echo ""
echo -e "${BLUE}💡 Tip: Changes may take 1-2 minutes to appear due to CloudFront propagation.${NC}"

