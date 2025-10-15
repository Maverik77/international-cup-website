const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const BETSLIPS_TABLE = process.env.BETSLIPS_TABLE || 'icup-betslips';

exports.handler = async (event) => {
    console.log('GET Betslip request:', JSON.stringify(event));
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
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
        // Extract betslip ID from path
        const betslipId = event.pathParameters?.id;
        if (!betslipId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Betslip ID is required' 
                })
            };
        }

        // Get betslip from DynamoDB
        const result = await docClient.send(new GetCommand({
            TableName: BETSLIPS_TABLE,
            Key: { betslipId }
        }));

        if (!result.Item) {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ 
                    error: 'Betslip not found' 
                })
            };
        }

        // Return betslip (public view - no sensitive data)
        const betslip = {
            betslipId: result.Item.betslipId,
            name: result.Item.name,
            totalAmount: result.Item.totalAmount,
            isPaid: result.Item.isPaid,
            timestamp: result.Item.timestamp,
            bets: result.Item.bets || []
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                betslip
            })
        };

    } catch (error) {
        console.error('Error fetching betslip:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to fetch betslip',
                message: error.message 
            })
        };
    }
};

