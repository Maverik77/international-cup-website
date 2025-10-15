const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const dynamoClient = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({ region: 'us-east-1' });

const BETSLIPS_TABLE = process.env.BETSLIPS_TABLE || 'icup-betslips';
const EMAIL_FUNCTION_NAME = process.env.EMAIL_FUNCTION_NAME;

exports.handler = async (event) => {
    console.log('CREATE Betslip request:', JSON.stringify(event));
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
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
        const body = JSON.parse(event.body);
        const { name, email, bets } = body;

        // Validate required fields
        if (!name || !email || !bets || !Array.isArray(bets) || bets.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Missing required fields: name, email, and bets array' 
                })
            };
        }

        // Validate bets
        for (const bet of bets) {
            if (!bet.matchId || !bet.team || !bet.amount || ![10, 20].includes(bet.amount)) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        error: 'Invalid bet data. Each bet must have matchId, team, and amount (10 or 20)' 
                    })
                };
            }
        }

        // Generate unique betslip ID
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 9000) + 1000; // 4-digit random number
        const betslipId = `ICUP-${timestamp}-${random}`;

        // Calculate total amount
        const totalAmount = bets.reduce((sum, bet) => sum + bet.amount, 0);

        // Create betslip object
        const betslip = {
            betslipId,
            name: name.trim(),
            email: email.trim().toLowerCase(),
            bets: bets.map(b => ({
                matchId: b.matchId,
                team: b.team,
                amount: b.amount,
                matchLabel: b.matchLabel,
                usaPlayers: b.usaPlayers,
                intlPlayers: b.intlPlayers,
                status: 'open'  // Default status: open, won, lost
            })),
            totalAmount,
            isPaid: false,
            timestamp: new Date().toISOString(),
            createdAt: timestamp
        };

        // Store in DynamoDB
        await docClient.send(new PutCommand({
            TableName: BETSLIPS_TABLE,
            Item: betslip
        }));

        // Send confirmation email (async, don't wait for it)
        if (EMAIL_FUNCTION_NAME) {
            try {
                const emailPayload = {
                    betslipId,
                    name: betslip.name,
                    email: betslip.email,
                    totalAmount,
                    bets: betslip.bets
                };

                await lambdaClient.send(new InvokeCommand({
                    FunctionName: EMAIL_FUNCTION_NAME,
                    InvocationType: 'Event', // Async invocation
                    Payload: JSON.stringify({ body: JSON.stringify(emailPayload) })
                }));

                console.log('Confirmation email triggered for', betslipId);
            } catch (emailError) {
                // Log but don't fail the betslip creation
                console.error('Failed to trigger confirmation email:', emailError);
            }
        }

        // Generate payment URLs
        // Venmo: Use app deep link that works on both mobile and web
        const venmoUrl = `venmo://paycharge?txn=pay&recipients=erikwagner77&amount=${totalAmount}&note=BetSlip-${betslipId}`;
        // PayPal: Use paypalme which auto-redirects to app on mobile
        const paypalUrl = `https://www.paypal.com/paypalme/erikwagner77/${totalAmount}`;

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                betslipId,
                totalAmount,
                paymentUrls: {
                    venmo: venmoUrl,
                    paypal: paypalUrl
                },
                message: 'Betslip created successfully'
            })
        };

    } catch (error) {
        console.error('Error creating betslip:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to create betslip',
                message: error.message 
            })
        };
    }
};
