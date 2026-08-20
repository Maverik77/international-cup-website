// Tournament Results Viewing JavaScript

class TournamentResultsView {
    constructor() {
        this.apiConfig = this.getApiConfig();
        this.currentYear = null;
        this.currentDay = null;
        this.allMatches = [];
        this.init();
    }

    getApiConfig() {
        const isStaging = window.location.origin.includes('staging');
        return {
            restApi: isStaging 
                ? 'https://9iz68mvngi.execute-api.us-east-1.amazonaws.com/prod'
                : 'https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod'
        };
    }

    async init() {
        // Get year from URL parameter or load available years
        const urlParams = new URLSearchParams(window.location.search);
        const yearFromUrl = urlParams.get('year');

        await this.loadAvailableYears();

        if (yearFromUrl) {
            this.loadYear(parseInt(yearFromUrl));
        }
    }

    async loadAvailableYears() {
        try {
            const response = await fetch(`${this.apiConfig.restApi}/tournament-results/reports?type=year-summary`);
            const data = await response.json();

            const yearSelect = document.getElementById('year-select');
            
            if (!data.data || !data.data.summaries || data.data.summaries.length === 0) {
                yearSelect.innerHTML = '<option value="">No tournaments found</option>';
                return;
            }

            const years = data.data.summaries.map(s => s.year).sort((a, b) => b - a);
            
            yearSelect.innerHTML = years.map(year => 
                `<option value="${year}">${year} Tournament</option>`
            ).join('');

            // Select first year by default if no year from URL
            if (!this.currentYear && years.length > 0) {
                this.loadYear(years[0]);
            }

        } catch (error) {
            console.error('Error loading years:', error);
            document.getElementById('year-select').innerHTML = '<option value="">Error loading years</option>';
        }
    }

    async loadYear(year) {
        this.currentYear = parseInt(year);
        this.currentDay = null;
        
        const container = document.getElementById('results-content');
        container.innerHTML = '<div class="loading">Loading tournament results...</div>';

        // Update year selector
        document.getElementById('year-select').value = year;

        try {
            const response = await fetch(`${this.apiConfig.restApi}/tournament-results?year=${year}`);
            
            if (!response.ok) {
                throw new Error('Failed to load results');
            }

            const data = await response.json();
            this.allMatches = data.matches || [];

            // Render summary and day tabs
            this.renderResults(data);

        } catch (error) {
            console.error('Error loading tournament results:', error);
            container.innerHTML = `<div class="error-message">Failed to load tournament results: ${error.message}</div>`;
        }
    }

    renderResults(data) {
        const container = document.getElementById('results-content');
        
        // Create summary
        const summaryHTML = `
            <div class="summary-box">
                <h2>${data.year} International Cup</h2>
                <div class="summary-stats">
                    <div class="stat">
                        <div class="value">${data.summary.usaWins}</div>
                        <div class="label">USA Wins</div>
                    </div>
                    <div class="stat">
                        <div class="value">${data.summary.internationalWins}</div>
                        <div class="label">International Wins</div>
                    </div>
                    <div class="stat">
                        <div class="value">${data.summary.ties}</div>
                        <div class="label">Ties</div>
                    </div>
                    <div class="stat">
                        <div class="value">${data.summary.totalMatches}</div>
                        <div class="label">Total Matches</div>
                    </div>
                </div>
            </div>
        `;

        // Create day tabs
        const daysHTML = `
            <div class="day-tabs">
                <button class="day-tab ${!this.currentDay ? 'active' : ''}" onclick="tournamentResults.filterByDay(null)">
                    All Matches
                </button>
                ${data.summary.day1Matches > 0 ? `
                    <button class="day-tab ${this.currentDay === 1 ? 'active' : ''}" onclick="tournamentResults.filterByDay(1)">
                        Day 1 (${data.summary.day1Matches})
                    </button>
                ` : ''}
                ${data.summary.day2Matches > 0 ? `
                    <button class="day-tab ${this.currentDay === 2 ? 'active' : ''}" onclick="tournamentResults.filterByDay(2)">
                        Day 2 (${data.summary.day2Matches})
                    </button>
                ` : ''}
            </div>
        `;

        // Filter matches by day if needed
        const matchesToShow = this.currentDay 
            ? this.allMatches.filter(m => m.day === this.currentDay)
            : this.allMatches;

        // Render matches
        const matchesHTML = matchesToShow.map(match => this.renderMatchCard(match)).join('');

        container.innerHTML = summaryHTML + daysHTML + matchesHTML;
    }

