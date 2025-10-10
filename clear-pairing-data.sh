#!/bin/bash

# Clear all pairing data from DynamoDB tables
# This script removes all items from the pairings, players, and reveal state tables

set -e

AWS_PROFILE="icup_website_user"
REGION="us-east-1"

echo "🗑️  Clearing International Cup Pairing System Data"
echo "=================================================="
echo ""

# Function to clear a table
clear_table() {
    local TABLE_NAME=$1
    echo "Clearing table: $TABLE_NAME"
    
    # Get all items
    ITEMS=$(aws dynamodb scan \
        --table-name "$TABLE_NAME" \
        --profile "$AWS_PROFILE" \
        --region "$REGION" \
        --output json)
    
    # Extract primary keys and delete items
    KEYS=$(echo "$ITEMS" | jq -r '.Items[] | .id.S' 2>/dev/null || echo "")
    
    if [ -z "$KEYS" ]; then
        echo "  ✓ Table is already empty"
    else
        COUNT=0
        for KEY in $KEYS; do
            aws dynamodb delete-item \
                --table-name "$TABLE_NAME" \
                --key "{\"id\": {\"S\": \"$KEY\"}}" \
                --profile "$AWS_PROFILE" \
                --region "$REGION" >/dev/null 2>&1
            ((COUNT++))
        done
        echo "  ✓ Deleted $COUNT items"
    fi
    echo ""
}

# Clear each table
echo "1. Clearing Players Table..."
clear_table "icup-players"

echo "2. Clearing Pairings Table..."
clear_table "icup-pairings"

echo "3. Clearing Reveal State Table..."
clear_table "icup-reveal-state"

echo "✅ All pairing data cleared successfully!"
echo ""
echo "Next steps:"
echo "1. Refresh the admin panel"
echo "2. Click 'Initialize Empty Pairings' to recreate the structure"
echo "3. Add your players and set up fresh pairings"
echo ""

