const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'icup2024';

exports.handler = async (event) => {
    console.log('Update Pairings request:', JSON.stringify(event));
    
    try {
        // Check password
        const password = event.headers['x-admin-password'] || event.headers['X-Admin-Password'];
        if (password !== ADMIN_PASSWORD) {
            return {
                statusCode: 401,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Password',
                    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
                },
                body: JSON.stringify({ error: 'Unauthorized' })
            };
        }
        
        const body = JSON.parse(event.body);
        const { pairings } = body;
        
        if (!pairings || !Array.isArray(pairings)) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Invalid pairings data' })
            };
        }
        
        // Batch write pairings
        const putRequests = pairings.map(pairing => ({
            PutRequest: {
                Item: pairing
            }
        }));
        
        // DynamoDB batch write has a limit of 25 items
        for (let i = 0; i < putRequests.length; i += 25) {
            const batch = putRequests.slice(i, i + 25);
            await docClient.send(new BatchWriteCommand({
                RequestItems: {
                    'icup-pairings': batch
                }
            }));
        }
        
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Password',
                'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
            },
            body: JSON.stringify({ success: true, count: pairings.length })
        };
    } catch (error) {
        console.error('Error updating pairings:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Failed to update pairings' })
        };
    }
};

