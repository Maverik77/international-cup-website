const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'icup2024';
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT;

exports.handler = async (event) => {
    console.log('Reveal Pairing request:', JSON.stringify(event));
    
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
        const action = body.action; // 'reveal' or 'reset'
        const pairingId = body.pairingId;
        const step = body.step; // 1 or 2
        
        // Reset action
        if (action === 'reset') {
            // Get all pairings and reset their reveal steps
            const pairingsResult = await docClient.send(new ScanCommand({
                TableName: 'icup-pairings'
            }));
            
            const pairings = pairingsResult.Items || [];
            
            // Reset reveal step for all pairings
            for (const pairing of pairings) {
                pairing.revealStep = 0;
                await docClient.send(new PutCommand({
                    TableName: 'icup-pairings',
                    Item: pairing
                }));
            }
            
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
        
        // Reveal action
        if (action === 'reveal' && pairingId && step) {
            // Get the specific pairing
            const pairingResult = await docClient.send(new GetCommand({
                TableName: 'icup-pairings',
                Key: { id: pairingId }
            }));
            
            const pairing = pairingResult.Item;
            
            if (!pairing) {
                return {
                    statusCode: 404,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                    body: JSON.stringify({ error: 'Pairing not found' })
                };
            }
            
            // Update reveal step
            pairing.revealStep = step;
            
            await docClient.send(new PutCommand({
                TableName: 'icup-pairings',
                Item: pairing
            }));
            
            // Determine which side to show based on step and reveal order
            let side;
            if (step === 1) {
                // First reveal - show the side specified by revealOrder
                side = pairing.revealOrder === 'usa-first' ? 'usa' : 'intl';
            } else if (step === 2) {
                // Second reveal - show the opposite side
                side = pairing.revealOrder === 'usa-first' ? 'intl' : 'usa';
            }
            
            // Broadcast to all connected clients
            await broadcastToClients({
                type: 'reveal',
                pairingId: pairing.id,
                step: step,
                side: side,
                pairing: pairing
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
                    pairing: pairing,
                    step: step,
                    side: side
                })
            };
        }
        
        return {
            statusCode: 400,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Invalid request - missing action, pairingId, or step' })
        };
        
    } catch (error) {
        console.error('Error revealing pairing:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Failed to reveal pairing' })
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