    renderMatchCard(match) {
        const resultClass = match.winner === 'USA' ? 'usa' : 
                           match.winner === 'International' ? 'international' : 'tie';
        
        const resultText = match.winner === 'Tie' ? 'Tie' : `${match.winner} Wins`;

        return `
            <div class="match-card" onclick="tournamentResults.toggleScorecard('${match.yearMatchId}')">
                <div class="match-header">
                    <div>
                        <div class="match-number">Match ${match.matchNumber}</div>
                        <div class="match-format">${match.format} • Day ${match.day}</div>
                    </div>
                    <div class="match-result ${resultClass}">
                        ${resultText}
                    </div>
                </div>
                <div class="teams">
                    <div class="team">
                        <div class="team-name">🇺🇸 Team USA</div>
                        ${match.usaPlayers.map(p => `<div class="player-name">${p}</div>`).join('')}
                    </div>
                    <div class="score">
                        ${match.finalScore || 'Final'}
                    </div>
                    <div class="team">
                        <div class="team-name">🌍 International</div>
                        ${match.internationalPlayers.map(p => `<div class="player-name">${p}</div>`).join('')}
                    </div>
                </div>
                ${match.holes && match.holes.length > 0 ? this.renderScorecard(match) : ''}
            </div>
        `;
    }

    renderScorecard(match) {
        if (!match.holes || match.holes.length === 0) return '';

        const holes = match.holes.sort((a, b) => a.holeNumber - b.holeNumber);

        return `
            <div class="scorecard" id="scorecard-${match.yearMatchId}">
                <h4>Hole-by-Hole Scorecard</h4>
                <table class="scorecard-table">
                    <thead>
                        <tr>
                            <th>Hole</th>
                            <th colspan="2">USA</th>
                            <th colspan="2">International</th>
                            <th>Result</th>
                        </tr>
                        <tr>
                            <th></th>
                            <th>Gross</th>
                            <th>Net</th>
                            <th>Gross</th>
                            <th>Net</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${holes.map(hole => {
                            const rowClass = hole.result === 'usa' ? 'hole-win' : 
                                           hole.result === 'international' ? 'hole-loss' : 'hole-tie';
                            return `
                                <tr class="${rowClass}">
                                    <td><strong>${hole.holeNumber}</strong></td>
                                    <td>${hole.usaStrokes}</td>
                                    <td>${hole.usaNet}</td>
                                    <td>${hole.internationalStrokes}</td>
                                    <td>${hole.internationalNet}</td>
                                    <td>${hole.result === 'usa' ? 'USA' : hole.result === 'international' ? 'Intl' : 'Tie'}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    filterByDay(day) {
        this.currentDay = day;
        this.renderResults({
            year: this.currentYear,
            summary: this.calculateSummary(),
            matches: this.allMatches
        });
    }

    calculateSummary() {
        const filteredMatches = this.currentDay 
            ? this.allMatches.filter(m => m.day === this.currentDay)
            : this.allMatches;

        return {
            totalMatches: filteredMatches.length,
            usaWins: filteredMatches.filter(m => m.winner === 'USA').length,
            internationalWins: filteredMatches.filter(m => m.winner === 'International').length,
            ties: filteredMatches.filter(m => m.winner === 'Tie').length,
            day1Matches: this.allMatches.filter(m => m.day === 1).length,
            day2Matches: this.allMatches.filter(m => m.day === 2).length
        };
    }

    toggleScorecard(matchId) {
        const scorecard = document.getElementById(`scorecard-${matchId}`);
        if (scorecard) {
            scorecard.classList.toggle('expanded');
        }
    }
}

// Initialize tournament results when page loads
let tournamentResults;
document.addEventListener('DOMContentLoaded', () => {
    tournamentResults = new TournamentResultsView();
});





