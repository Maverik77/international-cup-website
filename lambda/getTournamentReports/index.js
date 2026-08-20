const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TOURNAMENT_RESULTS_TABLE = process.env.TOURNAMENT_RESULTS_TABLE || 'icup-tournament-results-staging';

exports.handler = async (event) => {
    console.log('GET Tournament Reports request:', JSON.stringify(event));
    
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
        const reportType = queryParams.type || 'year-summary';

        let reportData;

        switch (reportType) {
            case 'player-stats':
                reportData = await getPlayerStats(queryParams.player);
                break;
            case 'format-analysis':
                reportData = await getFormatAnalysis();
                break;
            case 'head-to-head':
                reportData = await getHeadToHead(queryParams.player1, queryParams.player2);
                break;
            case 'year-summary':
                reportData = await getYearSummary(queryParams.year);
                break;
            default:
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        error: 'Invalid report type',
                        validTypes: ['player-stats', 'format-analysis', 'head-to-head', 'year-summary']
                    })
                };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                reportType,
                data: reportData
            })
        };

    } catch (error) {
        console.error('Error generating tournament report:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to generate tournament report',
                message: error.message 
            })
        };
    }
};

async function getPlayerStats(playerName) {
    if (!playerName) {
        throw new Error('Player name is required for player-stats report');
    }

    // Query using player-index GSI to find all player records
    const playerRecords = await docClient.send(new QueryCommand({
        TableName: TOURNAMENT_RESULTS_TABLE,
        IndexName: 'player-index',
        KeyConditionExpression: '#playerName = :playerName',
        FilterExpression: 'begins_with(#dataType, :playerPrefix)',
        ExpressionAttributeNames: {
            '#playerName': 'playerName',
            '#dataType': 'dataType'
        },
        ExpressionAttributeValues: {
            ':playerName': playerName,
            ':playerPrefix': 'PLAYER#'
        }
    }));

    // Get the actual match data for each match this player participated in
    const matchPromises = (playerRecords.Items || []).map(async (playerRecord) => {
        const matchResult = await docClient.send(new QueryCommand({
            TableName: TOURNAMENT_RESULTS_TABLE,
            KeyConditionExpression: '#yearMatchId = :yearMatchId AND #dataType = :dataType',
            ExpressionAttributeNames: {
                '#yearMatchId': 'yearMatchId',
                '#dataType': 'dataType'
            },
            ExpressionAttributeValues: {
                ':yearMatchId': playerRecord.yearMatchId,
                ':dataType': 'MATCH'
            }
        }));
        return matchResult.Items?.[0];
    });

    const matches = (await Promise.all(matchPromises)).filter(m => m);
    
    // Calculate statistics
    let wins = 0;
    let losses = 0;
    let ties = 0;
    let totalGross = 0;
    let totalNet = 0;
    let matchCount = 0;
    const byYear = {};
    const byFormat = {};

    for (const match of matches) {
        const isUSAPlayer = match.usaPlayers.includes(playerName);
        const matchWinner = match.winner;
        
        // Determine if player won
        if (matchWinner === 'Tie') {
            ties++;
        } else if ((isUSAPlayer && matchWinner === 'USA') || (!isUSAPlayer && matchWinner === 'International')) {
            wins++;
        } else {
            losses++;
        }

        // Accumulate scores
        if (isUSAPlayer) {
            totalGross += match.usaTotalGross || 0;
            totalNet += match.usaTotalNet || 0;
        } else {
            totalGross += match.internationalTotalGross || 0;
            totalNet += match.internationalTotalNet || 0;
        }
        
        matchCount++;

        // By year
        if (!byYear[match.year]) {
            byYear[match.year] = { wins: 0, losses: 0, ties: 0, matches: 0 };
        }
        byYear[match.year].matches++;
        if (matchWinner === 'Tie') {
            byYear[match.year].ties++;
        } else if ((isUSAPlayer && matchWinner === 'USA') || (!isUSAPlayer && matchWinner === 'International')) {
            byYear[match.year].wins++;
        } else {
            byYear[match.year].losses++;
        }

        // By format
        const format = match.format || 'Unknown';
        if (!byFormat[format]) {
            byFormat[format] = { wins: 0, losses: 0, ties: 0, matches: 0 };
        }
        byFormat[format].matches++;
        if (matchWinner === 'Tie') {
            byFormat[format].ties++;
        } else if ((isUSAPlayer && matchWinner === 'USA') || (!isUSAPlayer && matchWinner === 'International')) {
            byFormat[format].wins++;
        } else {
            byFormat[format].losses++;
        }
    }

    return {
        playerName,
        totalMatches: matchCount,
        wins,
        losses,
        ties,
        winPercentage: matchCount > 0 ? ((wins / matchCount) * 100).toFixed(1) : 0,
        averageGross: matchCount > 0 ? (totalGross / matchCount).toFixed(1) : 0,
        averageNet: matchCount > 0 ? (totalNet / matchCount).toFixed(1) : 0,
        byYear,
        byFormat,
        matches
    };
}

