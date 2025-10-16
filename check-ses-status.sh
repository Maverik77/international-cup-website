#!/bin/bash

# Check SES Production Access Status
AWS_PROFILE="icup_website_user"

echo "📧 AWS SES Account Status"
echo "=========================="
echo ""

# Get account details
ACCOUNT_INFO=$(aws sesv2 get-account --profile "$AWS_PROFILE" --output json)

# Parse production access status
PROD_ACCESS=$(echo "$ACCOUNT_INFO" | jq -r '.ProductionAccessEnabled')
MAX_24H=$(echo "$ACCOUNT_INFO" | jq -r '.SendQuota.Max24HourSend')
SENT_24H=$(echo "$ACCOUNT_INFO" | jq -r '.SendQuota.SentLast24Hours')
MAX_RATE=$(echo "$ACCOUNT_INFO" | jq -r '.SendQuota.MaxSendRate')

if [ "$PROD_ACCESS" == "true" ]; then
    echo "✅ Production Access: ENABLED"
    echo ""
    echo "🎉 You can now send emails to any address!"
else
    echo "⏳ Production Access: PENDING"
    echo ""
    echo "📝 Status: Still in Sandbox mode"
    echo "   - Can only send to verified email addresses"
    echo "   - AWS is reviewing your production access request"
    echo "   - Usually approved within 1-24 hours"
fi

echo ""
echo "📊 Current Quotas:"
echo "   Max emails per 24h: $(printf "%.0f" $MAX_24H)"
echo "   Max send rate: $MAX_RATE emails/second"
echo "   Sent in last 24h: $(printf "%.0f" $SENT_24H)"
echo ""

# List verified emails
echo "✅ Verified Email Identities:"
aws sesv2 list-email-identities \
  --profile "$AWS_PROFILE" \
  --query 'EmailIdentities[].IdentityName' \
  --output text 2>/dev/null | tr '\t' '\n' | while read email; do
    if [ -n "$email" ]; then
      echo "   - $email"
    fi
done

echo ""
echo "💡 To check again, run: ./check-ses-status.sh"
echo ""

