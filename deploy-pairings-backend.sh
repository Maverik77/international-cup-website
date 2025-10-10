#!/bin/bash

# International Cup Pairings Backend Deployment Script
# This script deploys the Lambda functions and API Gateway using AWS SAM

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 International Cup Pairings Backend Deployment${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Configuration
AWS_PROFILE="icup_website_user"
STACK_NAME="icup-pairings-system"
ADMIN_PASSWORD="${1:-icup2024}"

echo -e "${YELLOW}Configuration:${NC}"
echo "  AWS Profile: $AWS_PROFILE"
echo "  Stack Name: $STACK_NAME"
echo "  Admin Password: ********"
echo ""

# Check if AWS SAM CLI is installed
if ! command -v sam &> /dev/null; then
    echo -e "${RED}❌ Error: AWS SAM CLI is not installed!${NC}"
    echo -e "${YELLOW}Please install AWS SAM CLI: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html${NC}"
    exit 1
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ Error: AWS CLI is not installed!${NC}"
    exit 1
fi

echo -e "${BLUE}📦 Installing Lambda dependencies...${NC}"
cd lambda
if [ ! -d "node_modules" ]; then
    npm install
fi
cd ..
echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

echo -e "${BLUE}🏗️  Building SAM application...${NC}"
sam build --profile "$AWS_PROFILE"
echo -e "${GREEN}✅ Build complete${NC}"
echo ""

echo -e "${BLUE}📤 Deploying to AWS...${NC}"
sam deploy \
    --profile "$AWS_PROFILE" \
    --stack-name "$STACK_NAME" \
    --parameter-overrides AdminPassword="$ADMIN_PASSWORD" \
    --capabilities CAPABILITY_IAM \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""

# Get outputs
echo -e "${BLUE}📋 Stack Outputs:${NC}"
aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --profile "$AWS_PROFILE" \
    --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
    --output table

echo ""
echo -e "${GREEN}🎉 Backend deployment successful!${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Note the REST API URL and WebSocket URL from the outputs above"
echo "  2. Update the frontend files (admin.html, display.html) with these URLs"
echo "  3. Test the admin panel at /pairings/admin.html"
echo "  4. Test the display screen at /pairings/display.html"
echo ""

