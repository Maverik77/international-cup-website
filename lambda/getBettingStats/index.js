const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const BETSLIPS_TABLE = process.env.BETSLIPS_TABLE_NAME;

exports.handler = async (event) => {
    console.log('Get Betting Stats - Event:', JSON.stringify(event, null, 2));

    try {
        // Scan all betslips
        const scanParams = {
            TableName: BETSLIPS_TABLE
        };
        
        const result = await docClient.send(new ScanCommand(scanParams));
        const betslips = result.Items || [];
        
        // Calculate statistics
        let totalBets = 0;
        let totalAmount = 0;
        
        betslips.forEach(betslip => {
            if (betslip.bets && Array.isArray(betslip.bets)) {
                betslip.bets.forEach(bet => {
                    totalBets++;
                    totalAmount += bet.amount || 0;
                });
            }
        });
        
        console.log('Stats calculated:', { totalBets, totalAmount, betslipCount: betslips.length });
        
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET,OPTIONS',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            },
            body: JSON.stringify({
                totalBets,
                totalAmount,
                betslipCount: betslips.length
            })
        };
    } catch (error) {
        console.error('Error getting betting stats:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Failed to get betting stats',
                message: error.message
            })
        };
    }
};

