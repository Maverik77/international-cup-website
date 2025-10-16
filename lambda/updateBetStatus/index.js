const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const BETSLIPS_TABLE = process.env.BETSLIPS_TABLE || 'icup-betslips';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'icup2024';

exports.handler = async (event) => {
    console.log('UPDATE Bet Status request:', JSON.stringify(event));
    
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

        // Extract betslip ID and bet index from path
        const betslipId = event.pathParameters?.id;
        const betIndex = parseInt(event.pathParameters?.betIndex);
        
        if (!betslipId || isNaN(betIndex)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Betslip ID and bet index are required' 
                })
            };
        }

        const body = JSON.parse(event.body);
        const { status } = body;

        if (!['open', 'won', 'lost'].includes(status)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Status must be one of: open, won, lost' 
                })
            };
        }

        // Get existing betslip
        const getResult = await docClient.send(new GetCommand({
            TableName: BETSLIPS_TABLE,
            Key: { betslipId }
        }));

        if (!getResult.Item) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    error: 'Betslip not found' 
                })
            };
        }

        // Update specific bet status
        const betslip = getResult.Item;
        if (!betslip.bets || betIndex < 0 || betIndex >= betslip.bets.length) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Invalid bet index' 
                })
            };
        }

        betslip.bets[betIndex].status = status;
        betslip.updatedAt = Date.now();

        // Save updated betslip
        await docClient.send(new PutCommand({
            TableName: BETSLIPS_TABLE,
            Item: betslip
        }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                betslipId,
                betIndex,
                status,
                message: 'Bet status updated successfully'
            })
        };

    } catch (error) {
        console.error('Error updating bet status:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to update bet status',
                message: error.message 
            })
        };
    }
};

