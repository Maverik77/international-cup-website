// Simple Authentication Configuration
const SIMPLE_AUTH_CONFIG = {
    password: 'cup',
    sessionKey: 'intcup_authenticated'
};

// Authentication State
let isAuthenticated = false;

// DOM Elements
const authModal = document.getElementById('auth-modal');
const authButton = document.getElementById('auth-button');
const closeModal = document.getElementById('close-modal');
const authForm = document.getElementById('auth-form');
const modalTitle = document.getElementById('modal-title');
const authSubmit = document.getElementById('auth-submit');

// Page states
const loadingState = document.getElementById('loading-state');
const loggedOutState = document.getElementById('logged-out-state');
const loggedInState = document.getElementById('logged-in-state');

// Member elements
const memberName = document.getElementById('member-name');
const profileBtn = document.getElementById('profile-btn');
const logoutBtn = document.getElementById('logout-btn');

// Initialize Authentication
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    checkAuthState();
});

function setupEventListeners() {
    // Modal controls (only if elements exist)
    if (authButton) authButton.addEventListener('click', showAuthModal);
    if (closeModal) closeModal.addEventListener('click', hideAuthModal);
    
    // Form submission (only if form exists)
    if (authForm) authForm.addEventListener('submit', handlePasswordSubmit);
    
    // Member actions
    if (profileBtn) profileBtn.addEventListener('click', showProfile);
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    
    // Close modal on outside click (only if modal exists)
    if (authModal) {
        window.addEventListener('click', function(event) {
            if (event.target === authModal) {
                hideAuthModal();
            }
        });
    }
}

function showAuthModal() {
    authModal.style.display = 'block';
    document.body.style.overflow = 'hidden';
}

function hideAuthModal() {
    authModal.style.display = 'none';
    document.body.style.overflow = 'auto';
    resetForm();
}

function resetForm() {
    if (authForm) authForm.reset();
}

function handlePasswordSubmit(e) {
    e.preventDefault();
    
    const password = document.getElementById('password').value;
    
    authSubmit.disabled = true;
    authSubmit.textContent = 'Checking...';
    
    // Simple password check
    if (password === SIMPLE_AUTH_CONFIG.password) {
        // Store authentication in sessionStorage
        sessionStorage.setItem(SIMPLE_AUTH_CONFIG.sessionKey, 'true');
        isAuthenticated = true;
        
        showNotification('Welcome to the International Cup Members Area!', 'success');
        hideAuthModal();
        updateAuthState(true);
    } else {
        showNotification('Incorrect password. Please try again.', 'error');
    }
    
    authSubmit.disabled = false;
    authSubmit.textContent = 'Sign In';
}

function checkAuthState() {
    showLoading(true);
    
    // Auto-signin for localhost development
    if (isLocalhost()) {
        console.log('🔧 Development mode: Auto-signing in for localhost');
        sessionStorage.setItem(SIMPLE_AUTH_CONFIG.sessionKey, 'true');
        isAuthenticated = true;
        updateAuthState(true);
        loadMockUserProfile();
        showNotification('🔧 Auto-signed in for localhost development', 'info');
        return;
    }
    
    // Check if user is authenticated
    const authStatus = sessionStorage.getItem(SIMPLE_AUTH_CONFIG.sessionKey);
    if (authStatus === 'true') {
        isAuthenticated = true;
        updateAuthState(true);
        loadUserProfile();
    } else {
        isAuthenticated = false;
        updateAuthState(false);
    }
}


function loadUserProfile() {
    // Update UI with simple user info
    if (memberName) {
        memberName.textContent = 'Member';
    }
    
    // Update auth button
    if (authButton) {
        authButton.textContent = 'Profile';
    }
}

function loadMockUserProfile() {
    // Update UI with mock user info for localhost
    if (memberName) {
        memberName.textContent = 'Dev User';
    }
    
    // Update auth button
    if (authButton) {
        authButton.textContent = 'Dev User';
    }
}

function updateAuthState(isAuthenticated) {
    showLoading(false);
    
    if (isAuthenticated) {
        if (authButton) authButton.textContent = 'Profile';
        if (loggedOutState) loggedOutState.style.display = 'none';
        if (loggedInState) loggedInState.style.display = 'block';
    } else {
        if (authButton) authButton.textContent = 'Sign In';
        if (loggedOutState) loggedOutState.style.display = 'block';
        if (loggedInState) loggedInState.style.display = 'none';
    }
}

function showLoading(show) {
    if (loadingState) {
        loadingState.style.display = show ? 'flex' : 'none';
    }
}

function handleLogout() {
    // Clear authentication
    sessionStorage.removeItem(SIMPLE_AUTH_CONFIG.sessionKey);
    isAuthenticated = false;
    
    showNotification('You have been signed out.', 'info');
    updateAuthState(false);
    
    // Auto-signin again if on localhost
    if (isLocalhost()) {
        setTimeout(() => {
            sessionStorage.setItem(SIMPLE_AUTH_CONFIG.sessionKey, 'true');
            isAuthenticated = true;
            updateAuthState(true);
            loadMockUserProfile();
            showNotification('🔧 Auto-signed in for localhost development', 'info');
        }, 1000);
    }
}


function showProfile() {
    // TODO: Implement profile editing
    showNotification('Profile editing coming soon!', 'info');
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Style the notification
    Object.assign(notification.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '16px 24px',
        borderRadius: '8px',
        color: 'white',
        fontWeight: '500',
        zIndex: '10000',
        maxWidth: '400px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        transform: 'translateX(100%)',
        transition: 'transform 0.3s ease'
    });
    
    // Set background color based on type
    switch (type) {
        case 'success':
            notification.style.backgroundColor = '#4caf50';
            break;
        case 'error':
            notification.style.backgroundColor = '#f44336';
            break;
        case 'info':
            notification.style.backgroundColor = '#2196f3';
            break;
        default:
            notification.style.backgroundColor = '#666';
    }
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Remove after 5 seconds
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

// Utility function to check if running on localhost
function isLocalhost() {
    return window.location.hostname === 'localhost' || 
           window.location.hostname === '127.0.0.1' || 
           window.location.hostname === '0.0.0.0';
}

// Global function for showing auth modal (called from HTML)
window.showAuthModal = showAuthModal;
