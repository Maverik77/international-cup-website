const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TOURNAMENT_RESULTS_TABLE = process.env.TOURNAMENT_RESULTS_TABLE || 'icup-tournament-results-staging';

exports.handler = async (event) => {
    console.log('GET Tournament Results request:', JSON.stringify(event));
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const queryParams = event.queryStringParameters || {};
        const year = queryParams.year ? parseInt(queryParams.year) : null;
        const day = queryParams.day ? parseInt(queryParams.day) : null;

        if (!year) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Year parameter is required',
                    usage: 'GET /tournament-results?year=2024&day=1'
                })
            };
        }

        // Query using GSI year-day-index
        const queryInput = {
            TableName: TOURNAMENT_RESULTS_TABLE,
            IndexName: 'year-day-index',
            KeyConditionExpression: '#year = :year',
            ExpressionAttributeNames: {
                '#year': 'year'
            },
            ExpressionAttributeValues: {
                ':year': year
            }
        };

        // Add day filter if specified
        if (day !== null) {
            queryInput.KeyConditionExpression += ' AND begins_with(#dayMatchNumber, :dayPrefix)';
            queryInput.ExpressionAttributeNames['#dayMatchNumber'] = 'dayMatchNumber';
            queryInput.ExpressionAttributeValues[':dayPrefix'] = `${day}#`;
        }

        const result = await docClient.send(new QueryCommand(queryInput));

        // Group results by match
        const matchesMap = new Map();

        for (const item of result.Items || []) {
            const matchKey = item.yearMatchId;
            
            if (!matchesMap.has(matchKey)) {
                matchesMap.set(matchKey, {});
            }

            if (item.dataType === 'MATCH') {
                matchesMap.get(matchKey).match = item;
            } else if (item.dataType === 'SCORECARD') {
                matchesMap.get(matchKey).scorecard = item;
            }
        }

        // Convert map to array and sort by match number
        const matches = Array.from(matchesMap.values())
            .filter(m => m.match) // Ensure we have at least the match record
            .map(m => ({
                ...m.match,
                holes: m.scorecard?.holes || []
            }))
            .sort((a, b) => {
                if (a.day !== b.day) return a.day - b.day;
                return a.matchNumber - b.matchNumber;
            });

        // Calculate summary statistics
        const summary = {
            year,
            totalMatches: matches.length,
            usaWins: matches.filter(m => m.winner === 'USA').length,
            internationalWins: matches.filter(m => m.winner === 'International').length,
            ties: matches.filter(m => m.winner === 'Tie').length,
            day1Matches: matches.filter(m => m.day === 1).length,
            day2Matches: matches.filter(m => m.day === 2).length
        };

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                year,
                day: day || 'all',
                summary,
                matches
            })
        };

    } catch (error) {
        console.error('Error fetching tournament results:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to fetch tournament results',
                message: error.message 
            })
        };
    }
};





