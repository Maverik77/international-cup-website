const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const dynamoClient = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const sesClient = new SESClient({ region: 'us-east-1' });

const BETSLIPS_TABLE = process.env.BETSLIPS_TABLE || 'icup-betslips-staging';
const MATCH_RESULTS_TABLE = process.env.MATCH_RESULTS_TABLE || 'icup-match-results-staging';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'icup2024';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@lansdowne-international-cup.com';

exports.handler = async (event) => {
    console.log('Send Betslip Results request:', JSON.stringify(event));
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
                body: JSON.stringify({ error: 'Unauthorized. Admin password required.' })
            };
        }

        const body = JSON.parse(event.body);
        const { betslipIds, resend = false } = body;

        if (!betslipIds || !Array.isArray(betslipIds) || betslipIds.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'betslipIds array is required' })
            };
        }

        // Fetch all betslips
        const betslipsResult = await docClient.send(new ScanCommand({
            TableName: BETSLIPS_TABLE
        }));
        const allBetslips = betslipsResult.Items || [];

        // Fetch match results
        const resultsResult = await docClient.send(new ScanCommand({
            TableName: MATCH_RESULTS_TABLE
        }));
        const matchResults = {};
        (resultsResult.Items || []).forEach(item => {
            matchResults[item.matchId] = item.winner;
        });

        // Calculate overall statistics
        let totalPool = 0;
        let totalWinning = 0;
        let totalTied = 0;

        allBetslips.forEach(betslip => {
            totalPool += betslip.totalAmount || 0;
            betslip.bets.forEach(bet => {
                const matchResult = matchResults[bet.matchId];
                if (matchResult === 'Tie') {
                    totalTied += bet.amount;
                } else if (bet.team === matchResult) {
                    totalWinning += bet.amount;
                }
            });
        });

        const payablePool = totalPool - totalTied;
        const multiplier = totalWinning > 0 ? payablePool / totalWinning : 0;

        // Filter betslips to send
        const betslipsToSend = allBetslips.filter(betslip => {
            if (!betslipIds.includes(betslip.betslipId)) return false;
            if (!resend && betslip.resultsEmailSent) return false;
            return true;
        });

        let sent = 0;
        let failed = 0;
        const errors = [];

        // Send emails
        for (const betslip of betslipsToSend) {
            try {
                // Calculate individual outcomes
                let wonAmount = 0;
                let lostAmount = 0;
                let tiedAmount = 0;
                let openAmount = 0;

                const betDetails = betslip.bets.map(bet => {
                    const matchResult = matchResults[bet.matchId];
                    let status = 'open';
                    let statusLabel = '⏳ Open';
                    
                    if (!matchResult) {
                        openAmount += bet.amount;
                        status = 'open';
                        statusLabel = '⏳ Open';
                    } else if (matchResult === 'Tie') {
                        tiedAmount += bet.amount;
                        status = 'tied';
                        statusLabel = '🤝 Tie (Money Returned)';
                    } else if (bet.team === matchResult) {
                        wonAmount += bet.amount;
                        status = 'won';
                        statusLabel = '✅ WON';
                    } else {
                        lostAmount += bet.amount;
                        status = 'lost';
                        statusLabel = '❌ LOST';
                    }

                    return {
                        ...bet,
                        status,
                        statusLabel,
                        matchResult
                    };
                });

                const calculatedPayout = (wonAmount * multiplier) + tiedAmount;

                // Generate email HTML
                const emailHtml = generateEmailHtml(
                    betslip,
                    betDetails,
                    {
                        wonAmount,
                        lostAmount,
                        tiedAmount,
                        openAmount,
                        totalPool,
                        payablePool,
                        totalWinning,
                        multiplier,
                        calculatedPayout
                    }
                );

                // Send email
                await sesClient.send(new SendEmailCommand({
                    Source: FROM_EMAIL,
                    Destination: {
                        ToAddresses: [betslip.email]
                    },
                    Message: {
                        Subject: {
                            Data: '🏌️ Your International Cup Betting Results'
                        },
                        Body: {
                            Html: {
                                Data: emailHtml
                            }
                        }
                    }
                }));

                // Update betslip
                await docClient.send(new PutCommand({
                    TableName: BETSLIPS_TABLE,
                    Item: {
                        ...betslip,
                        resultsEmailSent: true,
                        resultsEmailSentAt: Date.now()
                    }
                }));

                sent++;
                console.log(`Email sent to ${betslip.email}`);

            } catch (error) {
                console.error(`Failed to send email to ${betslip.email}:`, error);
                failed++;
                errors.push({ betslipId: betslip.betslipId, error: error.message });
            }
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                sent,
                failed,
                total: betslipsToSend.length,
                errors: errors.length > 0 ? errors : undefined
            })
        };

    } catch (error) {
        console.error('Error sending betslip results:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                error: 'Failed to send betslip results',
                message: error.message
            })
        };
    }
};

