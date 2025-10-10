const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
    console.log('GET Pairings request:', JSON.stringify(event));
    
    try {
        // Fetch all pairings
        const pairingsResult = await docClient.send(new ScanCommand({
            TableName: 'icup-pairings'
        }));
        
        // Fetch reveal state
        const revealStateResult = await docClient.send(new GetCommand({
            TableName: 'icup-reveal-state',
            Key: { id: 'current' }
        }));
        
        const pairings = pairingsResult.Items || [];
        const revealState = revealStateResult.Item || {
            id: 'current',
            currentRevealIndex: -1,
            revealedIds: []
        };
        
        // Sort pairings
        const sortedPairings = pairings.sort((a, b) => {
            if (a.day !== b.day) return a.day - b.day;
            if (a.type !== b.type) return a.type === 'team' ? -1 : 1;
            return a.match_number - b.match_number;
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
                pairings: sortedPairings,
                revealState: revealState
            })
        };
    } catch (error) {
        console.error('Error fetching pairings:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Failed to fetch pairings' })
        };
    }
};

