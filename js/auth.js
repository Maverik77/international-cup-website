// AWS Cognito Configuration
const COGNITO_CONFIG = {
    UserPoolId: 'us-east-1_T5zttESw4',
    ClientId: 'q27ncptlccjrjkjrap017scp0',
    ClientSecret: '1cg3kjftid2ccr89asfjvrf2ojjljfiq1nojmbanu4utvr654hcg',
    Domain: 'international-cup-auth.auth.us-east-1.amazoncognito.com',
    Region: 'us-east-1'
};

// Initialize Cognito
const poolData = {
    UserPoolId: COGNITO_CONFIG.UserPoolId,
    ClientId: COGNITO_CONFIG.ClientId
};

const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);

// Authentication State
let currentUser = null;
let isSignUpMode = false;

// DOM Elements
const authModal = document.getElementById('auth-modal');
const authButton = document.getElementById('auth-button');
const closeModal = document.getElementById('close-modal');
const authForm = document.getElementById('auth-form');
const modalTitle = document.getElementById('modal-title');
const authSubmit = document.getElementById('auth-submit');
const switchMode = document.getElementById('switch-mode');
const authSwitchText = document.getElementById('auth-switch-text');
const nameFields = document.getElementById('name-fields');
const passwordRequirements = document.getElementById('password-requirements');

