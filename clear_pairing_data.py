#!/usr/bin/env python3
"""
Clear all pairing data from DynamoDB tables
"""

import boto3
from botocore.exceptions import ClientError

# Initialize DynamoDB client
session = boto3.Session(profile_name='icup_website_user', region_name='us-east-1')
dynamodb = session.resource('dynamodb')

TABLES = {
    'players': 'icup-players',
    'pairings': 'icup-pairings',
    'reveal_state': 'icup-reveal-state'
}

def clear_table(table_name, description):
    """Clear all items from a DynamoDB table"""
    print(f"\n{description}...")
    print(f"Clearing table: {table_name}")
    
    try:
        table = dynamodb.Table(table_name)
        
        # Scan and delete all items
        scan_kwargs = {}
        deleted_count = 0
        
        while True:
            response = table.scan(**scan_kwargs)
            items = response.get('Items', [])
            
            if not items:
                break
            
            # Delete items in batch
            with table.batch_writer() as batch:
                for item in items:
                    batch.delete_item(Key={'id': item['id']})
                    deleted_count += 1
            
            # Check if there are more items to scan
            if 'LastEvaluatedKey' not in response:
                break
            
            scan_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
        
        if deleted_count > 0:
            print(f"  ✓ Deleted {deleted_count} items")
        else:
            print(f"  ✓ Table is already empty")
        
        return deleted_count
        
    except ClientError as e:
        print(f"  ✗ Error: {e.response['Error']['Message']}")
        return 0

def main():
    print("🗑️  Clearing International Cup Pairing System Data")
    print("=" * 50)
    
    total_deleted = 0
    
    # Clear each table
    total_deleted += clear_table(TABLES['players'], "1. Clearing Players Table")
    total_deleted += clear_table(TABLES['pairings'], "2. Clearing Pairings Table")
    total_deleted += clear_table(TABLES['reveal_state'], "3. Clearing Reveal State Table")
    
    print("\n" + "=" * 50)
    print(f"✅ All pairing data cleared! Total items deleted: {total_deleted}")
    print("\nNext steps:")
    print("1. Refresh the admin panel")
    print("2. Click 'Initialize Empty Pairings' to recreate the structure")
    print("3. Add your players and set up fresh pairings")
    print()

if __name__ == '__main__':
    main()

