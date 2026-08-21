const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const BETSLIPS_TABLE = process.env.BETSLIPS_TABLE || 'icup-betslips-staging';
const MATCH_RESULTS_TABLE = process.env.MATCH_RESULTS_TABLE || 'icup-match-results-staging';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
    throw new Error('ADMIN_PASSWORD environment variable is required');
}

exports.handler = async (event) => {
    console.log('Calculate Payouts request:', JSON.stringify(event));
    
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
        const betslipsResult = await docClient.send(new ScanCommand({
            TableName: BETSLIPS_TABLE
        }));
        const betslips = betslipsResult.Items || [];

        // Fetch all match results
        const resultsResult = await docClient.send(new ScanCommand({
            TableName: MATCH_RESULTS_TABLE
        }));
        const matchResults = {};
        (resultsResult.Items || []).forEach(item => {
            matchResults[item.matchId] = item.winner;
        });

        // Calculate outcomes for each betslip
        let totalPool = 0;
        let totalWinning = 0;
        let totalTied = 0;

        const payouts = betslips.map(betslip => {
            let wonAmount = 0;
            let lostAmount = 0;
            let tiedAmount = 0;
            let openAmount = 0;

            betslip.bets.forEach(bet => {
                const matchResult = matchResults[bet.matchId];
                
                if (!matchResult) {
                    // Match not decided yet
                    openAmount += bet.amount;
                } else if (matchResult === 'Tie') {
                    // Tie - get money back
                    tiedAmount += bet.amount;
                } else if (bet.team === matchResult) {
                    // Won
                    wonAmount += bet.amount;
                } else {
                    // Lost
                    lostAmount += bet.amount;
                }
            });

            totalPool += betslip.totalAmount;
            totalWinning += wonAmount;
            totalTied += tiedAmount;

            return {
                betslipId: betslip.betslipId,
                name: betslip.name,
                email: betslip.email,
                totalBetAmount: betslip.totalAmount,
                wonAmount,
                lostAmount,
                tiedAmount,
                openAmount,
                isPaid: betslip.isPaid || false,  // Has bettor paid their entry
                isPaidOut: betslip.isPaidOut || false,  // Has bettor been paid their winnings
                resultsEmailSent: betslip.resultsEmailSent || false,  // Has results email been sent
                resultsEmailSentAt: betslip.resultsEmailSentAt || null,  // When results email was sent
                venmoUsername: betslip.venmoUsername || '',  // Venmo username for payment
                paypalUsername: betslip.paypalUsername || '',  // PayPal username for payment
                calculatedPayout: 0 // Will be calculated after multiplier
            };
        });

        // Calculate payout multiplier
        // multiplier = (total_pool - tied_amount) / winning_bets_total
        const payablePool = totalPool - totalTied;
        const multiplier = totalWinning > 0 ? payablePool / totalWinning : 0;

        // Calculate individual payouts
        // individual_payout = won_bet_amount * multiplier + tied_bet_amount
        payouts.forEach(payout => {
            payout.calculatedPayout = (payout.wonAmount * multiplier) + payout.tiedAmount;
        });

        // Sort by payout amount (highest first)
        payouts.sort((a, b) => b.calculatedPayout - a.calculatedPayout);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                payouts,
                summary: {
                    totalPool,
                    totalWinning,
                    totalTied,
                    payablePool,
                    multiplier: multiplier || 0,
                    totalBetslips: betslips.length
                }
            })
        };

    } catch (error) {
        console.error('Error calculating payouts:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to calculate payouts',
                message: error.message 
            })
        };
    }
};

