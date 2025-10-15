// Betting Lookup JavaScript

class BettingLookup {
    constructor() {
        this.apiConfig = this.getApiConfig();
        this.init();
    }

    getApiConfig() {
        // Detect environment from URL
        const isStaging = window.location.origin.includes('staging');
        return {
            restApi: isStaging 
                ? 'https://9iz68mvngi.execute-api.us-east-1.amazonaws.com/prod'
                : 'https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod'
        };
    }

    init() {
        // Allow lookup on Enter key
        document.getElementById('betslip-id').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.lookupBetslip();
            }
        });

        // Check URL for betslip ID parameter
        const urlParams = new URLSearchParams(window.location.search);
        const betslipId = urlParams.get('id');
        if (betslipId) {
            document.getElementById('betslip-id').value = betslipId;
            this.lookupBetslip();
        }
    }

    async lookupBetslip() {
        const betslipIdInput = document.getElementById('betslip-id');
        const betslipId = betslipIdInput.value.trim();
        const errorMessage = document.getElementById('error-message');
        const resultContainer = document.getElementById('betslip-result');

        // Hide previous results/errors
        errorMessage.classList.remove('show');
        resultContainer.classList.remove('show');

        if (!betslipId) {
            this.showError('Please enter a bet slip ID');
            return;
        }

        // Show loading state
        resultContainer.innerHTML = `
            <div class="loading">
                <div class="loading-spinner"></div>
                <p>Looking up your bet slip...</p>
            </div>
        `;
        resultContainer.classList.add('show');

        try {
            const response = await fetch(`${this.apiConfig.restApi}/betslips/${betslipId}`);

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('Bet slip not found. Please check your ID and try again.');
                }
                throw new Error('Failed to load bet slip. Please try again.');
            }

            const data = await response.json();
            this.displayBetslip(data.betslip);

        } catch (error) {
            console.error('Error looking up betslip:', error);
            resultContainer.classList.remove('show');
            this.showError(error.message);
        }
    }

    displayBetslip(betslip) {
        const resultContainer = document.getElementById('betslip-result');

        // Calculate statistics
        const totalBets = betslip.bets.length;
        const wonBets = betslip.bets.filter(b => b.status === 'won').length;
        const lostBets = betslip.bets.filter(b => b.status === 'lost').length;
        const openBets = betslip.bets.filter(b => !b.status || b.status === 'open').length;

        // Calculate winnings (assume 2:1 payout for won bets)
        const totalWagered = betslip.totalAmount;
        const totalWon = betslip.bets
            .filter(b => b.status === 'won')
            .reduce((sum, b) => sum + (b.amount * 2), 0);
        const netAmount = totalWon - totalWagered;

        const statusBadge = betslip.isPaid 
            ? '<span class="status-badge status-paid">✓ Paid</span>'
            : '<span class="status-badge status-unpaid">⚠ Unpaid</span>';

        const betsHTML = betslip.bets.map(bet => {
            const status = bet.status || 'open';
            const statusClass = status.toLowerCase();
            const statusText = status.charAt(0).toUpperCase() + status.slice(1);

            return `
                <div class="bet-card">
                    <div class="bet-match-info">
                        ${bet.matchLabel || 'Match ' + bet.matchId}
                    </div>
                    <div class="bet-team-info">
                        🇺🇸 USA: ${bet.usaPlayers || 'TBD'}
                    </div>
                    <div class="bet-team-info">
                        🌍 International: ${bet.intlPlayers || 'TBD'}
                    </div>
                    <div class="bet-selection">
                        <strong>Your Bet:</strong> ${bet.team}
                    </div>
                    <div class="bet-footer">
                        <span class="bet-amount">$${bet.amount}</span>
                        <span class="bet-status ${statusClass}">${statusText}</span>
                    </div>
                </div>
            `;
        }).join('');

        resultContainer.innerHTML = `
            <div class="betslip-header">
                <h2>Your Bet Slip</h2>
                <div class="info-row">
                    <span class="info-label">Bet Slip ID:</span>
                    <span>${betslip.betslipId}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Name:</span>
                    <span>${betslip.name}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Total Amount:</span>
                    <span>$${betslip.totalAmount}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Payment Status:</span>
                    <span>${statusBadge}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Submitted:</span>
                    <span>${new Date(betslip.timestamp).toLocaleString()}</span>
                </div>
            </div>

            <div class="bets-section">
                <h3>Your Bets (${totalBets})</h3>
                ${betsHTML}
            </div>

            <div class="summary-stats">
                <div class="stat-box">
                    <div class="stat-label">Open</div>
                    <div class="stat-value">${openBets}</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">Won</div>
                    <div class="stat-value" style="color: #48bb78;">${wonBets}</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">Lost</div>
                    <div class="stat-value" style="color: #fc8181;">${lostBets}</div>
                </div>
                <div class="stat-box">
                    <div class="stat-label">Net ${netAmount >= 0 ? 'Winnings' : 'Loss'}</div>
                    <div class="stat-value" style="color: ${netAmount >= 0 ? '#48bb78' : '#fc8181'};">
                        ${netAmount >= 0 ? '+' : ''}$${netAmount}
                    </div>
                </div>
            </div>
        `;

        resultContainer.classList.add('show');
    }

    showError(message) {
        const errorMessage = document.getElementById('error-message');
        errorMessage.textContent = message;
        errorMessage.classList.add('show');
    }
}

// Global function for onclick
function lookupBetslip() {
    bettingLookup.lookupBetslip();
}

// Initialize lookup system when page loads
let bettingLookup;
document.addEventListener('DOMContentLoaded', () => {
    bettingLookup = new BettingLookup();
});

