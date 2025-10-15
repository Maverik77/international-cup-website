// Betting Admin JavaScript

class BettingAdmin {
    constructor() {
        this.betslips = [];
        this.apiConfig = this.getApiConfig();
        this.isAuthenticated = false;
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

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Password input enter key
        document.getElementById('admin-password').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.login();
            }
        });
    }

    async login() {
        const password = document.getElementById('admin-password').value;
        const errorElement = document.getElementById('password-error');
        
        if (!password) {
            errorElement.textContent = 'Please enter a password';
            return;
        }

        try {
            // Test authentication by trying to fetch betslips
            const response = await fetch(`${this.apiConfig.restApi}/betslips`, {
                headers: {
                    'Authorization': `Bearer ${password}`
                }
            });

            if (response.ok) {
                this.isAuthenticated = true;
                document.getElementById('password-section').style.display = 'none';
                document.getElementById('admin-interface').style.display = 'block';
                await this.loadBetslips();
            } else {
                errorElement.textContent = 'Invalid password';
            }
        } catch (error) {
            console.error('Login error:', error);
            errorElement.textContent = 'Login failed. Please try again.';
        }
    }

    async loadBetslips() {
        const contentElement = document.getElementById('betslips-content');
        
        try {
            const password = document.getElementById('admin-password').value;
            const response = await fetch(`${this.apiConfig.restApi}/betslips`, {
                headers: {
                    'Authorization': `Bearer ${password}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            this.betslips = data.betslips || [];
            this.renderBetslips();

        } catch (error) {
            console.error('Error loading betslips:', error);
            contentElement.innerHTML = `
                <div class="error">
                    Failed to load bet slips. Please refresh the page.
                </div>
            `;
        }
    }

    renderBetslips() {
        const contentElement = document.getElementById('betslips-content');
        
        if (this.betslips.length === 0) {
            contentElement.innerHTML = `
                <div class="no-betslips">
                    <p>No bet slips found.</p>
                </div>
            `;
            return;
        }

        const tableHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Bet Slip ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Total Amount</th>
                        <th># Bets</th>
                        <th>Paid Status</th>
                        <th>Submitted</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.betslips.map(betslip => `
                        <tr>
                            <td class="betslip-id">${betslip.betslipId}</td>
                            <td>${betslip.name}</td>
                            <td>${betslip.email}</td>
                            <td>$${betslip.totalAmount}</td>
                            <td>${betslip.betCount}</td>
                            <td>
                                <button class="paid-toggle ${betslip.isPaid ? '' : 'unpaid'}" 
                                        onclick="bettingAdmin.togglePaidStatus('${betslip.betslipId}', ${!betslip.isPaid})">
                                    ${betslip.isPaid ? 'Paid' : 'Unpaid'}
                                </button>
                            </td>
                            <td>${new Date(betslip.timestamp).toLocaleDateString()}</td>
                            <td>
                                <button class="view-details-btn" onclick="bettingAdmin.viewBetslipDetails('${betslip.betslipId}')">
                                    View Details
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        contentElement.innerHTML = tableHTML;
    }

    async togglePaidStatus(betslipId, newPaidStatus) {
        try {
            const password = document.getElementById('admin-password').value;
            const response = await fetch(`${this.apiConfig.restApi}/betslips/${betslipId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${password}`
                },
                body: JSON.stringify({ isPaid: newPaidStatus })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Update local data
            const betslip = this.betslips.find(b => b.betslipId === betslipId);
            if (betslip) {
                betslip.isPaid = newPaidStatus;
            }

            // Re-render table
            this.renderBetslips();

        } catch (error) {
            console.error('Error updating paid status:', error);
            alert('Failed to update paid status. Please try again.');
        }
    }

    async viewBetslipDetails(betslipId) {
        try {
            const password = document.getElementById('admin-password').value;
            const response = await fetch(`${this.apiConfig.restApi}/betslips`, {
                headers: {
                    'Authorization': `Bearer ${password}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const betslip = data.betslips.find(b => b.betslipId === betslipId);
            
            if (!betslip) {
                alert('Bet slip not found');
                return;
            }

            this.showBetslipModal(betslip);

        } catch (error) {
            console.error('Error loading betslip details:', error);
            alert('Failed to load bet slip details. Please try again.');
        }
    }

    showBetslipModal(betslip) {
        const modal = document.getElementById('betslip-modal');
        const detailsElement = document.getElementById('betslip-details');

        const betsHTML = (betslip.bets || []).map(bet => `
            <div class="bet-item">
                <div class="bet-match">${bet.matchLabel || ('Match ' + bet.matchId)}</div>
                <div class="bet-team" style="font-weight: 600; color: #667eea; margin-bottom: 0.5rem;">
                    Betting on: ${bet.team}
                </div>
                <div class="bet-team" style="margin-bottom: 0.25rem;">
                    🇺🇸 USA: ${bet.usaPlayers || 'TBD'}
                </div>
                <div class="bet-team" style="margin-bottom: 0.5rem;">
                    🌍 International: ${bet.intlPlayers || 'TBD'}
                </div>
                <div class="bet-amount">$${bet.amount}</div>
            </div>
        `).join('');

        detailsElement.innerHTML = `
            <div class="betslip-info">
                <h3>Bet Slip Information</h3>
                <div class="info-row">
                    <span class="info-label">Bet Slip ID:</span>
                    <span>${betslip.betslipId}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Name:</span>
                    <span>${betslip.name}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Email:</span>
                    <span>${betslip.email}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Total Amount:</span>
                    <span>$${betslip.totalAmount}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Paid Status:</span>
                    <span>${betslip.isPaid ? 'Paid' : 'Unpaid'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Submitted:</span>
                    <span>${new Date(betslip.timestamp).toLocaleString()}</span>
                </div>
            </div>
            <div class="bets-list">
                <h3>Individual Bets</h3>
                ${betsHTML}
            </div>
        `;

        modal.style.display = 'flex';
    }

    closeBetslipModal() {
        document.getElementById('betslip-modal').style.display = 'none';
    }
}

// Global functions
function login() {
    bettingAdmin.login();
}

function closeBetslipModal() {
    bettingAdmin.closeBetslipModal();
}

// Initialize betting admin when page loads
let bettingAdmin;
document.addEventListener('DOMContentLoaded', () => {
    bettingAdmin = new BettingAdmin();
});
