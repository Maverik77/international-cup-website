// Members Area Specific Functionality

document.addEventListener('DOMContentLoaded', function() {
    initializeMembersArea();
    setupMemberActions();
});

function initializeMembersArea() {
    // Check if we're in the members area
    if (window.location.pathname.includes('/members/')) {
        // Set up member-specific functionality
        loadMemberDashboard();
    }
}

function setupMemberActions() {
    // Tournament registration
    const registerBtn = document.querySelector('.action-btn.primary');
    if (registerBtn && registerBtn.textContent.includes('Register')) {
        registerBtn.addEventListener('click', handleTournamentRegistration);
    }
    
    // Other action buttons
    const actionButtons = document.querySelectorAll('.action-btn:not(.primary)');
    actionButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const action = this.textContent.trim();
            handleMemberAction(action);
        });
    });
    
    // Dashboard cards hover effects
    const dashboardCards = document.querySelectorAll('.dashboard-card');
    dashboardCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-4px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });
}

function loadMemberDashboard() {
    // Simulate loading member data
    setTimeout(() => {
        updateRegistrationStatus();
        loadRecentUpdates();
        updateMemberStats();
    }, 1000);
}

function updateRegistrationStatus() {
    const registrationStatus = document.getElementById('registration-status');
    const teamAssignment = document.getElementById('team-assignment');
    
    if (registrationStatus && teamAssignment) {
        // Simulate member registration status
        const isRegistered = Math.random() > 0.5; // Random for demo
        
        if (isRegistered) {
            registrationStatus.textContent = 'Registered';
            registrationStatus.className = 'status-value open';
            
            const teams = ['Team USA', 'Team International'];
            const assignedTeam = teams[Math.floor(Math.random() * teams.length)];
            teamAssignment.textContent = assignedTeam;
            teamAssignment.className = 'status-value open';
        } else {
            registrationStatus.textContent = 'Not Registered';
            registrationStatus.className = 'status-value pending';
            teamAssignment.textContent = 'TBA';
            teamAssignment.className = 'status-value';
        }
    }
}

function loadRecentUpdates() {
    // This would typically load from an API
    const updates = [
        {
            date: 'Jan 15, 2025',
            text: 'Pairings for Day 1 team matches have been released!'
        },
        {
            date: 'Jan 10, 2025',
            text: 'Welcome party details announced - cocktails at 6 PM on Oct 16th.'
        },
        {
            date: 'Jan 5, 2025',
            text: 'Registration deadline extended to February 1st, 2025.'
        }
    ];
    
    const updatesContainer = document.querySelector('.dashboard-card:nth-child(3) .card-content');
    if (updatesContainer) {
        updatesContainer.innerHTML = '';
        
        updates.forEach(update => {
            const updateItem = document.createElement('div');
            updateItem.className = 'update-item';
            updateItem.innerHTML = `
                <div class="update-date">${update.date}</div>
                <div class="update-text">${update.text}</div>
            `;
            updatesContainer.appendChild(updateItem);
        });
    }
}

function updateMemberStats() {
    // Add some dynamic stats or member info
    const memberName = document.getElementById('member-name');
    if (memberName && currentUser) {
        // This would be populated from the user's Cognito attributes
        // For now, we'll keep it as set by the auth system
    }
}

function handleTournamentRegistration() {
    const registrationStatus = document.getElementById('registration-status');
    
    if (registrationStatus.textContent === 'Not Registered') {
        // Show registration modal or form
        showRegistrationModal();
    } else {
        showNotification('You are already registered for the tournament!', 'info');
    }
}

function showRegistrationModal() {
    // Create a simple registration modal
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Tournament Registration</h2>
                <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            </div>
            <div class="modal-body">
                <form id="registration-form">
                    <div class="form-group">
                        <label for="handicap">Golf Handicap</label>
                        <input type="number" id="handicap" name="handicap" step="0.1" required>
                        <small>Enter your current USGA handicap index</small>
                    </div>
                    <div class="form-group">
                        <label for="team-preference">Team Preference (optional)</label>
                        <select id="team-preference" name="team-preference">
                            <option value="">No preference</option>
                            <option value="usa">Team USA</option>
                            <option value="international">Team International</option>
                        </select>
                        <small>Final team assignment will be based on handicap and balance</small>
                    </div>
                    <div class="form-group">
                        <label for="dietary-restrictions">Dietary Restrictions</label>
                        <textarea id="dietary-restrictions" name="dietary-restrictions" rows="3" placeholder="Any food allergies or dietary preferences..."></textarea>
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" required>
                            I agree to the tournament rules and code of conduct
                        </label>
                    </div>
                    <button type="submit" class="auth-submit-btn">Complete Registration</button>
                </form>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Handle form submission
    const form = modal.querySelector('#registration-form');
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        handleRegistrationSubmit(form, modal);
    });
    
    // Close on outside click
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

