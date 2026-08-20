const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TOURNAMENT_RESULTS_TABLE = process.env.TOURNAMENT_RESULTS_TABLE || 'icup-tournament-results-staging';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'icup2024';

exports.handler = async (event) => {
    console.log('UPLOAD Tournament Results request:', JSON.stringify(event));
    
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
                body: JSON.stringify({ 
                    error: 'Unauthorized. Admin password required.' 
                })
            };
        }

        const body = JSON.parse(event.body);
        const { year, matches } = body;

        if (!year || !matches || !Array.isArray(matches)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: 'Invalid request body. Required: { year, matches: [] }' 
                })
            };
        }

        // Validate matches structure
        for (const match of matches) {
            if (!match.matchNumber || !match.day || !match.usaPlayers || !match.internationalPlayers) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        error: 'Invalid match structure. Each match requires: matchNumber, day, usaPlayers, internationalPlayers' 
                    })
                };
            }
        }

        const timestamp = Date.now();
        const itemsToWrite = [];

        // Process each match
        for (const match of matches) {
            const yearMatchId = `${year}#match-${match.matchNumber}`;
            const dayMatchNumber = `${match.day}#${String(match.matchNumber).padStart(3, '0')}`;
            const allPlayers = [...match.usaPlayers, ...match.internationalPlayers];

            // Create MATCH record (one per match)
            const matchRecord = {
                yearMatchId,
                dataType: 'MATCH',
                year,
                matchNumber: match.matchNumber,
                day: match.day,
                format: match.format || 'Unknown',
                usaPlayers: match.usaPlayers,
                internationalPlayers: match.internationalPlayers,
                winner: match.winner || 'Tie',
                finalScore: match.finalScore || '',
                usaTotalGross: match.usaTotalGross || 0,
                internationalTotalGross: match.internationalTotalGross || 0,
                usaTotalNet: match.usaTotalNet || 0,
                internationalTotalNet: match.internationalTotalNet || 0,
                timestamp,
                dayMatchNumber,
                // Store first player name for GSI (we'll create separate player records below)
                playerName: allPlayers[0] || 'Unknown'
            };
            itemsToWrite.push(matchRecord);

            // Create separate PLAYER records for each player to enable player-index queries
            allPlayers.forEach((playerName, index) => {
                itemsToWrite.push({
                    yearMatchId,
                    dataType: `PLAYER#${index}`,
                    year,
                    playerName,
                    dayMatchNumber,
                    matchNumber: match.matchNumber,
                    day: match.day,
                    timestamp
                });
            });

            // Create SCORECARD record if holes data exists
            if (match.holes && Array.isArray(match.holes) && match.holes.length > 0) {
                const scorecardRecord = {
                    yearMatchId,
                    dataType: 'SCORECARD',
                    year,
                    dayMatchNumber,
                    holes: match.holes.map(hole => ({
                        holeNumber: hole.holeNumber,
                        usaStrokes: hole.usaStrokes || 0,
                        usaNet: hole.usaNet || 0,
                        internationalStrokes: hole.internationalStrokes || 0,
                        internationalNet: hole.internationalNet || 0,
                        result: hole.result || 'tie',
                        usaStrokeReceived: hole.usaStrokeReceived || false,
                        internationalStrokeReceived: hole.internationalStrokeReceived || false
                    })),
                    timestamp
                };
                itemsToWrite.push(scorecardRecord);
            }
        }

        // Write items in batches of 25 (DynamoDB limit)
        const batchSize = 25;
        for (let i = 0; i < itemsToWrite.length; i += batchSize) {
            const batch = itemsToWrite.slice(i, i + batchSize);
            const putRequests = batch.map(item => ({
                PutRequest: {
                    Item: item
                }
            }));

            await docClient.send(new BatchWriteCommand({
                RequestItems: {
                    [TOURNAMENT_RESULTS_TABLE]: putRequests
                }
            }));
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                message: 'Tournament results uploaded successfully',
                year,
                matchesUploaded: matches.length,
                itemsWritten: itemsToWrite.length
            })
        };

    } catch (error) {
        console.error('Error uploading tournament results:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to upload tournament results',
                message: error.message 
            })
        };
    }
};

