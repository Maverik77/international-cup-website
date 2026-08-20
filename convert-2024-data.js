// Script to convert existing 2024 tournament data to new format
const fs = require('fs');

// Read the existing data
const existingData = require('./single_matches_perhole.json');

console.log('Converting 2024 tournament data...');

// Transform the data to match new API format
const newFormat = {
    year: 2024,
    matches: existingData.matches.map(match => {
        // Determine winner based on overall match result
        let winner = 'Tie';
        let finalScore = 'Tie';
        
        // Calculate total holes won
        let usaHolesWon = 0;
        let intlHolesWon = 0;
        
        match.holes.forEach(hole => {
            if (hole.usa.result === 'win') usaHolesWon++;
            if (hole.international.result === 'win') intlHolesWon++;
        });
        
        const holeDiff = usaHolesWon - intlHolesWon;
        const holesRemaining = 18 - match.holes.length;
        
        if (holeDiff > holesRemaining) {
            winner = 'USA';
            const holesUp = holeDiff;
            const holesLeft = holesRemaining;
            finalScore = holesLeft > 0 ? `${holesUp} & ${holesLeft}` : `${holesUp} Up`;
        } else if (holeDiff < -holesRemaining) {
            winner = 'International';
            const holesUp = Math.abs(holeDiff);
            const holesLeft = holesRemaining;
            finalScore = holesLeft > 0 ? `${holesUp} & ${holesLeft}` : `${holesUp} Up`;
        } else if (match.holes.length === 18) {
            if (holeDiff > 0) {
                winner = 'USA';
                finalScore = `${holeDiff} Up`;
            } else if (holeDiff < 0) {
                winner = 'International';
                finalScore = `${Math.abs(holeDiff)} Up`;
            } else {
                finalScore = 'All Square';
            }
        }

        return {
            matchNumber: match.match_no,
            day: 2, // Assuming Day 2 (singles matches)
            format: 'Singles Match Play',
            usaPlayers: [match.usa_player.name],
            internationalPlayers: [match.international_player.name],
            winner,
            finalScore,
            usaTotalGross: match.usa_player.gross_total || 0,
            internationalTotalGross: match.international_player.gross_total || 0,
            usaTotalNet: match.usa_player.net_total || 0,
            internationalTotalNet: match.international_player.net_total || 0,
            holes: match.holes.map(hole => ({
                holeNumber: hole.hole,
                usaStrokes: hole.usa.strokes,
                usaNet: hole.usa.net,
                internationalStrokes: hole.international.strokes,
                internationalNet: hole.international.net,
                result: hole.usa.result === 'win' ? 'usa' : 
                       hole.international.result === 'win' ? 'international' : 'tie',
                usaStrokeReceived: hole.usa.stroke_received || false,
                internationalStrokeReceived: hole.international.stroke_received || false
            }))
        };
    })
};

// Write to new file
fs.writeFileSync('2024-tournament-data-formatted.json', JSON.stringify(newFormat, null, 2));

console.log(`✅ Converted ${newFormat.matches.length} matches`);
console.log('Output saved to: 2024-tournament-data-formatted.json');
console.log('\nYou can now upload this file via the tournament admin interface or use curl:');
console.log('\ncurl -X POST https://9iz68mvngi.execute-api.us-east-1.amazonaws.com/prod/tournament-results \\');
console.log('  -H "Authorization: Bearer icup2024staging" \\');
console.log('  -H "Content-Type: application/json" \\');
console.log('  -d @2024-tournament-data-formatted.json');





