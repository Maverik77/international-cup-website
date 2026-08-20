const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const MATCH_RESULTS_TABLE = process.env.MATCH_RESULTS_TABLE || 'icup-match-results-staging';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'icup2024';

exports.handler = async (event) => {
    console.log('GET Match Results request:', JSON.stringify(event));
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

        // Fetch all match results
        const result = await docClient.send(new ScanCommand({
            TableName: MATCH_RESULTS_TABLE
        }));

        // Convert array to object keyed by matchId
        const results = {};
        (result.Items || []).forEach(item => {
            results[item.matchId] = item.winner;
        });

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                results,
                count: Object.keys(results).length
            })
        };

    } catch (error) {
        console.error('Error fetching match results:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to fetch match results',
                message: error.message 
            })
        };
    }
};





