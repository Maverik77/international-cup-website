const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const PLAYERS_TABLE = process.env.PLAYERS_TABLE || 'icup-players';

exports.handler = async (event) => {
    console.log('GET Players request:', JSON.stringify(event));
    
    try {
        // Fetch all players
        const result = await docClient.send(new ScanCommand({
            TableName: PLAYERS_TABLE
        }));
        
        const players = result.Items || [];
        
        // Sort by team and then by ID
        const sortedPlayers = players.sort((a, b) => {
            if (a.team !== b.team) return a.team === 'USA' ? -1 : 1;
            return a.id.localeCompare(b.id);
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
                players: sortedPlayers
            })
        };
    } catch (error) {
        console.error('Error fetching players:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Failed to fetch players' })
        };
    }
};