async function getFormatAnalysis() {
    // Scan all matches
    const result = await docClient.send(new ScanCommand({
        TableName: TOURNAMENT_RESULTS_TABLE,
        FilterExpression: '#dataType = :dataType',
        ExpressionAttributeNames: {
            '#dataType': 'dataType'
        },
        ExpressionAttributeValues: {
            ':dataType': 'MATCH'
        }
    }));

    const matches = result.Items || [];
    const formatStats = {};

    for (const match of matches) {
        const format = match.format || 'Unknown';
        
        if (!formatStats[format]) {
            formatStats[format] = {
                totalMatches: 0,
                usaWins: 0,
                internationalWins: 0,
                ties: 0
            };
        }

        formatStats[format].totalMatches++;
        
        if (match.winner === 'USA') {
            formatStats[format].usaWins++;
        } else if (match.winner === 'International') {
            formatStats[format].internationalWins++;
        } else {
            formatStats[format].ties++;
        }
    }

    // Calculate percentages
    const formatsArray = Object.entries(formatStats).map(([format, stats]) => ({
        format,
        ...stats,
        usaWinPercentage: stats.totalMatches > 0 ? ((stats.usaWins / stats.totalMatches) * 100).toFixed(1) : 0,
        internationalWinPercentage: stats.totalMatches > 0 ? ((stats.internationalWins / stats.totalMatches) * 100).toFixed(1) : 0
    }));

    return {
        formats: formatsArray,
        totalMatches: matches.length
    };
}

async function getHeadToHead(player1, player2) {
    if (!player1 || !player2) {
        throw new Error('Both player1 and player2 are required for head-to-head report');
    }

    // Get all matches for player1
    const player1Matches = await docClient.send(new QueryCommand({
        TableName: TOURNAMENT_RESULTS_TABLE,
        IndexName: 'player-index',
        KeyConditionExpression: '#playerName = :playerName',
        FilterExpression: '#dataType = :dataType',
        ExpressionAttributeNames: {
            '#playerName': 'playerName',
            '#dataType': 'dataType'
        },
        ExpressionAttributeValues: {
            ':playerName': player1,
            ':dataType': 'MATCH'
        }
    }));

    // Filter matches where both players participated
    const headToHeadMatches = (player1Matches.Items || []).filter(match => {
        const allPlayers = [...match.usaPlayers, ...match.internationalPlayers];
        return allPlayers.includes(player2);
    });

    let player1Wins = 0;
    let player2Wins = 0;
    let ties = 0;

    for (const match of headToHeadMatches) {
        const player1Team = match.usaPlayers.includes(player1) ? 'USA' : 'International';
        const matchWinner = match.winner;

        if (matchWinner === 'Tie') {
            ties++;
        } else if (matchWinner === player1Team) {
            player1Wins++;
        } else {
            player2Wins++;
        }
    }

    return {
        player1,
        player2,
        totalMatches: headToHeadMatches.length,
        player1Wins,
        player2Wins,
        ties,
        matches: headToHeadMatches
    };
}

async function getYearSummary(year) {
    if (!year) {
        // Get all years
        const result = await docClient.send(new ScanCommand({
            TableName: TOURNAMENT_RESULTS_TABLE,
            FilterExpression: '#dataType = :dataType',
            ExpressionAttributeNames: {
                '#dataType': 'dataType'
            },
            ExpressionAttributeValues: {
                ':dataType': 'MATCH'
            }
        }));

        const matches = result.Items || [];
        const yearSummaries = {};

        for (const match of matches) {
            const y = match.year;
            if (!yearSummaries[y]) {
                yearSummaries[y] = {
                    year: y,
                    totalMatches: 0,
                    usaWins: 0,
                    internationalWins: 0,
                    ties: 0,
                    day1Matches: 0,
                    day2Matches: 0
                };
            }

            yearSummaries[y].totalMatches++;
            
            if (match.winner === 'USA') {
                yearSummaries[y].usaWins++;
            } else if (match.winner === 'International') {
                yearSummaries[y].internationalWins++;
            } else {
                yearSummaries[y].ties++;
            }

            if (match.day === 1) {
                yearSummaries[y].day1Matches++;
            } else if (match.day === 2) {
                yearSummaries[y].day2Matches++;
            }
        }

        return {
            allYears: true,
            summaries: Object.values(yearSummaries).sort((a, b) => b.year - a.year)
        };
    } else {
        // Get specific year
        const result = await docClient.send(new QueryCommand({
            TableName: TOURNAMENT_RESULTS_TABLE,
            IndexName: 'year-day-index',
            KeyConditionExpression: '#year = :year',
            FilterExpression: '#dataType = :dataType',
            ExpressionAttributeNames: {
                '#year': 'year',
                '#dataType': 'dataType'
            },
            ExpressionAttributeValues: {
                ':year': parseInt(year),
                ':dataType': 'MATCH'
            }
        }));

        const matches = result.Items || [];
        
        const summary = {
            year: parseInt(year),
            totalMatches: matches.length,
            usaWins: matches.filter(m => m.winner === 'USA').length,
            internationalWins: matches.filter(m => m.winner === 'International').length,
            ties: matches.filter(m => m.winner === 'Tie').length,
            day1Matches: matches.filter(m => m.day === 1).length,
            day2Matches: matches.filter(m => m.day === 2).length,
            matches
        };

        return summary;
    }
}

