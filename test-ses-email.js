// Test AWS SES Email Sending
// Run with: node test-ses-email.js

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { fromIni } = require('@aws-sdk/credential-providers');

// Configuration
const SENDER_EMAIL = 'noreply@lansdowne-international-cup.com';
const RECIPIENT_EMAIL = 'erikwagner77@gmail.com';
const AWS_REGION = 'us-east-1';
const AWS_PROFILE = 'icup_website_user';

// Create SES client with profile
const sesClient = new SESClient({ 
    region: AWS_REGION,
    credentials: fromIni({ profile: AWS_PROFILE })
});

async function testSendEmail() {
    console.log('🧪 Testing AWS SES Email Sending');
    console.log('=================================');
    console.log(`From: ${SENDER_EMAIL}`);
    console.log(`To: ${RECIPIENT_EMAIL}`);
    console.log(`Region: ${AWS_REGION}`);
    console.log('');

    const emailParams = {
        Source: SENDER_EMAIL,
        Destination: {
            ToAddresses: [RECIPIENT_EMAIL]
        },
        Message: {
            Subject: {
                Data: '🧪 Test Email - International Cup Betting System',
                Charset: 'UTF-8'
            },
            Body: {
                Html: {
                    Data: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
</head>
<body style="font-family: Arial, sans-serif; padding: 20px; background-color: #f7fafc;">
    <div style="max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <h1 style="color: #667eea; margin-top: 0;">🧪 Test Email</h1>
        <p style="color: #2d3748; font-size: 16px;">This is a test email from the International Cup betting system.</p>
        <p style="color: #4a5568; font-size: 14px;">
            If you're seeing this email, AWS SES is working correctly!
        </p>
        <div style="background-color: #f7fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0; color: #718096; font-size: 14px;"><strong>Sender:</strong> ${SENDER_EMAIL}</p>
            <p style="margin: 10px 0 0 0; color: #718096; font-size: 14px;"><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        </div>
        <p style="color: #a0aec0; font-size: 12px; margin-top: 30px;">
            This is an automated test email.
        </p>
    </div>
</body>
</html>
                    `,
                    Charset: 'UTF-8'
                },
                Text: {
                    Data: `
Test Email - International Cup Betting System

This is a test email from the International Cup betting system.

If you're seeing this email, AWS SES is working correctly!

Sender: ${SENDER_EMAIL}
Time: ${new Date().toLocaleString()}

This is an automated test email.
                    `,
                    Charset: 'UTF-8'
                }
            }
        }
    };

    try {
        console.log('📤 Sending test email...');
        const command = new SendEmailCommand(emailParams);
        const response = await sesClient.send(command);
        
        console.log('');
        console.log('✅ SUCCESS! Email sent successfully!');
        console.log('');
        console.log('📋 Response Details:');
        console.log(`   Message ID: ${response.MessageId}`);
        console.log('');
        console.log('📬 Next Steps:');
        console.log('   1. Check your inbox: erikwagner77@gmail.com');
        console.log('   2. Check your spam/junk folder if not in inbox');
        console.log('   3. It may take a few seconds to arrive');
        console.log('');
        
    } catch (error) {
        console.error('');
        console.error('❌ ERROR: Failed to send email');
        console.error('');
        console.error('Error Details:');
        console.error(`   Code: ${error.name}`);
        console.error(`   Message: ${error.message}`);
        console.error('');
        
        if (error.name === 'MessageRejected') {
            console.error('📧 Possible Issues:');
            console.error('   1. Sender email not verified in SES');
            console.error('   2. Check sender email capitalization (should be lowercase)');
            console.error('');
            console.error('   Run this to verify sender email:');
            console.error(`   aws ses verify-email-identity --email-address ${SENDER_EMAIL.toLowerCase()} --profile ${AWS_PROFILE}`);
        } else if (error.name === 'MailFromDomainNotVerifiedException') {
            console.error('📧 Issue: Domain not verified');
            console.error('   You need to verify the domain in SES');
        } else if (error.name === 'AccountSendingPausedException') {
            console.error('📧 Issue: SES account is paused');
            console.error('   Contact AWS support to reactivate');
        }
        
        console.error('');
        console.error('Full Error:', error);
        process.exit(1);
    }
}

// Run the test
testSendEmail();

