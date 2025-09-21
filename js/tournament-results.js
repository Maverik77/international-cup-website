// Tournament Results Management
// Handles parsing and displaying 2024 International Cup results from Golf Genius

class TournamentResults {
    constructor() {
        this.results = {
            day1: null,
            day2: null
        };
        this.isLoaded = false;
        this.init();
    }

    init() {
        // Initialize event listeners
        this.setupEventListeners();
        // Load cached results if available
        this.loadCachedResults();
    }

    setupEventListeners() {
        const viewResultsBtn = document.getElementById('view-results-btn');
        if (viewResultsBtn) {
            viewResultsBtn.addEventListener('click', () => this.showResultsModal());
        }
    }

    // Sample tournament data structure (would be parsed from Golf Genius)
    getSampleData() {
        return {
            day1: {
                title: "Day 1 - Team Matches",
                date: "October 16, 2024",
                format: "Four-Ball",
                matches: [
                    {
                        matchNumber: 1,
                        teamUSA: {
                            players: ["John Smith", "Mike Johnson"],
                            score: "3 & 2"
                        },
                        teamInternational: {
                            players: ["Lars Andersson", "Sophie Chen"],
                            score: "Lost"
                        },
                        result: "USA Wins"
                    },
                    {
                        matchNumber: 2,
                        teamUSA: {
                            players: ["David Brown", "Chris Wilson"],
                            score: "Lost"
                        },
                        teamInternational: {
                            players: ["Emma Thompson", "Marco Rodriguez"],
                            score: "2 & 1"
                        },
                        result: "International Wins"
                    },
                    {
                        matchNumber: 3,
                        teamUSA: {
                            players: ["Robert Davis", "James Miller"],
                            score: "1 Up"
                        },
                        teamInternational: {
                            players: ["Pierre Dubois", "Yuki Tanaka"],
                            score: "Lost"
                        },
                        result: "USA Wins"
                    },
                    {
                        matchNumber: 4,
                        teamUSA: {
                            players: ["Steve Garcia", "Tom Anderson"],
                            score: "All Square"
                        },
                        teamInternational: {
                            players: ["Carlos Silva", "Alex Murphy"],
                            score: "All Square"
                        },
                        result: "Halved"
                    }
                ],
                summary: {
                    usa: 2.5,
                    international: 1.5,
                    total: 4
                }
            },
            day2: {
                title: "Day 2 - Singles Matches",
                date: "October 17, 2024",
                format: "Singles Match Play",
                matches: [
                    {
                        matchNumber: 1,
                        teamUSA: {
                            players: ["John Smith"],
                            score: "2 & 1"
                        },
                        teamInternational: {
                            players: ["Lars Andersson"],
                            score: "Lost"
                        },
                        result: "USA Wins"
                    },
                    {
                        matchNumber: 2,
                        teamUSA: {
                            players: ["Mike Johnson"],
                            score: "Lost"
                        },
                        teamInternational: {
                            players: ["Sophie Chen"],
                            score: "3 & 2"
                        },
                        result: "International Wins"
                    },
                    {
                        matchNumber: 3,
                        teamUSA: {
                            players: ["David Brown"],
                            score: "4 & 3"
                        },
                        teamInternational: {
                            players: ["Emma Thompson"],
                            score: "Lost"
                        },
                        result: "USA Wins"
                    },
                    {
                        matchNumber: 4,
                        teamUSA: {
                            players: ["Chris Wilson"],
                            score: "1 Up"
                        },
                        teamInternational: {
                            players: ["Marco Rodriguez"],
                            score: "Lost"
                        },
                        result: "USA Wins"
                    },
                    {
                        matchNumber: 5,
                        teamUSA: {
                            players: ["Robert Davis"],
                            score: "Lost"
                        },
                        teamInternational: {
                            players: ["Pierre Dubois"],
                            score: "2 Up"
                        },
                        result: "International Wins"
                    },
                    {
                        matchNumber: 6,
                        teamUSA: {
                            players: ["James Miller"],
                            score: "5 & 4"
                        },
                        teamInternational: {
                            players: ["Yuki Tanaka"],
                            score: "Lost"
                        },
                        result: "USA Wins"
                    },
                    {
                        matchNumber: 7,
                        teamUSA: {
                            players: ["Steve Garcia"],
                            score: "Lost"
                        },
                        teamInternational: {
                            players: ["Carlos Silva"],
                            score: "1 Up"
                        },
                        result: "International Wins"
                    },
                    {
                        matchNumber: 8,
                        teamUSA: {
                            players: ["Tom Anderson"],
                            score: "3 & 1"
                        },
                        teamInternational: {
                            players: ["Alex Murphy"],
                            score: "Lost"
                        },
                        result: "USA Wins"
                    }
                ],
                summary: {
                    usa: 5,
                    international: 3,
                    total: 8
                }
            }
        };
    }

    loadCachedResults() {
        try {
            const cached = localStorage.getItem('tournament-results-2024');
            if (cached) {
                this.results = JSON.parse(cached);
                this.isLoaded = true;
            } else {
                // Load sample data for now
                this.results = this.getSampleData();
                this.isLoaded = true;
                this.cacheResults();
            }
        } catch (error) {
            console.error('Error loading cached results:', error);
            // Fallback to sample data
            this.results = this.getSampleData();
            this.isLoaded = true;
        }
    }