function generateEmailHtml(betslip, betDetails, summary) {
    const betsHtml = betDetails.map(bet => `
        <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; background: #f7fafc;">
            <div style="font-weight: 600; font-size: 1.1rem; margin-bottom: 0.5rem;">${bet.matchLabel || `Match ${bet.matchId}`}</div>
            <div style="margin-bottom: 0.25rem;">🇺🇸 <strong>USA:</strong> ${bet.usaPlayers || 'TBD'}</div>
            <div style="margin-bottom: 0.5rem;">🌍 <strong>International:</strong> ${bet.intlPlayers || 'TBD'}</div>
            <div style="margin-bottom: 0.5rem;">
                <strong>You bet on:</strong> <span style="color: #667eea; font-weight: 600;">${bet.team}</span> ($${bet.amount})
            </div>
            <div style="padding: 0.5rem; background: ${
                bet.status === 'won' ? '#c6f6d5' : 
                bet.status === 'lost' ? '#fed7d7' : 
                bet.status === 'tied' ? '#fef3c7' : '#e6fffa'
            }; color: ${
                bet.status === 'won' ? '#22543d' : 
                bet.status === 'lost' ? '#742a2a' : 
                bet.status === 'tied' ? '#78350f' : '#234e52'
            }; border-radius: 6px; font-weight: 600; text-align: center; font-size: 1.1rem;">
                ${bet.statusLabel}
            </div>
        </div>
    `).join('');

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Betting Results</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #2d3748; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2rem; border-radius: 8px 8px 0 0; text-align: center;">
        <h1 style="margin: 0; font-size: 1.75rem;">🏌️ International Cup</h1>
        <p style="margin: 0.5rem 0 0 0; font-size: 1.1rem;">Your Betting Results</p>
    </div>

    <div style="background: white; padding: 2rem; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="font-size: 1.1rem; margin-bottom: 1rem;">Dear <strong>${betslip.name}</strong>,</p>
        
        <p>Your betting results for the International Cup are ready!</p>
        
        <div style="background: #f7fafc; padding: 1rem; border-radius: 6px; margin: 1.5rem 0;">
            <strong>Betslip ID:</strong> <span style="font-family: monospace; color: #667eea;">${betslip.betslipId}</span>
        </div>

        <h2 style="border-bottom: 3px solid #667eea; padding-bottom: 0.5rem; margin-top: 2rem;">Your Bets</h2>
        ${betsHtml}

        <h2 style="border-bottom: 3px solid #667eea; padding-bottom: 0.5rem; margin-top: 2rem;">Payout Calculation</h2>
        
        <table style="width: 100%; border-collapse: collapse; margin: 1rem 0;">
            <tr style="background: #f7fafc;">
                <td style="padding: 0.75rem; border: 1px solid #e2e8f0;">Total Amount Wagered</td>
                <td style="padding: 0.75rem; border: 1px solid #e2e8f0; text-align: right; font-weight: 600;">$${betslip.totalAmount.toFixed(2)}</td>
            </tr>
            <tr>
                <td style="padding: 0.75rem; border: 1px solid #e2e8f0; color: #48bb78;">Winning Bets</td>
                <td style="padding: 0.75rem; border: 1px solid #e2e8f0; text-align: right; font-weight: 600; color: #48bb78;">$${summary.wonAmount.toFixed(2)}</td>
            </tr>
            <tr style="background: #f7fafc;">
                <td style="padding: 0.75rem; border: 1px solid #e2e8f0; color: #e53e3e;">Lost Bets</td>
                <td style="padding: 0.75rem; border: 1px solid #e2e8f0; text-align: right; font-weight: 600; color: #e53e3e;">$${summary.lostAmount.toFixed(2)}</td>
            </tr>
            <tr>
                <td style="padding: 0.75rem; border: 1px solid #e2e8f0; color: #f59e0b;">Tied Bets (Returned)</td>
                <td style="padding: 0.75rem; border: 1px solid #e2e8f0; text-align: right; font-weight: 600; color: #f59e0b;">$${summary.tiedAmount.toFixed(2)}</td>
            </tr>
            ${summary.openAmount > 0 ? `
            <tr style="background: #f7fafc;">
                <td style="padding: 0.75rem; border: 1px solid #e2e8f0; color: #667eea;">Open Bets</td>
                <td style="padding: 0.75rem; border: 1px solid #e2e8f0; text-align: right; font-weight: 600; color: #667eea;">$${summary.openAmount.toFixed(2)}</td>
            </tr>
            ` : ''}
        </table>

        <div style="background: #f7fafc; padding: 1.5rem; border-radius: 8px; margin: 1.5rem 0;">
            <h3 style="margin: 0 0 1rem 0; font-size: 1rem; color: #4a5568;">Pool Statistics</h3>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 0.5rem 0;">Total Betting Pool:</td>
                    <td style="padding: 0.5rem 0; text-align: right; font-weight: 600;">$${summary.totalPool.toFixed(2)}</td>
                </tr>
                <tr>
                    <td style="padding: 0.5rem 0;">Pool After Ties:</td>
                    <td style="padding: 0.5rem 0; text-align: right; font-weight: 600;">$${summary.payablePool.toFixed(2)}</td>
                </tr>
                <tr>
                    <td style="padding: 0.5rem 0;">Total Winning Bets:</td>
                    <td style="padding: 0.5rem 0; text-align: right; font-weight: 600;">$${summary.totalWinning.toFixed(2)}</td>
                </tr>
                <tr style="border-top: 2px solid #667eea;">
                    <td style="padding: 0.75rem 0; font-weight: 600; color: #667eea;">Payout Multiplier:</td>
                    <td style="padding: 0.75rem 0; text-align: right; font-weight: 700; color: #667eea; font-size: 1.2rem;">${summary.multiplier.toFixed(3)}x</td>
                </tr>
            </table>
        </div>

        <div style="background: #667eea; color: white; padding: 1rem; border-radius: 8px; margin: 1.5rem 0; text-align: center;">
            <div style="font-size: 0.9rem; opacity: 0.9; margin-bottom: 0.25rem;">Your Payout Calculation</div>
            <div style="font-size: 1rem; margin-bottom: 0.5rem;">
                ($${summary.wonAmount.toFixed(2)} × ${summary.multiplier.toFixed(3)}) + $${summary.tiedAmount.toFixed(2)} = <strong>$${summary.calculatedPayout.toFixed(2)}</strong>
            </div>
        </div>

        <div style="background: linear-gradient(135deg, #48bb78 0%, #38a169 100%); color: white; padding: 2rem; border-radius: 8px; text-align: center; margin: 2rem 0;">
            <div style="font-size: 1rem; opacity: 0.9; margin-bottom: 0.5rem;">FINAL PAYOUT</div>
            <div style="font-size: 2.5rem; font-weight: 700; margin-bottom: 0.5rem;">$${summary.calculatedPayout.toFixed(2)}</div>
            <div style="font-size: 0.9rem; opacity: 0.9;">
                Payment Status: ${betslip.isPaidOut ? '✅ Paid Out' : '⏳ Pending'}
            </div>
        </div>

        ${summary.openAmount > 0 ? `
        <div style="background: #fff3cd; border-left: 4px solid #f59e0b; padding: 1rem; margin: 1rem 0; border-radius: 4px;">
            <strong>Note:</strong> Some matches are still open. Your final payout may change once all results are in.
        </div>
        ` : ''}

        <p style="margin-top: 2rem; color: #4a5568; font-size: 0.9rem;">
            Thank you for participating in the International Cup betting!
        </p>
    </div>

    <div style="text-align: center; padding: 1rem; color: #718096; font-size: 0.85rem;">
        <p>This is an automated message from Lansdowne International Cup</p>
    </div>
</body>
</html>
    `;
}





