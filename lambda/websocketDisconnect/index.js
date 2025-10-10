const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
    console.log('WebSocket disconnect:', JSON.stringify(event));
    
    const connectionId = event.requestContext.connectionId;
    
    try {
        await docClient.send(new DeleteCommand({
            TableName: 'icup-websocket-connections',
            Key: {
                connectionId: connectionId
            }
        }));
        
        console.log(`Connection ${connectionId} removed`);
        
        return {
            statusCode: 200,
            body: 'Disconnected'
        };
    } catch (error) {
        console.error('Error removing connection:', error);
        return {
            statusCode: 500,
            body: 'Failed to disconnect'
        };
    }
};

