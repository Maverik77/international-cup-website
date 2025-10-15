const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const BETSLIPS_TABLE = process.env.BETSLIPS_TABLE || 'icup-betslips';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'icup2024';

exports.handler = async (event) => {
    console.log('GET Betslips request:', JSON.stringify(event));
    
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

        // Fetch all betslips
        const result = await docClient.send(new ScanCommand({
            TableName: BETSLIPS_TABLE
        }));

        const betslips = (result.Items || []).map(betslip => ({
            betslipId: betslip.betslipId,
            name: betslip.name,
            email: betslip.email,
            totalAmount: betslip.totalAmount,
            betCount: Array.isArray(betslip.bets) ? betslip.bets.length : 0,
            isPaid: betslip.isPaid,
            timestamp: betslip.timestamp,
            createdAt: betslip.createdAt,
            bets: Array.isArray(betslip.bets) ? betslip.bets : []
        }));

        // Sort by creation time (newest first)
        betslips.sort((a, b) => b.createdAt - a.createdAt);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                betslips,
                count: betslips.length
            })
        };

    } catch (error) {
        console.error('Error fetching betslips:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to fetch betslips',
                message: error.message 
            })
        };
    }
};
