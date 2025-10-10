const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'icup2024';

exports.handler = async (event) => {
    console.log('Update Players request:', JSON.stringify(event));
    
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
        const { players } = body;
        
        if (!players || !Array.isArray(players)) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Invalid players data' })
            };
        }
        
        // Get existing players to determine what to delete
        const existingResult = await docClient.send(new ScanCommand({
            TableName: 'icup-players'
        }));
        
        const existingIds = new Set((existingResult.Items || []).map(p => p.id));
        const newIds = new Set(players.map(p => p.id));
        
        // Delete players that are no longer in the list
        const toDelete = [...existingIds].filter(id => !newIds.has(id));
        for (const id of toDelete) {
            await docClient.send(new DeleteCommand({
                TableName: 'icup-players',
                Key: { id }
            }));
        }
        
        // Batch write players
        const putRequests = players.map(player => ({
            PutRequest: {
                Item: player
            }
        }));
        
        // DynamoDB batch write has a limit of 25 items
        for (let i = 0; i < putRequests.length; i += 25) {
            const batch = putRequests.slice(i, i + 25);
            await docClient.send(new BatchWriteCommand({
                RequestItems: {
                    'icup-players': batch
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
            body: JSON.stringify({ 
                success: true, 
                count: players.length,
                deleted: toDelete.length
            })
        };
    } catch (error) {
        console.error('Error updating players:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Failed to update players' })
        };
    }
};

