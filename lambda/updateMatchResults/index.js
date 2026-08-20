const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const MATCH_RESULTS_TABLE = process.env.MATCH_RESULTS_TABLE || 'icup-match-results-staging';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'icup2024';

exports.handler = async (event) => {
    console.log('UPDATE Match Results request:', JSON.stringify(event));
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'PUT, OPTIONS',
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
        const { results } = body;

        if (!results || typeof results !== 'object') {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Invalid request. Expected results object.' 
                })
            };
        }

        // Validate winner values
        const validWinners = ['USA', 'International', 'Tie'];
        for (const [matchId, winner] of Object.entries(results)) {
            if (!validWinners.includes(winner)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        error: `Invalid winner value for match ${matchId}: ${winner}. Must be one of: ${validWinners.join(', ')}` 
                    })
                };
            }
        }

        // Store results in DynamoDB
        const timestamp = Date.now();
        const putPromises = Object.entries(results).map(([matchId, winner]) => {
            return docClient.send(new PutCommand({
                TableName: MATCH_RESULTS_TABLE,
                Item: {
                    matchId,
                    winner,
                    timestamp,
                    updatedAt: new Date().toISOString()
                }
            }));
        });

        await Promise.all(putPromises);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                message: 'Match results updated successfully',
                count: Object.keys(results).length
            })
        };

    } catch (error) {
        console.error('Error updating match results:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to update match results',
                message: error.message 
            })
        };
    }
};





