// Betting Controls Admin JavaScript

class BettingControlsAdmin {
    constructor() {
        this.apiConfig = this.getApiConfig();
        this.isAuthenticated = false;
        this.password = null;
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
        // Password enter key
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

        this.password = password;

        try {
            // Test auth by getting cutoff status
            const response = await fetch(`${this.apiConfig.restApi}/betting/cutoff`, {
                headers: {
                    'Authorization': `Bearer ${password}`
                }
            });

            if (response.ok) {
                this.isAuthenticated = true;
                document.getElementById('password-section').style.display = 'none';
                document.getElementById('admin-interface').style.display = 'block';
                await this.loadBettingStatus();
            } else {
                errorElement.textContent = 'Invalid password';
            }
        } catch (error) {
            console.error('Login error:', error);
            errorElement.textContent = 'Login failed. Please try again.';
        }
    }

    async loadBettingStatus() {
        try {
            const response = await fetch(`${this.apiConfig.restApi}/betting/cutoff`);
            
            if (!response.ok) {
                throw new Error('Failed to load betting status');
            }

            const data = await response.json();

            // Update Day 1 status
            const day1StatusEl = document.getElementById('day1-status');
            if (data.day1Closed) {
                day1StatusEl.textContent = '🔒 Closed';
                day1StatusEl.className = 'status-badge status-closed';
            } else {
                day1StatusEl.textContent = '🔓 Open';
                day1StatusEl.className = 'status-badge status-open';
            }

            // Update Day 2 status
            const day2StatusEl = document.getElementById('day2-status');
            if (data.day2Closed) {
                day2StatusEl.textContent = '🔒 Closed';
                day2StatusEl.className = 'status-badge status-closed';
            } else {
                day2StatusEl.textContent = '🔓 Open';
                day2StatusEl.className = 'status-badge status-open';
            }

        } catch (error) {
            console.error('Error loading betting status:', error);
            this.showError('Failed to load betting status');
        }
    }

    async setBettingCutoff(day, closed) {
        const action = closed ? 'close' : 'open';
        if (!confirm(`Are you sure you want to ${action} Day ${day} betting?`)) {
            return;
        }

        try {
            const response = await fetch(`${this.apiConfig.restApi}/betting/cutoff`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.password}`
                },
                body: JSON.stringify({ day, closed })
            });

            if (!response.ok) {
                throw new Error('Failed to update betting cutoff');
            }

            const data = await response.json();
            this.showSuccess(`Day ${day} betting ${closed ? 'closed' : 'opened'} successfully!`);
            await this.loadBettingStatus();

        } catch (error) {
            console.error('Error setting betting cutoff:', error);
            this.showError('Failed to update betting cutoff. Please try again.');
        }
    }

    async bulkReveal(day) {
        if (!confirm(`Are you sure you want to reveal ALL Day ${day} matches? This cannot be undone.`)) {
            return;
        }

        try {
            const response = await fetch(`${this.apiConfig.restApi}/pairings/bulk-reveal`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.password}`
                },
                body: JSON.stringify({ day })
            });

            if (!response.ok) {
                throw new Error('Failed to bulk reveal matches');
            }

            const data = await response.json();
            this.showSuccess(`Successfully revealed ${data.count} Day ${day} matches!`);

        } catch (error) {
            console.error('Error bulk revealing matches:', error);
            this.showError('Failed to reveal matches. Please try again.');
        }
    }

    showSuccess(message) {
        const successEl = document.getElementById('success-message');
        successEl.textContent = message;
        successEl.style.display = 'block';
        document.getElementById('error-message').style.display = 'none';
        
        setTimeout(() => {
            successEl.style.display = 'none';
        }, 5000);
    }

    showError(message) {
        const errorEl = document.getElementById('error-message');
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        document.getElementById('success-message').style.display = 'none';
        
        setTimeout(() => {
            errorEl.style.display = 'none';
        }, 5000);
    }
}

// Global functions
function login() {
    bettingControlsAdmin.login();
}

function setBettingCutoff(day, closed) {
    bettingControlsAdmin.setBettingCutoff(day, closed);
}

function bulkReveal(day) {
    bettingControlsAdmin.bulkReveal(day);
}

// Initialize
let bettingControlsAdmin;
document.addEventListener('DOMContentLoaded', () => {
    bettingControlsAdmin = new BettingControlsAdmin();
});

