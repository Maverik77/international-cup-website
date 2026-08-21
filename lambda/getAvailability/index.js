const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const AVAILABILITY_TABLE = process.env.AVAILABILITY_TABLE;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!AVAILABILITY_TABLE) throw new Error('AVAILABILITY_TABLE env var is required');
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD env var is required');

const ddb = new DynamoDBClient({ region: 'us-east-1' });
const doc = DynamoDBDocumentClient.from(ddb);

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }

    const headers = event.headers || {};
    const provided = headers['x-admin-password'] || headers['X-Admin-Password'];
    if (!provided || provided !== ADMIN_PASSWORD) {
        return respond(401, { error: 'unauthorized' });
    }

    let items = [];
    let ExclusiveStartKey;
    try {
        do {
            const res = await doc.send(new ScanCommand({
                TableName: AVAILABILITY_TABLE,
                ExclusiveStartKey,
            }));
            items.push(...(res.Items || []));
            ExclusiveStartKey = res.LastEvaluatedKey;
        } while (ExclusiveStartKey);
    } catch (err) {
        console.error('[get] Scan failed:', err);
        return respond(500, { error: 'server', message: 'Could not read submissions.' });
    }

    items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    return respond(200, { items, count: items.length });
};

function respond(statusCode, obj) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(obj) };
}