    cacheResults() {
        try {
            localStorage.setItem('tournament-results-2024', JSON.stringify(this.results));
        } catch (error) {
            console.error('Error caching results:', error);
        }
    }

    showResultsModal() {
        if (!this.isLoaded) {
            showNotification('Tournament results are still loading...', 'info');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal tournament-results-modal';
        modal.style.display = 'block';

        modal.innerHTML = `
            <div class="modal-content tournament-modal-content">
                <div class="modal-header">
                    <h2>2024 International Cup Results</h2>
                    <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
                </div>
                <div class="modal-body">
                    <div class="results-controls">
                        <div class="day-selector">
                            <button class="day-btn active" data-day="day1">Day 1</button>
                            <button class="day-btn" data-day="day2">Day 2</button>
                        </div>
                        <button class="expand-btn" id="expand-all">Expand All</button>
                    </div>
                    <div class="results-container">
                        <div id="day1-results" class="day-results active">
                            ${this.renderDayResults('day1')}
                        </div>
                        <div id="day2-results" class="day-results">
                            ${this.renderDayResults('day2')}
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.setupModalEventListeners(modal);

        // Close on outside click
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    setupModalEventListeners(modal) {
        // Day selector buttons
        const dayButtons = modal.querySelectorAll('.day-btn');
        const dayResults = modal.querySelectorAll('.day-results');

        dayButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                // Remove active class from all buttons and results
                dayButtons.forEach(b => b.classList.remove('active'));
                dayResults.forEach(r => r.classList.remove('active'));

                // Add active class to clicked button and corresponding results
                btn.classList.add('active');
                const targetDay = btn.dataset.day;
                modal.querySelector(`#${targetDay}-results`).classList.add('active');
            });
        });

        // Expand/Collapse all functionality
        const expandBtn = modal.querySelector('#expand-all');
        let isExpanded = false;

        expandBtn.addEventListener('click', () => {
            const activeResults = modal.querySelector('.day-results.active');
            const matchCards = activeResults.querySelectorAll('.match-card');

            matchCards.forEach(card => {
                const details = card.querySelector('.match-details');
                if (isExpanded) {
                    details.style.display = 'none';
                    card.classList.remove('expanded');
                } else {
                    details.style.display = 'block';
                    card.classList.add('expanded');
                }
            });

            expandBtn.textContent = isExpanded ? 'Expand All' : 'Collapse All';
            isExpanded = !isExpanded;
        });

        // Individual match card toggles
        modal.addEventListener('click', (e) => {
            if (e.target.closest('.match-header')) {
                const card = e.target.closest('.match-card');
                const details = card.querySelector('.match-details');
                
                if (details.style.display === 'none' || !details.style.display) {
                    details.style.display = 'block';
                    card.classList.add('expanded');
                } else {
                    details.style.display = 'none';
                    card.classList.remove('expanded');
                }
            }
        });
    }

    renderDayResults(day) {
        const dayData = this.results[day];
        if (!dayData) return '<p>No results available</p>';

        const matchesHtml = dayData.matches.map(match => `
            <div class="match-card">
                <div class="match-header">
                    <div class="match-number">Match ${match.matchNumber}</div>
                    <div class="match-result ${match.result.toLowerCase().replace(' ', '-')}">${match.result}</div>
                    <div class="expand-icon">▼</div>
                </div>
                <div class="match-details" style="display: none;">
                    <div class="team-matchup">
                        <div class="team-side usa">
                            <div class="team-label">Team USA</div>
                            <div class="players">${match.teamUSA.players.join(' & ')}</div>
                            <div class="score">${match.teamUSA.score}</div>
                        </div>
                        <div class="vs">VS</div>
                        <div class="team-side international">
                            <div class="team-label">Team International</div>
                            <div class="players">${match.teamInternational.players.join(' & ')}</div>
                            <div class="score">${match.teamInternational.score}</div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');

        return `
            <div class="day-header">
                <h3>${dayData.title}</h3>
                <div class="day-info">
                    <span class="date">${dayData.date}</span>
                    <span class="format">${dayData.format}</span>
                </div>
            </div>
            <div class="day-summary">
                <div class="summary-score">
                    <div class="team-score usa">
                        <span class="team-name">Team USA</span>
                        <span class="points">${dayData.summary.usa}</span>
                    </div>
                    <div class="summary-divider">-</div>
                    <div class="team-score international">
                        <span class="team-name">Team International</span>
                        <span class="points">${dayData.summary.international}</span>
                    </div>
                </div>
            </div>
            <div class="matches-list">
                ${matchesHtml}
            </div>
        `;
    }

    // Method to parse real Golf Genius data (to be implemented when API access is available)
    async parseGolfGeniusData(url) {
        try {
            // This would implement the actual parsing logic
            // For now, we'll use the sample data
            console.log('Golf Genius parsing not yet implemented for URL:', url);
            return this.getSampleData();
        } catch (error) {
            console.error('Error parsing Golf Genius data:', error);
            throw error;
        }
    }
}

// Initialize tournament results when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    if (window.location.pathname.includes('/members/')) {
        window.tournamentResults = new TournamentResults();
    }
});

