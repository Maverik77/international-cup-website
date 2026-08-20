// Betting Admin JavaScript

class BettingAdmin {
    constructor() {
        this.betslips = [];
        this.apiConfig = this.getApiConfig();
        this.isAuthenticated = false;
        this.matchResults = {};
        this.currentPairings = [];
        this.payouts = [];
        this.currentTab = 'betslips';
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
                                <button class="delete-btn" 
                                        onclick="bettingAdmin.deleteBetslip('${betslip.betslipId}', '${betslip.name}')">
                                    Delete
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

            // Reload the betslips list
            await this.loadBetslips();

        } catch (error) {
            console.error('Error updating paid status:', error);
            alert('Failed to update paid status. Please try again.');
        }
    }

    async togglePaidOutStatus(betslipId, newPaidOutStatus) {
        try {
            const password = document.getElementById('admin-password').value;
            const response = await fetch(`${this.apiConfig.restApi}/betslips/${betslipId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${password}`
                },
                body: JSON.stringify({ isPaidOut: newPaidOutStatus })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Reload the payouts list
            await this.loadPayouts();

        } catch (error) {
            console.error('Error updating payout status:', error);
            alert('Failed to update payout status. Please try again.');
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

            await this.showBetslipModal(betslip);

        } catch (error) {
            console.error('Error loading betslip details:', error);
            alert('Failed to load bet slip details. Please try again.');
        }
    }

    async showBetslipModal(betslip) {
        const modal = document.getElementById('betslip-modal');
        const detailsElement = document.getElementById('betslip-details');

        // Fetch match results to determine actual bet status
        let matchResults = {};
        try {
            const password = document.getElementById('admin-password').value;
            const resultsResponse = await fetch(`${this.apiConfig.restApi}/match-results`, {
                headers: { 'Authorization': `Bearer ${password}` }
            });
            if (resultsResponse.ok) {
                const resultsData = await resultsResponse.json();
                matchResults = resultsData.results || {};
            }
        } catch (error) {
            console.error('Error fetching match results:', error);
        }

        const betsHTML = (betslip.bets || []).map((bet, index) => {
            // Determine actual status based on match result
            let status = 'open';
            const matchResult = matchResults[bet.matchId];
            
            if (matchResult) {
                if (matchResult === 'Tie') {
                    status = 'tied';
                } else if (bet.team === matchResult) {
                    status = 'won';
                } else {
                    status = 'lost';
                }
            }
            
            // Status badge styling
            const statusConfig = {
                'open': { bg: '#e6fffa', color: '#234e52', border: '#81e6d9', label: '⏳ Open' },
                'won': { bg: '#c6f6d5', color: '#22543d', border: '#48bb78', label: '✅ Won' },
                'lost': { bg: '#fed7d7', color: '#742a2a', border: '#fc8181', label: '❌ Lost' },
                'tied': { bg: '#fef3c7', color: '#78350f', border: '#fbbf24', label: '🤝 Tie/Push' }
            };
            
            const config = statusConfig[status] || statusConfig['open'];
            
            return `
            <div class="bet-item" style="position: relative;">
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
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.75rem;">
                    <div class="bet-amount">$${bet.amount}</div>
                    <div style="padding: 0.5rem 1rem; background: ${config.bg}; color: ${config.color}; border: 2px solid ${config.border}; border-radius: 6px; font-weight: 600; font-size: 0.9rem;">
                        ${config.label}
                    </div>
                </div>
            </div>
        `;
        }).join('');

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

    async updateBetStatus(betslipId, betIndex, status) {
        try {
            const password = document.getElementById('admin-password').value;
            const response = await fetch(`${this.apiConfig.restApi}/betslips/${betslipId}/bets/${betIndex}/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${password}`
                },
                body: JSON.stringify({ status })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Reload the betslip details to show updated status
            await this.viewBetslipDetails(betslipId);

            // Also reload the main list
            await this.loadBetslips();

        } catch (error) {
            console.error('Error updating bet status:', error);
            alert('Failed to update bet status. Please try again.');
        }
    }

    async deleteBetslip(betslipId, betslipName) {
        // Confirm deletion
        const confirmed = confirm(`Are you sure you want to delete the bet slip for ${betslipName}?\n\nBet Slip ID: ${betslipId}\n\nThis action cannot be undone.`);
        
        if (!confirmed) {
            return;
        }

        try {
            const password = document.getElementById('admin-password').value;
            const response = await fetch(`${this.apiConfig.restApi}/betslips/${betslipId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${password}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Show success message
            alert(`Bet slip for ${betslipName} has been deleted successfully.`);

            // Reload the betslips list
            await this.loadBetslips();

        } catch (error) {
            console.error('Error deleting betslip:', error);
            alert('Failed to delete bet slip. Please try again.');
        }
    }

    closeBetslipModal() {
        document.getElementById('betslip-modal').style.display = 'none';
    }

    async switchTab(tabName, event) {
        // Hide all tabs
        document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
        
        // Show selected tab
        document.getElementById(`${tabName}-tab`).style.display = 'block';
        if (event && event.target) {
            event.target.classList.add('active');
        }
        this.currentTab = tabName;
        
        // Load data for tab
        if (tabName === 'results') {
            await this.loadMatchResults();
        } else if (tabName === 'payouts') {
            await this.loadPayouts();
        }
    }

    async loadMatchResults() {
        const resultsContent = document.getElementById('results-content');
        resultsContent.innerHTML = '<div class="loading">Loading match results...</div>';
        
        try {
            const password = document.getElementById('admin-password').value;
            
            // Fetch pairings, players, and existing results in parallel
            const [pairingsResponse, playersResponse, resultsResponse] = await Promise.all([
                fetch(`${this.apiConfig.restApi}/pairings`),
                fetch(`${this.apiConfig.restApi}/players`),
                fetch(`${this.apiConfig.restApi}/match-results`, {
                    headers: { 'Authorization': `Bearer ${password}` }
                })
            ]);
            
            const pairingsData = await pairingsResponse.json();
            const playersData = await playersResponse.json();
            
            // Get existing match results
            if (resultsResponse.ok) {
                const resultsData = await resultsResponse.json();
                this.matchResults = resultsData.results || {};
            } else {
                this.matchResults = {};
            }
            
            // Build player lookup map
            const playerMap = {};
            (playersData.players || []).forEach(player => {
                playerMap[player.id] = `${player.firstName} ${player.lastName}`;
            });
            
            // Get all Day 1 and Day 2 matches from pairings with player names
            this.currentMatches = (pairingsData.pairings || [])
                .filter(pairing => pairing.day === 1 || pairing.day === 2)
                .map(pairing => {
                    // Get player names - handle both single players and teams
                    let usaPlayers = 'TBD';
                    let intlPlayers = 'TBD';
                    
                    if (pairing.type === 'team') {
                        // Team matches - players nested in usa_team/intl_team objects
                        if (pairing.usa_team) {
                            const p1 = playerMap[pairing.usa_team.player1_id] || 'TBD';
                            const p2 = playerMap[pairing.usa_team.player2_id] || 'TBD';
                            usaPlayers = `${p1} & ${p2}`;
                        }
                        if (pairing.intl_team) {
                            const p1 = playerMap[pairing.intl_team.player1_id] || 'TBD';
                            const p2 = playerMap[pairing.intl_team.player2_id] || 'TBD';
                            intlPlayers = `${p1} & ${p2}`;
                        }
                    } else {
                        // Singles matches - direct player_id fields
                        if (pairing.usa_player_id) {
                            usaPlayers = playerMap[pairing.usa_player_id] || 'TBD';
                        }
                        if (pairing.intl_player_id) {
                            intlPlayers = playerMap[pairing.intl_player_id] || 'TBD';
                        }
                    }
                    
                    const matchType = pairing.type ? ` (${pairing.type})` : '';
                    return {
                        id: pairing.id,
                        matchLabel: `Match ${pairing.match_number} - Day ${pairing.day}${matchType}`,
                        usaPlayers: usaPlayers,
                        intlPlayers: intlPlayers,
                        day: pairing.day,
                        match_number: pairing.match_number
                    };
                });
            
            // Render match results form
            this.renderMatchResults();
            
        } catch (error) {
            console.error('Error loading match results:', error);
            resultsContent.innerHTML = '<div class="error">Failed to load match results. Please try again.</div>';
        }
    }

    renderMatchResults() {
        if (!this.currentMatches || this.currentMatches.length === 0) {
            document.getElementById('results-content').innerHTML = '<div class="no-betslips">No matches found.</div>';
            return;
        }
        
        // Sort by day and match number
        const sortedMatches = [...this.currentMatches].sort((a, b) => {
            if (a.day !== b.day) return a.day - b.day;
            return a.match_number - b.match_number;
        });
        
        const resultsHTML = sortedMatches.map(match => {
            const currentResult = this.matchResults[match.id] || 'none';
            return `
                <div class="match-result-item">
                    <div class="match-label">
                        <strong>${match.matchLabel}</strong><br>
                        <span style="color: #c8102e;">🇺🇸 ${match.usaPlayers}</span> vs 
                        <span style="color: #007bff;">🌍 ${match.intlPlayers}</span>
                    </div>
                    <div class="result-buttons">
                        <button class="result-btn ${currentResult === 'USA' ? 'active' : ''}" 
                                onclick="bettingAdmin.setMatchResult('${match.id}', 'USA')">
                            🇺🇸 USA Wins
                        </button>
                        <button class="result-btn ${currentResult === 'International' ? 'active' : ''}"
                                onclick="bettingAdmin.setMatchResult('${match.id}', 'International')">
                            🌍 International Wins
                        </button>
                        <button class="result-btn ${currentResult === 'Tie' ? 'active' : ''}"
                                onclick="bettingAdmin.setMatchResult('${match.id}', 'Tie')">
                            🤝 Tie
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        document.getElementById('results-content').innerHTML = resultsHTML;
    }

    setMatchResult(matchId, winner) {
        this.matchResults[matchId] = winner;
        this.renderMatchResults(); // Re-render to show active state
    }

    async saveMatchResults() {
        try {
            const password = document.getElementById('admin-password').value;
            const response = await fetch(`${this.apiConfig.restApi}/match-results`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${password}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ results: this.matchResults })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            alert('Match results saved successfully!');
            
        } catch (error) {
            console.error('Error saving match results:', error);
            alert('Failed to save match results. Please try again.');
        }
    }

    async loadPayouts() {
        const payoutsContent = document.getElementById('payouts-content');
        const payoutSummary = document.getElementById('payout-summary');
        
        payoutsContent.innerHTML = '<div class="loading">Loading payouts...</div>';
        payoutSummary.innerHTML = '';
        
        try {
            const password = document.getElementById('admin-password').value;
            const response = await fetch(`${this.apiConfig.restApi}/betting/payouts`, {
                headers: { 'Authorization': `Bearer ${password}` }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            this.payouts = data.payouts || [];
            
            // Calculate summary
            const summary = data.summary || {};
            const totalPool = summary.totalPool || 0;
            const totalWinning = summary.totalWinning || 0;
            const totalTied = summary.totalTied || 0;
            const payablePool = summary.payablePool || 0;
            const multiplier = summary.multiplier || 0;
            
            // Render summary
            payoutSummary.innerHTML = `
                <div class="payout-summary-box">
                    <div class="summary-stat">
                        <label>Total Pool</label>
                        <value>$${totalPool.toFixed(2)}</value>
                    </div>
                    <div class="summary-stat">
                        <label>Winning Bets Total</label>
                        <value>$${totalWinning.toFixed(2)}</value>
                    </div>
                    <div class="summary-stat">
                        <label>Tied Bets Total</label>
                        <value>$${totalTied.toFixed(2)}</value>
                    </div>
                    <div class="summary-stat">
                        <label>Payable Pool</label>
                        <value>$${payablePool.toFixed(2)}</value>
                    </div>
                    <div class="summary-stat highlight">
                        <label>Payout Multiplier</label>
                        <value>${multiplier.toFixed(3)}x</value>
                    </div>
                </div>
            `;
            
            this.renderPayouts();
            
        } catch (error) {
            console.error('Error loading payouts:', error);
            payoutsContent.innerHTML = '<div class="error">Failed to load payouts. Please try again.</div>';
        }
    }

    renderPayouts() {
        if (this.payouts.length === 0) {
            document.getElementById('payouts-content').innerHTML = '<div class="no-betslips">No betslips found or no match results entered yet.</div>';
            return;
        }
        
        // Count pending emails
        const pendingEmails = this.payouts.filter(p => !p.resultsEmailSent).length;
        
        const bulkActionsHTML = `
            <div class="bulk-actions">
                <button class="btn-bulk-email" 
                        onclick="bettingAdmin.bulkSendResultsEmails(false)"
                        ${pendingEmails === 0 ? 'disabled' : ''}>
                    📧 Send ${pendingEmails} Pending Email${pendingEmails !== 1 ? 's' : ''}
                </button>
                <button class="btn-bulk-email-all" onclick="bettingAdmin.bulkSendResultsEmails(true)">
                    📧 Resend All Emails (${this.payouts.length})
                </button>
            </div>
        `;
        
        const payoutsHTML = `
            ${bulkActionsHTML}
            <table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Bet Slip ID</th>
                        <th>Total Bet</th>
                        <th>Won Bets</th>
                        <th>Lost Bets</th>
                        <th>Tied Bets</th>
                        <th>Calculated Payout</th>
                        <th>Paid Status</th>
                        <th>Email Status</th>
                        <th>Payment Links</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${this.payouts.map(payout => {
                        const paymentLinksHTML = this.generatePaymentLinks(payout);
                        return `
                        <tr>
                            <td>${payout.name}</td>
                            <td class="betslip-id">${payout.betslipId}</td>
                            <td>$${payout.totalBetAmount.toFixed(2)}</td>
                            <td style="color: #48bb78; font-weight: 600;">$${payout.wonAmount.toFixed(2)}</td>
                            <td style="color: #e53e3e; font-weight: 600;">$${payout.lostAmount.toFixed(2)}</td>
                            <td style="color: #667eea; font-weight: 600;">$${payout.tiedAmount.toFixed(2)}</td>
                            <td class="payout-amount">$${payout.calculatedPayout.toFixed(2)}</td>
                            <td>
                                <button class="paid-toggle ${payout.isPaidOut ? '' : 'unpaid'}" 
                                        onclick="bettingAdmin.togglePaidOutStatus('${payout.betslipId}', ${!payout.isPaidOut})">
                                    ${payout.isPaidOut ? 'Paid Out' : 'Not Paid'}
                                </button>
                            </td>
                            <td>
                                <span class="${payout.resultsEmailSent ? 'email-sent' : 'email-pending'}">
                                    ${payout.resultsEmailSent ? '✅ Sent' : '⏳ Pending'}
                                </span>
                            </td>
                            <td>
                                ${paymentLinksHTML}
                            </td>
                            <td>
                                <button class="view-details-btn" onclick="bettingAdmin.viewBetslipDetails('${payout.betslipId}')">
                                    View Details
                                </button>
                                <button class="email-btn ${payout.resultsEmailSent ? 'resend' : ''}" 
                                        onclick="bettingAdmin.sendResultsEmail('${payout.betslipId}', ${payout.resultsEmailSent})">
                                    ${payout.resultsEmailSent ? 'Resend' : 'Send Email'}
                                </button>
                            </td>
                        </tr>
                    `;
                    }).join('')}
                </tbody>
            </table>
        `;
        
        document.getElementById('payouts-content').innerHTML = payoutsHTML;
    }

    async sendResultsEmail(betslipId, resend = false) {
        const action = resend ? 'resend' : 'send';
        if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} results email for betslip ${betslipId}?`)) {
            return;
        }
        
        try {
            const password = document.getElementById('admin-password').value;
            const response = await fetch(`${this.apiConfig.restApi}/betslips/send-results`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${password}`
                },
                body: JSON.stringify({ 
                    betslipIds: [betslipId],
                    resend: resend
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            alert(`Email sent successfully!\n\nSent: ${data.sent}\nFailed: ${data.failed}`);
            
            // Reload payouts to show updated status
            await this.loadPayouts();
            
        } catch (error) {
            console.error('Error sending results email:', error);
            alert('Failed to send email. Please try again.');
        }
    }

    async bulkSendResultsEmails(resendAll = false) {
        const betslipsToSend = resendAll 
            ? this.payouts.map(p => p.betslipId)
            : this.payouts.filter(p => !p.resultsEmailSent).map(p => p.betslipId);
        
        if (betslipsToSend.length === 0) {
            alert('No emails to send!');
            return;
        }
        
        const action = resendAll ? 'Resend' : 'Send';
        if (!confirm(`${action} results emails to ${betslipsToSend.length} bettor(s)?\n\nThis will send out emails with their betting results and payout information.`)) {
            return;
        }
        
        try {
            const password = document.getElementById('admin-password').value;
            const response = await fetch(`${this.apiConfig.restApi}/betslips/send-results`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${password}`
                },
                body: JSON.stringify({ 
                    betslipIds: betslipsToSend,
                    resend: resendAll
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            alert(`Email sending complete!\n\nSuccessfully sent: ${data.sent}\nFailed: ${data.failed}\nTotal attempted: ${data.total}`);
            
            // Reload payouts to show updated status
            await this.loadPayouts();
            
        } catch (error) {
            console.error('Error sending bulk emails:', error);
            alert('Failed to send emails. Please try again.');
        }
    }

    generatePaymentLinks(payout) {
        const amount = payout.calculatedPayout.toFixed(2);
        const links = [];
        
        // Venmo link
        if (payout.venmoUsername && payout.venmoUsername.trim() !== '') {
            const venmoUser = payout.venmoUsername.replace('@', '');
            const venmoUrl = `https://venmo.com/${venmoUser}?txn=pay&amount=${amount}&note=International%20Cup%20Betting%20Payout`;
            links.push(`<a href="${venmoUrl}" target="_blank" class="payment-link venmo">💸 Venmo</a>`);
        }
        
        // PayPal link
        if (payout.paypalUsername && payout.paypalUsername.trim() !== '') {
            const paypalUser = payout.paypalUsername;
            const paypalUrl = `https://www.paypal.com/paypalme/${paypalUser}/${amount}`;
            links.push(`<a href="${paypalUrl}" target="_blank" class="payment-link paypal">💳 PayPal</a>`);
        }
        
        // If no payment info, show "Add Info" button
        if (links.length === 0) {
            return `<div class="payment-links">
                <button class="payment-link add-info" onclick="bettingAdmin.openPaymentInfoModal('${payout.betslipId}', '${payout.name.replace(/'/g, "\\'")}', '', '')">
                    ➕ Add Payment Info
                </button>
            </div>`;
        }
        
        // Show links + edit button
        return `<div class="payment-links">
            ${links.join('')}
            <button class="payment-link add-info" 
                    onclick="bettingAdmin.openPaymentInfoModal('${payout.betslipId}', '${payout.name.replace(/'/g, "\\'")}', '${payout.venmoUsername || ''}', '${payout.paypalUsername || ''}')">
                ✏️
            </button>
        </div>`;
    }

    openPaymentInfoModal(betslipId, name, venmoUsername, paypalUsername) {
        // Store current betslip ID for saving later
        this.currentPaymentBetslipId = betslipId;
        
        // Populate modal
        document.getElementById('payment-betslip-name').value = name;
        document.getElementById('venmo-username').value = venmoUsername || '';
        document.getElementById('paypal-username').value = paypalUsername || '';
        
        // Show modal
        document.getElementById('payment-info-modal').style.display = 'flex';
    }

    closePaymentInfoModal() {
        document.getElementById('payment-info-modal').style.display = 'none';
        this.currentPaymentBetslipId = null;
    }

    async savePaymentInfo() {
        const betslipId = this.currentPaymentBetslipId;
        if (!betslipId) {
            alert('Error: No betslip selected');
            return;
        }

        const venmoUsername = document.getElementById('venmo-username').value.trim();
        const paypalUsername = document.getElementById('paypal-username').value.trim();

        try {
            const password = document.getElementById('admin-password').value;
            const response = await fetch(`${this.apiConfig.restApi}/betslips/${betslipId}/payment-info`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${password}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    venmoUsername,
                    paypalUsername
                })
            });

            if (!response.ok) {
                throw new Error('Failed to update payment info');
            }

            // Update local payout data
            const payout = this.payouts.find(p => p.betslipId === betslipId);
            if (payout) {
                payout.venmoUsername = venmoUsername;
                payout.paypalUsername = paypalUsername;
            }

            // Re-render payouts table
            this.renderPayouts();

            // Close modal
            this.closePaymentInfoModal();

            alert('Payment information updated successfully!');

        } catch (error) {
            console.error('Error saving payment info:', error);
            alert('Failed to save payment info. Please try again.');
        }
    }
}

// Global functions
function login() {
    bettingAdmin.login();
}

function closeBetslipModal() {
    bettingAdmin.closeBetslipModal();
}

function closePaymentInfoModal() {
    bettingAdmin.closePaymentInfoModal();
}

// Initialize betting admin when page loads
let bettingAdmin;
document.addEventListener('DOMContentLoaded', () => {
    bettingAdmin = new BettingAdmin();
});
