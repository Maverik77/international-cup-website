const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const sesClient = new SESClient({ region: 'us-east-1' });

const SENDER_EMAIL = process.env.SENDER_EMAIL || 'noreply@lansdowne-international-cup.com';
const WEBSITE_URL = process.env.WEBSITE_URL || 'https://staging.lansdowne-international-cup.com';

exports.handler = async (event) => {
    console.log('Send Betslip Confirmation request:', JSON.stringify(event));

    try {
        // Parse the betslip data from the event
        const { betslipId, name, email, totalAmount, bets } = JSON.parse(event.body || '{}');

        if (!betslipId || !email || !name) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing required fields' })
            };
        }

        // Build the bets list for the email
        const betsListHtml = bets.map(bet => `
            <tr>
                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0;">
                    <strong>${bet.matchLabel || 'Match'}</strong><br>
                    <span style="color: #667eea;">Betting on: ${bet.team}</span><br>
                    <small style="color: #718096;">
                        🇺🇸 ${bet.usaPlayers || 'TBD'} vs 🌍 ${bet.intlPlayers || 'TBD'}
                    </small>
                </td>
                <td style="padding: 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">
                    <strong style="color: #667eea; font-size: 18px;">$${bet.amount}</strong>
                </td>
            </tr>
        `).join('');

        const lookupUrl = `${WEBSITE_URL}/betting/lookup.html?id=${betslipId}`;

        const emailParams = {
            Source: SENDER_EMAIL,
            Destination: {
                ToAddresses: [email]
            },
            Message: {
                Subject: {
                    Data: `🎫 Bet Slip Confirmation - ${betslipId}`,
                    Charset: 'UTF-8'
                },
                Body: {
                    Html: {
                        Data: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f7fafc;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f7fafc; padding: 20px 0;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); overflow: hidden;">
                    
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">
                                🏆 International Cup 2025
                            </h1>
                            <p style="margin: 10px 0 0 0; color: #e6f0ff; font-size: 16px;">
                                Bet Slip Confirmation
                            </p>
                        </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                        <td style="padding: 40px 30px;">
                            <p style="margin: 0 0 20px 0; color: #2d3748; font-size: 16px;">
                                Hi <strong>${name}</strong>,
                            </p>
                            <p style="margin: 0 0 30px 0; color: #4a5568; font-size: 16px; line-height: 1.6;">
                                Your bets have been successfully submitted! Here are the details of your bet slip:
                            </p>

                            <!-- Bet Slip Info -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f7fafc; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                <tr>
                                    <td>
                                        <p style="margin: 0 0 10px 0; color: #718096; font-size: 14px;">
                                            <strong>Bet Slip ID:</strong>
                                        </p>
                                        <p style="margin: 0 0 20px 0; color: #2d3748; font-size: 18px; font-family: monospace; font-weight: 600;">
                                            ${betslipId}
                                        </p>
                                        <p style="margin: 0; color: #718096; font-size: 14px;">
                                            <strong>Total Amount:</strong> 
                                            <span style="color: #667eea; font-size: 24px; font-weight: 700; margin-left: 10px;">$${totalAmount}</span>
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <!-- Bets Table -->
                            <h2 style="margin: 0 0 20px 0; color: #2d3748; font-size: 20px; font-weight: 700;">
                                Your Bets (${bets.length})
                            </h2>
                            <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 30px;">
                                ${betsListHtml}
                            </table>

                            <!-- CTA Button -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 30px;">
                                <tr>
                                    <td align="center" style="padding: 20px 0;">
                                        <a href="${lookupUrl}" style="display: inline-block; background-color: #667eea; color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);">
                                            View Your Bet Slip
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <!-- Next Steps -->
                            <div style="background-color: #fff5e6; border-left: 4px solid #f59e0b; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                                <h3 style="margin: 0 0 10px 0; color: #92400e; font-size: 16px; font-weight: 700;">
                                    ⚠️ Important - Complete Your Payment
                                </h3>
                                <p style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.6;">
                                    Please complete your payment via Venmo or PayPal and include your Bet Slip ID (<strong>${betslipId}</strong>) in the payment note.
                                </p>
                            </div>

                            <p style="margin: 0 0 10px 0; color: #4a5568; font-size: 14px; line-height: 1.6;">
                                You can view your bet slip anytime by visiting the link above or entering your Bet Slip ID at:
                            </p>
                            <p style="margin: 0 0 20px 0;">
                                <a href="${WEBSITE_URL}/betting/lookup.html" style="color: #667eea; text-decoration: underline; font-size: 14px;">
                                    ${WEBSITE_URL}/betting/lookup.html
                                </a>
                            </p>

                            <p style="margin: 0; color: #718096; font-size: 14px; line-height: 1.6;">
                                Good luck with your bets! 🍀
                            </p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f7fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                            <p style="margin: 0 0 10px 0; color: #718096; font-size: 12px;">
                                International Cup 2025 - Lansdowne Resort
                            </p>
                            <p style="margin: 0; color: #a0aec0; font-size: 12px;">
                                This is an automated confirmation email. Please do not reply to this email.
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
                        `,
                        Charset: 'UTF-8'
                    },
                    Text: {
                        Data: `
International Cup 2025 - Bet Slip Confirmation

Hi ${name},

Your bets have been successfully submitted!

Bet Slip ID: ${betslipId}
Total Amount: $${totalAmount}

Your Bets (${bets.length}):
${bets.map(bet => `
- ${bet.matchLabel || 'Match'}
  Betting on: ${bet.team}
  Amount: $${bet.amount}
  USA: ${bet.usaPlayers || 'TBD'} vs International: ${bet.intlPlayers || 'TBD'}
`).join('\n')}

IMPORTANT: Please complete your payment via Venmo or PayPal and include your Bet Slip ID (${betslipId}) in the payment note.

View your bet slip online:
${lookupUrl}

Or visit: ${WEBSITE_URL}/betting/lookup.html and enter your Bet Slip ID.

Good luck with your bets!

---
International Cup 2025 - Lansdowne Resort
This is an automated confirmation email.
                        `,
                        Charset: 'UTF-8'
                    }
                }
            }
        };

        const command = new SendEmailCommand(emailParams);
        await sesClient.send(command);

        console.log(`Confirmation email sent to ${email} for betslip ${betslipId}`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Confirmation email sent successfully'
            })
        };

    } catch (error) {
        console.error('Error sending confirmation email:', error);
        
        // Don't fail the betslip creation if email fails
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Failed to send confirmation email',
                message: error.message
            })
        };
    }
};

