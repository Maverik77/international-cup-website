// Betting Page JavaScript

class BettingSystem {
    constructor() {
        this.selectedBets = [];
        this.pairings = [];
        this.players = [];
        this.apiConfig = this.getApiConfig();
        this.init();
    }

    getApiConfig() {
        // Prefer staging first, then production as failover
        return {
            stagingRest: 'https://9iz68mvngi.execute-api.us-east-1.amazonaws.com/prod',
            prodRest: 'https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod'
        };
    }

    async init() {
        await Promise.all([
            this.loadPlayers(),
            this.loadPairings()
        ]);
        this.setupEventListeners();
        this.updateBetSlip();
    }

    async loadPlayers() {
        try {
            const data = await this.fetchJsonWithFailover('/players');
            this.players = Array.isArray(data.players) ? data.players : [];
        } catch (err) {
            console.error('Error loading players:', err);
            this.players = [];
        }
    }

    async loadPairings() {
        try {
            const data = await this.fetchJsonWithFailover('/pairings');
            this.pairings = data.pairings || [];
            this.renderPairings();
        } catch (error) {
            console.error('Error loading pairings:', error);
            this.showError('Failed to load pairings. Please refresh the page.');
        }
    }

    async fetchJsonWithFailover(path) {
        // Staging only per environment isolation
        const endpoints = [this.apiConfig.stagingRest];
        let lastError;
        for (const base of endpoints) {
            try {
                const resp = await fetch(`${base}${path}`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                return await resp.json();
            } catch (e) {
                lastError = e;
            }
        }
        throw lastError || new Error('All endpoints failed');
    }

    renderPairings() {
        const day1 = this.getMatchesByDay(1);
        const day2 = this.getMatchesByDay(2);
        this.updateStatsBanner(day1.length, day2.length, (this.pairings || []).length);
        this.renderDayMatches(1, 'Day 1');
        this.renderDayMatches(2, 'Day 2');
    }

    getMatchesByDay(dayNumber) {
        return (this.pairings || []).filter(p => Number(p.day) === dayNumber);
    }

    renderDayMatches(dayNumber, dayLabel) {
        const container = document.getElementById(`${dayNumber === 1 ? 'day1' : 'day2'}-matches`);
        if (!container) return;

        const dayMatches = this.getMatchesByDay(dayNumber);
        
        if (dayMatches.length === 0) {
            container.innerHTML = `<p class="no-matches">No ${dayLabel} matches available yet.</p>`;
            return;
        }

        container.innerHTML = dayMatches.map(match => this.createMatchCard(match)).join('');
    }

    createMatchCard(match) {
        const isTeamMatch = match.type === 'team';

        // Resolve player IDs to names from loaded players list
        const resolveName = (playerId) => {
            if (!playerId) return 'TBD';
            const p = this.players.find(pl => pl.id === playerId);
            if (!p) return 'TBD';
            const first = p.firstName || p.first_name || '';
            const last = p.lastName || p.last_name || '';
            return `${first} ${last}`.trim() || 'TBD';
        };

        let usaPlayerNames = '';
        let intlPlayerNames = '';

        if (isTeamMatch) {
            usaPlayerNames = [
                resolveName(match.usa_team?.player1_id),
                resolveName(match.usa_team?.player2_id)
            ].filter(Boolean).join(' & ');
            intlPlayerNames = [
                resolveName(match.intl_team?.player1_id),
                resolveName(match.intl_team?.player2_id)
            ].filter(Boolean).join(' & ');
        } else {
            usaPlayerNames = resolveName(match.usa_player_id);
            intlPlayerNames = resolveName(match.intl_player_id);
        }

        return `
            <div class="match-card" data-match-id="${match.id}">
                <div class="match-header">
                    <span class="match-number">${match.match_number}</span>
                    <span class="match-type">${isTeamMatch ? 'Team Match' : 'Singles'}</span>
                </div>
                <div class="match-teams">
                    <div class="team-row">
                        <span class="team-name">🇺🇸 USA</span>
                        <span class="team-players">${usaPlayerNames}</span>
                    </div>
                    <div class="team-row">
                        <span class="team-name">🌍 International</span>
                        <span class="team-players">${intlPlayerNames}</span>
                    </div>
                </div>
                <div class="bet-buttons">
                    <button class="bet-btn" data-match-id="${match.id}" data-team="USA" data-amount="10" onclick="bettingSystem.addBet('${match.id}', 'USA', 10)">
                        $10 USA
                    </button>
                    <button class="bet-btn" data-match-id="${match.id}" data-team="USA" data-amount="20" onclick="bettingSystem.addBet('${match.id}', 'USA', 20)">
                        $20 USA
                    </button>
                    <button class="bet-btn" data-match-id="${match.id}" data-team="International" data-amount="10" onclick="bettingSystem.addBet('${match.id}', 'International', 10)">
                        $10 INT
                    </button>
                    <button class="bet-btn" data-match-id="${match.id}" data-team="International" data-amount="20" onclick="bettingSystem.addBet('${match.id}', 'International', 20)">
                        $20 INT
                    </button>
                </div>
            </div>
        `;
    }

    addBet(matchId, team, amount) {
        // Check if bet already exists for this match
        const existingBetIndex = this.selectedBets.findIndex(bet => bet.matchId === matchId);
        
        if (existingBetIndex !== -1) {
            // Replace existing bet
            this.selectedBets[existingBetIndex] = { matchId, team, amount };
        } else {
            // Add new bet
            this.selectedBets.push({ matchId, team, amount });
        }

        this.updateBetSlip();
        this.updateBetButtons();
    }

    removeBet(matchId) {
        this.selectedBets = this.selectedBets.filter(bet => bet.matchId !== matchId);
        this.updateBetSlip();
        this.updateBetButtons();
    }

    updateBetButtons() {
        // Reset all bet buttons
        document.querySelectorAll('.bet-btn').forEach(btn => {
            btn.classList.remove('selected');
        });

        // Mark selected bets
        this.selectedBets.forEach(bet => {
            const btn = document.querySelector(`[data-match-id="${bet.matchId}"][data-team="${bet.team}"][data-amount="${bet.amount}"]`);
            if (btn) {
                btn.classList.add('selected');
            }
        });
    }

    updateBetSlip() {
        const container = document.getElementById('selected-bets');
        const totalElement = document.getElementById('total-amount');
        const submitBtn = document.getElementById('submit-bets');

        if (this.selectedBets.length === 0) {
            container.innerHTML = '<p class="no-bets">No bets selected yet</p>';
            totalElement.textContent = '$0';
            submitBtn.disabled = true;
            return;
        }

        const totalAmount = this.selectedBets.reduce((sum, bet) => sum + bet.amount, 0);
        
        container.innerHTML = this.selectedBets.map((bet, index) => {
            const match = this.pairings.find(p => p.id === bet.matchId);
            const matchLabel = match ? `Match ${match.match_number}` : 'Unknown Match';
            
            // Get player names for this match
            const resolveName = (playerId) => {
                if (!playerId) return 'TBD';
                const p = this.players.find(pl => pl.id === playerId);
                if (!p) return 'TBD';
                const first = p.firstName || p.first_name || '';
                const last = p.lastName || p.last_name || '';
                return `${first} ${last}`.trim() || 'TBD';
            };

            let usaPlayerNames = '';
            let intlPlayerNames = '';
            
            if (match) {
                const isTeamMatch = match.type === 'team';
                if (isTeamMatch) {
                    usaPlayerNames = [
                        resolveName(match.usa_team?.player1_id),
                        resolveName(match.usa_team?.player2_id)
                    ].filter(Boolean).join(' & ');
                    intlPlayerNames = [
                        resolveName(match.intl_team?.player1_id),
                        resolveName(match.intl_team?.player2_id)
                    ].filter(Boolean).join(' & ');
                } else {
                    usaPlayerNames = resolveName(match.usa_player_id);
                    intlPlayerNames = resolveName(match.intl_player_id);
                }
            }
            
            return `
                <div class="bet-item">
                    <div class="bet-match">${matchLabel}</div>
                    <div class="bet-team">${bet.team} - ${bet.team === 'USA' ? usaPlayerNames : intlPlayerNames}</div>
                    <div class="bet-amount">$${bet.amount}</div>
                    <button class="bet-remove" onclick="bettingSystem.removeBet('${bet.matchId}')">&times;</button>
                </div>
            `;
        }).join('');

        totalElement.textContent = `$${totalAmount}`;
        submitBtn.disabled = false;
    }

    setupEventListeners() {
        // Clear all bets
        document.getElementById('clear-bets').addEventListener('click', () => {
            this.selectedBets = [];
            this.updateBetSlip();
            this.updateBetButtons();
        });

        // Submit bets
        document.getElementById('submit-bets').addEventListener('click', () => {
            this.submitBets();
        });

        // Form validation
        const nameInput = document.getElementById('bettor-name');
        const emailInput = document.getElementById('bettor-email');
        
        [nameInput, emailInput].forEach(input => {
            input.addEventListener('input', () => {
                this.validateForm();
            });
        });
    }

    validateForm() {
        const name = document.getElementById('bettor-name').value.trim();
        const email = document.getElementById('bettor-email').value.trim();
        const submitBtn = document.getElementById('submit-bets');
        
        const isValid = name.length > 0 && email.length > 0 && this.selectedBets.length > 0;
        submitBtn.disabled = !isValid;
    }

    async submitBets() {
        const name = document.getElementById('bettor-name').value.trim();
        const email = document.getElementById('bettor-email').value.trim();

        if (!name || !email || this.selectedBets.length === 0) {
            this.showError('Please fill in all required fields and select at least one bet.');
            return;
        }

        // Show loading overlay
        document.getElementById('loading-overlay').style.display = 'flex';

        try {
            // Enrich bets with player names and match label for storage/display
            const enrichBet = (bet) => {
                const pairing = this.pairings.find(p => p.id === bet.matchId) || {};
                const isTeam = pairing.type === 'team';

                const resolveName = (playerId) => {
                    if (!playerId) return 'TBD';
                    const p = this.players.find(pl => pl.id === playerId);
                    if (!p) return 'TBD';
                    const first = p.firstName || p.first_name || '';
                    const last = p.lastName || p.last_name || '';
                    return `${first} ${last}`.trim() || 'TBD';
                };

                const usaPlayers = isTeam
                    ? [resolveName(pairing.usa_team?.player1_id), resolveName(pairing.usa_team?.player2_id)].join(' & ')
                    : resolveName(pairing.usa_player_id);

                const intlPlayers = isTeam
                    ? [resolveName(pairing.intl_team?.player1_id), resolveName(pairing.intl_team?.player2_id)].join(' & ')
                    : resolveName(pairing.intl_player_id);

                const matchLabel = pairing.match_number ? `Match ${pairing.match_number}` : 'Match';

                return {
                    matchId: bet.matchId,
                    team: bet.team,
                    amount: bet.amount,
                    matchLabel,
                    usaPlayers,
                    intlPlayers
                };
            };

            const betslipData = {
                name,
                email,
                bets: this.selectedBets.map(enrichBet)
            };

            const response = await fetch(`${this.apiConfig.stagingRest}/betslips`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(betslipData)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            this.showSuccessModal(result);

        } catch (error) {
            console.error('Error submitting bets:', error);
            this.showError('Failed to submit bets. Please try again.');
        } finally {
            document.getElementById('loading-overlay').style.display = 'none';
        }
    }

    showSuccessModal(result) {
        const modal = document.getElementById('success-modal');
        const betslipId = document.getElementById('betslip-id');
        const modalTotal = document.getElementById('modal-total');
        const paymentNoteId = document.getElementById('payment-note-id');
        const venmoLink = document.getElementById('venmo-link');
        const paypalLink = document.getElementById('paypal-link');
        const viewBetslipLink = document.getElementById('view-betslip-link');

        betslipId.textContent = result.betslipId;
        modalTotal.textContent = `$${result.totalAmount}`;
        paymentNoteId.textContent = result.betslipId;

        venmoLink.href = result.paymentUrls.venmo;
        paypalLink.href = result.paymentUrls.paypal;
        viewBetslipLink.href = `lookup.html?id=${result.betslipId}`;

        modal.style.display = 'flex';
    }

    showError(message) {
        alert(message); // Simple error display for now
    }

    updateStatsBanner(day1Count, day2Count, total) {
        const el = document.getElementById('pairings-stats');
        if (!el) return;
        el.style.display = 'block';
        el.textContent = `Loaded pairings: Day 1 = ${day1Count}, Day 2 = ${day2Count}, Total = ${total}`;
    }
}

// Global functions for modal
function closeSuccessModal() {
    document.getElementById('success-modal').style.display = 'none';
    // Reset form
    bettingSystem.selectedBets = [];
    bettingSystem.updateBetSlip();
    bettingSystem.updateBetButtons();
    document.getElementById('bettor-name').value = '';
    document.getElementById('bettor-email').value = '';
}

// Initialize betting system when page loads
let bettingSystem;
document.addEventListener('DOMContentLoaded', () => {
    bettingSystem = new BettingSystem();
});
