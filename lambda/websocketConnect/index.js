const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const WEBSOCKET_TABLE = process.env.WEBSOCKET_TABLE || 'icup-websocket-connections';

exports.handler = async (event) => {
    console.log('WebSocket connect:', JSON.stringify(event));
    
    const connectionId = event.requestContext.connectionId;
    
    try {
        await docClient.send(new PutCommand({
            TableName: WEBSOCKET_TABLE,
            Item: {
                connectionId: connectionId,
                connectedAt: new Date().toISOString()
            }
        }));
        
        console.log(`Connection ${connectionId} registered`);
        
        return {
            statusCode: 200,
            body: 'Connected'
        };
    } catch (error) {
        console.error('Error registering connection:', error);
        return {
            statusCode: 500,
            body: 'Failed to connect'
        };
    }
};

