const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const BETTING_CONFIG_TABLE = process.env.BETTING_CONFIG_TABLE || 'icup-betting-config';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'icup2024';

exports.handler = async (event) => {
    console.log('Set Betting Cutoff request:', JSON.stringify(event));
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
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
        // GET - Check betting status (public)
        if (event.httpMethod === 'GET') {
            const result = await docClient.send(new GetCommand({
                TableName: BETTING_CONFIG_TABLE,
                Key: { configId: 'betting-cutoff' }
            }));

            const config = result.Item || {
                day1Closed: false,
                day2Closed: false
            };

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify(config)
            };
        }

        // POST - Set betting cutoff (admin only)
        if (event.httpMethod === 'POST') {
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
            const { day, closed } = body; // day: 1 or 2, closed: true/false

            if (!day || ![1, 2].includes(day) || typeof closed !== 'boolean') {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        error: 'Invalid parameters. Day must be 1 or 2, closed must be boolean' 
                    })
                };
            }

            // Get current config
            const getResult = await docClient.send(new GetCommand({
                TableName: BETTING_CONFIG_TABLE,
                Key: { configId: 'betting-cutoff' }
            }));

            const config = getResult.Item || {
                configId: 'betting-cutoff',
                day1Closed: false,
                day2Closed: false
            };

            // Update the specific day
            if (day === 1) {
                config.day1Closed = closed;
                config.day1ClosedAt = closed ? new Date().toISOString() : null;
            } else {
                config.day2Closed = closed;
                config.day2ClosedAt = closed ? new Date().toISOString() : null;
            }

            // Save config
            await docClient.send(new PutCommand({
                TableName: BETTING_CONFIG_TABLE,
                Item: config
            }));

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({
                    message: `Day ${day} betting ${closed ? 'closed' : 'opened'}`,
                    config
                })
            };
        }

        return {
            statusCode: 405,
            headers,
            body: JSON.stringify({ error: 'Method not allowed' })
        };

    } catch (error) {
        console.error('Error managing betting cutoff:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to manage betting cutoff',
                message: error.message 
            })
        };
    }
};

