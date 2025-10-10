const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'icup2024';
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;

exports.handler = async (event) => {
    console.log('Reveal Next request:', JSON.stringify(event));
    
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
        
        const body = JSON.parse(event.body || '{}');
        const action = body.action || 'next'; // 'next' or 'reset'
        
        if (action === 'reset') {
            // Reset reveal state
            await docClient.send(new PutCommand({
                TableName: 'icup-reveal-state',
                Item: {
                    id: 'current',
                    currentRevealIndex: -1,
                    revealedIds: [],
                    lastUpdated: new Date().toISOString()
                }
            }));
            
            // Broadcast reset to all connected clients
            await broadcastToClients({ type: 'reset' });
            
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Password',
                    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
                },
                body: JSON.stringify({ success: true, action: 'reset' })
            };
        }
        
        // Get all pairings
        const pairingsResult = await docClient.send(new ScanCommand({
            TableName: 'icup-pairings'
        }));
        
        const pairings = (pairingsResult.Items || []).sort((a, b) => {
            if (a.day !== b.day) return a.day - b.day;
            if (a.type !== b.type) return a.type === 'team' ? -1 : 1;
            return a.match_number - b.match_number;
        });
        
        // Get current reveal state
        const revealStateResult = await docClient.send(new GetCommand({
            TableName: 'icup-reveal-state',
            Key: { id: 'current' }
        }));
        
        const revealState = revealStateResult.Item || {
            id: 'current',
            currentRevealIndex: -1,
            revealedIds: []
        };
        
        const nextIndex = revealState.currentRevealIndex + 1;
        
        if (nextIndex >= pairings.length) {
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ 
                    success: true, 
                    complete: true,
                    message: 'All pairings revealed' 
                })
            };
        }
        
        const nextPairing = pairings[nextIndex];
        revealState.currentRevealIndex = nextIndex;
        revealState.revealedIds.push(nextPairing.id);
        revealState.lastUpdated = new Date().toISOString();
        
        // Update reveal state
        await docClient.send(new PutCommand({
            TableName: 'icup-reveal-state',
            Item: revealState
        }));
        
        // Broadcast to all connected clients
        await broadcastToClients({
            type: 'reveal',
            pairing: nextPairing,
            revealIndex: nextIndex
        });
        
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
                pairing: nextPairing,
                revealIndex: nextIndex,
                totalPairings: pairings.length
            })
        };
    } catch (error) {
        console.error('Error revealing next pairing:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Failed to reveal next pairing' })
        };
    }
};

async function broadcastToClients(message) {
    if (!WEBSOCKET_ENDPOINT) {
        console.log('WebSocket endpoint not configured, skipping broadcast');
        return;
    }
    
    try {
        // Get all connections
        const connectionsResult = await docClient.send(new ScanCommand({
            TableName: 'icup-websocket-connections'
        }));
        
        const connections = connectionsResult.Items || [];
        
        const apiGatewayClient = new ApiGatewayManagementApiClient({
            endpoint: WEBSOCKET_ENDPOINT,
            region: 'us-east-1'
        });
        
        const postToConnections = connections.map(async ({ connectionId }) => {
            try {
                await apiGatewayClient.send(new PostToConnectionCommand({
                    ConnectionId: connectionId,
                    Data: JSON.stringify(message)
                }));
            } catch (error) {
                console.error(`Failed to post to connection ${connectionId}:`, error);
                // If connection is stale, we could delete it here
            }
        });
        
        await Promise.all(postToConnections);
        console.log(`Broadcast to ${connections.length} connections`);
    } catch (error) {
        console.error('Error broadcasting to clients:', error);
    }
}

