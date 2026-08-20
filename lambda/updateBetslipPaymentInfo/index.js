const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const BETSLIPS_TABLE = process.env.BETSLIPS_TABLE || 'icup-betslips';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'icup2024';

exports.handler = async (event) => {
    console.log('UPDATE Payment Info request:', JSON.stringify(event));
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'PUT, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
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

        const body = JSON.parse(event.body);
        const { venmoUsername, paypalUsername } = body;

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

        // Update betslip with payment info
        const updatedBetslip = {
            ...getResult.Item,
            venmoUsername: venmoUsername || '',
            paypalUsername: paypalUsername || '',
            paymentInfoUpdatedAt: Date.now()
        };

        await docClient.send(new PutCommand({
            TableName: BETSLIPS_TABLE,
            Item: updatedBetslip
        }));

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                betslipId,
                venmoUsername: updatedBetslip.venmoUsername,
                paypalUsername: updatedBetslip.paypalUsername,
                message: 'Payment info updated successfully'
            })
        };

    } catch (error) {
        console.error('Error updating payment info:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to update payment info',
                message: error.message 
            })
        };
    }
};





