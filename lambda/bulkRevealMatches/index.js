const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const PAIRINGS_TABLE = process.env.PAIRINGS_TABLE || 'icup-pairings';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'icup2024';

exports.handler = async (event) => {
    console.log('Bulk Reveal Matches request:', JSON.stringify(event));
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    try {
        // Check admin authentication
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${ADMIN_PASSWORD}`) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ 
                    error: 'Unauthorized. Admin password required.' 
                })
            };
        }

        const body = JSON.parse(event.body);
        const { day } = body; // 1 or 2

        if (!day || ![1, 2].includes(day)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Day must be 1 or 2' 
                })
            };
        }

        // Get all pairings for the specified day
        const scanResult = await docClient.send(new ScanCommand({
            TableName: PAIRINGS_TABLE
        }));

        const dayPairings = (scanResult.Items || []).filter(p => Number(p.day) === day);

        // Update each pairing to be revealed
        const updatePromises = dayPairings.map(pairing => {
            const updatedPairing = {
                ...pairing,
                revealed: true,
                revealedAt: new Date().toISOString()
            };

            return docClient.send(new PutCommand({
                TableName: PAIRINGS_TABLE,
                Item: updatedPairing
            }));
        });

        await Promise.all(updatePromises);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                message: `Successfully revealed all Day ${day} matches`,
                count: dayPairings.length
            })
        };

    } catch (error) {
        console.error('Error bulk revealing matches:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to bulk reveal matches',
                message: error.message 
            })
        };
    }
};

