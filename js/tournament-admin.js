// Tournament Results Admin JavaScript

class TournamentAdmin {
    constructor() {
        this.apiConfig = this.getApiConfig();
        this.isAuthenticated = false;
        this.currentTab = 'upload';
        this.jsonData = null;
    }

    getApiConfig() {
        const isStaging = window.location.origin.includes('staging');
        return {
            restApi: isStaging 
                ? 'https://9iz68mvngi.execute-api.us-east-1.amazonaws.com/prod'
                : 'https://qzq9gvuk9f.execute-api.us-east-1.amazonaws.com/prod'
        };
    }

    switchTab(tab) {
        // Update tab buttons
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        event.target.classList.add('active');

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`${tab}-tab`).classList.add('active');

        this.currentTab = tab;

        // Load data for manage tab
        if (tab === 'manage') {
            this.loadExistingResults();
        }
    }

    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            document.getElementById('file-name').textContent = file.name;
            
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    this.jsonData = JSON.parse(e.target.result);
                    document.getElementById('json-content').value = JSON.stringify(this.jsonData, null, 2);
                    this.showStatus('File loaded successfully', 'success');
                } catch (error) {
                    this.showStatus('Invalid JSON file: ' + error.message, 'error');
                }
            };
            reader.readAsText(file);
        }
    }

    async uploadResults() {
        const year = document.getElementById('year-input').value;
        const jsonContent = document.getElementById('json-content').value;

        if (!year) {
            this.showStatus('Please enter a tournament year', 'error');
            return;
        }

        if (!jsonContent.trim()) {
            this.showStatus('Please provide JSON content', 'error');
            return;
        }

        try {
            // Parse and validate JSON
            const data = JSON.parse(jsonContent);
            
            if (!data.matches || !Array.isArray(data.matches)) {
                throw new Error('JSON must contain a "matches" array');
            }

            // Prepare upload data
            const uploadData = {
                year: parseInt(year),
                matches: data.matches
            };

            this.showStatus('Uploading...', 'success');

            const password = document.getElementById('admin-password').value;
            const response = await fetch(`${this.apiConfig.restApi}/tournament-results`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${password}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(uploadData)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Upload failed');
            }

            this.showStatus(
                `✅ Successfully uploaded ${result.matchesUploaded} matches for ${result.year}!`, 
                'success'
            );

            // Clear form
            document.getElementById('json-content').value = '';
            document.getElementById('json-file').value = '';
            document.getElementById('file-name').textContent = 'No file chosen';
            this.jsonData = null;

        } catch (error) {
            console.error('Upload error:', error);
            this.showStatus('Upload failed: ' + error.message, 'error');
        }
    }

    async loadExistingResults() {
        const container = document.getElementById('years-list');
        container.innerHTML = '<div class="loading">Loading tournament results...</div>';

        try {
            // Get year summaries from reports API
            const response = await fetch(`${this.apiConfig.restApi}/tournament-results/reports?type=year-summary`);
            
            if (!response.ok) {
                throw new Error('Failed to load results');
            }

            const data = await response.json();
            
            if (!data.data || !data.data.summaries || data.data.summaries.length === 0) {
                container.innerHTML = '<p style="text-align: center; padding: 2rem; color: #666;">No tournament results found. Upload your first tournament!</p>';
                return;
            }

            // Render year cards
            container.innerHTML = data.data.summaries.map(summary => this.renderYearCard(summary)).join('');

        } catch (error) {
            console.error('Error loading results:', error);
            container.innerHTML = `<div class="status-message error">Failed to load results: ${error.message}</div>`;
        }
    }

    renderYearCard(summary) {
        return `
            <div class="year-card">
                <div class="year-card-header">
                    <h3>${summary.year} Tournament</h3>
                    <button class="btn-secondary btn" onclick="tournamentAdmin.viewResults(${summary.year})">View Details</button>
                </div>
                <div class="year-card-stats">
                    <div class="stat-box">
                        <div class="value">${summary.totalMatches}</div>
                        <div class="label">Total Matches</div>
                    </div>
                    <div class="stat-box">
                        <div class="value">${summary.usaWins}</div>
                        <div class="label">USA Wins</div>
                    </div>
                    <div class="stat-box">
                        <div class="value">${summary.internationalWins}</div>
                        <div class="label">International Wins</div>
                    </div>
                    <div class="stat-box">
                        <div class="value">${summary.ties || 0}</div>
                        <div class="label">Ties</div>
                    </div>
                </div>
            </div>
        `;
    }

    viewResults(year) {
        // Redirect to results page with year parameter
        window.location.href = `results.html?year=${year}`;
    }

    showStatus(message, type) {
        const statusEl = document.getElementById('upload-status');
        statusEl.textContent = message;
        statusEl.className = `status-message ${type}`;
        
        // Auto-hide success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                statusEl.style.display = 'none';
            }, 5000);
        }
    }
}

// Global functions
function login() {
    const password = document.getElementById('admin-password').value;
    const errorEl = document.getElementById('password-error');
    
    if (!password) {
        errorEl.textContent = 'Please enter a password';
        return;
    }

    // For simplicity, we'll verify the password on first API call
    // In production, you'd want a proper login endpoint
    tournamentAdmin.isAuthenticated = true;
    document.getElementById('password-section').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';
}

// Initialize tournament admin when page loads
let tournamentAdmin;
document.addEventListener('DOMContentLoaded', () => {
    tournamentAdmin = new TournamentAdmin();
});