function handleRegistrationSubmit(form, modal) {
    const formData = new FormData(form);
    const registrationData = {
        handicap: formData.get('handicap'),
        teamPreference: formData.get('team-preference'),
        dietaryRestrictions: formData.get('dietary-restrictions')
    };
    
    // Simulate API call
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Registering...';
    
    setTimeout(() => {
        // Simulate successful registration
        showNotification('Registration successful! Welcome to the International Cup!', 'success');
        modal.remove();
        
        // Update the dashboard
        const registrationStatus = document.getElementById('registration-status');
        if (registrationStatus) {
            registrationStatus.textContent = 'Registered';
            registrationStatus.className = 'status-value open';
        }
        
        // Update the register button
        const registerBtn = document.querySelector('.action-btn.primary');
        if (registerBtn) {
            registerBtn.textContent = 'View Registration';
            registerBtn.classList.remove('primary');
        }
        
        // Assign a team (randomly for demo)
        const teamAssignment = document.getElementById('team-assignment');
        if (teamAssignment) {
            const teams = ['Team USA', 'Team International'];
            const assignedTeam = teams[Math.floor(Math.random() * teams.length)];
            teamAssignment.textContent = assignedTeam;
            teamAssignment.className = 'status-value open';
        }
    }, 2000);
}

function handleMemberAction(action) {
    switch (action) {
        case 'Update Profile':
            showNotification('Profile update coming soon!', 'info');
            break;
        case 'View Pairings':
            showNotification('Pairings will be available closer to the tournament date.', 'info');
            break;
        case 'Event Schedule':
            // Scroll to schedule section on main page
            window.location.href = '/#schedule';
            break;
        case 'Browse Members':
            showMemberDirectory();
            break;
        case 'View Registration':
            showRegistrationDetails();
            break;
        case 'View 2024 Results':
            // Handled by historic-data.js
            break;
        default:
            showNotification('This feature is coming soon!', 'info');
    }
}

function showMemberDirectory() {
    // Create member directory modal
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <div class="modal-header">
                <h2>Member Directory</h2>
                <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="member-search">
                    <input type="text" placeholder="Search members..." style="width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 8px; margin-bottom: 20px;">
                </div>
                <div class="member-list">
                    ${generateMemberList()}
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Close on outside click
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

function generateMemberList() {
    const sampleMembers = [
        { name: 'John Smith', team: 'Team USA', handicap: 8.2, country: 'USA' },
        { name: 'Emma Wilson', team: 'Team International', handicap: 12.5, country: 'Canada' },
        { name: 'Michael Brown', team: 'Team USA', handicap: 6.8, country: 'USA' },
        { name: 'Sophie Chen', team: 'Team International', handicap: 15.1, country: 'Australia' },
        { name: 'David Johnson', team: 'Team USA', handicap: 11.3, country: 'USA' },
        { name: 'Lars Andersson', team: 'Team International', handicap: 9.7, country: 'Sweden' }
    ];
    
    return sampleMembers.map(member => `
        <div class="member-item" style="display: flex; justify-content: space-between; align-items: center; padding: 16px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 12px;">
            <div>
                <div style="font-weight: 600; color: var(--text-dark);">${member.name}</div>
                <div style="font-size: 0.9rem; color: var(--text-light);">${member.country} • Handicap: ${member.handicap}</div>
            </div>
            <div style="text-align: right;">
                <div class="status-value ${member.team === 'Team USA' ? 'open' : 'pending'}" style="font-size: 0.8rem;">
                    ${member.team}
                </div>
            </div>
        </div>
    `).join('');
}

function showRegistrationDetails() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Your Registration</h2>
                <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            </div>
            <div class="modal-body">
                <div class="registration-details">
                    <div class="detail-item">
                        <strong>Status:</strong> Confirmed
                    </div>
                    <div class="detail-item">
                        <strong>Registration Date:</strong> January 15, 2025
                    </div>
                    <div class="detail-item">
                        <strong>Handicap:</strong> 12.5
                    </div>
                    <div class="detail-item">
                        <strong>Team Assignment:</strong> <span id="modal-team">TBA</span>
                    </div>
                    <div class="detail-item">
                        <strong>Tournament Dates:</strong> October 16-18, 2025
                    </div>
                </div>
                <div style="margin-top: 24px;">
                    <button class="auth-submit-btn" onclick="this.closest('.modal').remove()">Close</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Update team assignment in modal
    const teamAssignment = document.getElementById('team-assignment');
    const modalTeam = modal.querySelector('#modal-team');
    if (teamAssignment && modalTeam) {
        modalTeam.textContent = teamAssignment.textContent;
    }
    
    // Close on outside click
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Add some CSS for the modal styles
const memberStyles = `
.detail-item {
    display: flex;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid var(--light-gray);
}

.detail-item:last-child {
    border-bottom: none;
}

.member-search input:focus {
    outline: none;
    border-color: var(--primary-color);
}
`;

// Add styles to document
const styleSheet = document.createElement('style');
styleSheet.textContent = memberStyles;
document.head.appendChild(styleSheet);