// Social login buttons
const googleLogin = document.getElementById('google-login');
const facebookLogin = document.getElementById('facebook-login');
const appleLogin = document.getElementById('apple-login');

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
    // Modal controls
    authButton.addEventListener('click', showAuthModal);
    closeModal.addEventListener('click', hideAuthModal);
    switchMode.addEventListener('click', toggleAuthMode);
    
    // Form submission
    authForm.addEventListener('submit', handleAuthSubmit);
    
    // Social login buttons
    googleLogin.addEventListener('click', () => handleSocialLogin('Google'));
    facebookLogin.addEventListener('click', () => handleSocialLogin('Facebook'));
    appleLogin.addEventListener('click', () => handleSocialLogin('SignInWithApple'));
    
    // Member actions
    if (profileBtn) profileBtn.addEventListener('click', showProfile);
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    
    // Close modal on outside click
    window.addEventListener('click', function(event) {
        if (event.target === authModal) {
            hideAuthModal();
        }
    });
    
    // Forgot password
    const forgotPassword = document.getElementById('forgot-password');
    if (forgotPassword) {
        forgotPassword.addEventListener('click', handleForgotPassword);
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

function toggleAuthMode(e) {
    e.preventDefault();
    isSignUpMode = !isSignUpMode;
    
    if (isSignUpMode) {
        modalTitle.textContent = 'Create Account';
        authSubmit.textContent = 'Sign Up';
        authSwitchText.innerHTML = 'Already have an account? <a href="#" id="switch-mode">Sign In</a>';
        nameFields.style.display = 'block';
        passwordRequirements.style.display = 'block';
        document.getElementById('firstName').required = true;
        document.getElementById('lastName').required = true;
    } else {
        modalTitle.textContent = 'Welcome Back!';
        authSubmit.textContent = 'Sign In';
        authSwitchText.innerHTML = 'Don\'t have an account? <a href="#" id="switch-mode">Sign Up</a>';
        nameFields.style.display = 'none';
        passwordRequirements.style.display = 'none';
        document.getElementById('firstName').required = false;
        document.getElementById('lastName').required = false;
    }
    
    // Re-attach event listener to new switch mode button
    document.getElementById('switch-mode').addEventListener('click', toggleAuthMode);
}

function resetForm() {
    authForm.reset();
    isSignUpMode = false;
    modalTitle.textContent = 'Welcome Back!';
    authSubmit.textContent = 'Sign In';
    authSwitchText.innerHTML = 'Don\'t have an account? <a href="#" id="switch-mode">Sign Up</a>';
    nameFields.style.display = 'none';
    passwordRequirements.style.display = 'none';
    document.getElementById('firstName').required = false;
    document.getElementById('lastName').required = false;
    
    // Re-attach event listener
    document.getElementById('switch-mode').addEventListener('click', toggleAuthMode);
}

async function handleAuthSubmit(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const firstName = document.getElementById('firstName').value;
    const lastName = document.getElementById('lastName').value;
    
    authSubmit.disabled = true;
    authSubmit.textContent = isSignUpMode ? 'Creating Account...' : 'Signing In...';
    
    try {
        if (isSignUpMode) {
            await signUp(email, password, firstName, lastName);
        } else {
            await signIn(email, password);
        }
    } catch (error) {
        console.error('Authentication error:', error);
        showNotification(error.message || 'Authentication failed', 'error');
    } finally {
        authSubmit.disabled = false;
        authSubmit.textContent = isSignUpMode ? 'Sign Up' : 'Sign In';
    }
}

function signUp(email, password, firstName, lastName) {
    return new Promise((resolve, reject) => {
        const attributeList = [];
        
        attributeList.push(new AmazonCognitoIdentity.CognitoUserAttribute({
            Name: 'email',
            Value: email
        }));
        
        attributeList.push(new AmazonCognitoIdentity.CognitoUserAttribute({
            Name: 'given_name',
            Value: firstName
        }));
        
        attributeList.push(new AmazonCognitoIdentity.CognitoUserAttribute({
            Name: 'family_name',
            Value: lastName
        }));
        
        userPool.signUp(email, password, attributeList, null, function(err, result) {
            if (err) {
                reject(err);
                return;
            }
            
            showNotification('Account created! Please check your email for verification code.', 'success');
            
            // Show verification prompt
            const verificationCode = prompt('Please enter the verification code sent to your email:');
            if (verificationCode) {
                confirmSignUp(email, verificationCode).then(resolve).catch(reject);
            } else {
                resolve(result);
            }
        });
    });
}

function confirmSignUp(email, verificationCode) {
    return new Promise((resolve, reject) => {
        const userData = {
            Username: email,
            Pool: userPool
        };
        
        const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
        
        cognitoUser.confirmRegistration(verificationCode, true, function(err, result) {
            if (err) {
                reject(err);
                return;
            }
            
            showNotification('Email verified successfully! You can now sign in.', 'success');
            hideAuthModal();
            resolve(result);
        });
    });
}

function signIn(email, password) {
    return new Promise((resolve, reject) => {
        const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({
            Username: email,
            Password: password
        });
        
        const userData = {
            Username: email,
            Pool: userPool
        };
        
        const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
        
        cognitoUser.authenticateUser(authenticationDetails, {
            onSuccess: function(result) {
                currentUser = cognitoUser;
                showNotification('Welcome back!', 'success');
                hideAuthModal();
                updateAuthState(true);
                resolve(result);
            },
            onFailure: function(err) {
                reject(err);
            },
            newPasswordRequired: function(userAttributes, requiredAttributes) {
                // Handle new password requirement
                const newPassword = prompt('Please set a new password:');
                if (newPassword) {
                    cognitoUser.completeNewPasswordChallenge(newPassword, {}, this);
                } else {
                    reject(new Error('New password required'));
                }
            }
        });
    });
}

function handleSocialLogin(provider) {
    const loginUrl = `https://${COGNITO_CONFIG.Domain}/oauth2/authorize?` +
        `client_id=${COGNITO_CONFIG.ClientId}&` +
        `response_type=code&` +
        `scope=email+openid+profile&` +
        `redirect_uri=${encodeURIComponent(window.location.origin + '/auth/callback.html')}&` +
        `identity_provider=${provider}`;
    
    window.location.href = loginUrl;
}

function checkAuthState() {
    showLoading(true);
    
    currentUser = userPool.getCurrentUser();
    
    if (currentUser) {
        currentUser.getSession(function(err, session) {
            if (err) {
                console.error('Session error:', err);
                updateAuthState(false);
                return;
            }
            
            if (session.isValid()) {
                updateAuthState(true);
                loadUserProfile();
            } else {
                updateAuthState(false);
            }
        });
    } else {
        // Check for OAuth callback
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        
        if (code && window.location.pathname.includes('/auth/callback')) {
            handleOAuthCallback(code);
        } else {
            updateAuthState(false);
        }
    }
}

function handleOAuthCallback(code) {
    // Exchange code for tokens
    fetch(`https://${COGNITO_CONFIG.Domain}/oauth2/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: COGNITO_CONFIG.ClientId,
            client_secret: COGNITO_CONFIG.ClientSecret,
            code: code,
            redirect_uri: window.location.origin + '/auth/callback'
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.access_token) {
            // Store tokens and redirect to members area
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('id_token', data.id_token);
            localStorage.setItem('refresh_token', data.refresh_token);
            
            showNotification('Successfully signed in!', 'success');
            window.location.href = '/members/';
        } else {
            throw new Error('Failed to get access token');
        }
    })
    .catch(error => {
        console.error('OAuth callback error:', error);
        showNotification('Sign in failed. Please try again.', 'error');
        updateAuthState(false);
    });
}

function loadUserProfile() {
    if (!currentUser) return;
    
    currentUser.getUserAttributes(function(err, attributes) {
        if (err) {
            console.error('Error getting user attributes:', err);
            return;
        }
        
        const userInfo = {};
        attributes.forEach(attribute => {
            userInfo[attribute.getName()] = attribute.getValue();
        });
        
        // Update UI with user info
        if (memberName && (userInfo.given_name || userInfo.name)) {
            memberName.textContent = userInfo.given_name || userInfo.name || 'Member';
        }
        
        // Update auth button
        if (authButton) {
            authButton.textContent = userInfo.given_name || 'Profile';
        }
    });
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
    if (currentUser) {
        currentUser.signOut();
        currentUser = null;
    }
    
    // Clear stored tokens
    localStorage.removeItem('access_token');
    localStorage.removeItem('id_token');
    localStorage.removeItem('refresh_token');
    
    showNotification('You have been signed out.', 'info');
    updateAuthState(false);
}

function handleForgotPassword(e) {
    e.preventDefault();
    
    const email = prompt('Please enter your email address:');
    if (!email) return;
    
    const userData = {
        Username: email,
        Pool: userPool
    };
    
    const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);
    
    cognitoUser.forgotPassword({
        onSuccess: function() {
            const verificationCode = prompt('Please enter the verification code sent to your email:');
            const newPassword = prompt('Please enter your new password:');
            
            if (verificationCode && newPassword) {
                cognitoUser.confirmPassword(verificationCode, newPassword, {
                    onSuccess: function() {
                        showNotification('Password reset successfully!', 'success');
                    },
                    onFailure: function(err) {
                        showNotification(err.message || 'Password reset failed', 'error');
                    }
                });
            }
        },
        onFailure: function(err) {
            showNotification(err.message || 'Password reset failed', 'error');
        }
    });
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

// Global function for showing auth modal (called from HTML)
window.showAuthModal = showAuthModal;
