// Admin Panel for News Management
class AdminPanel {
    constructor() {
        this.adminPassword = 'cup2025';
        this.storageKey = 'internationalCupNews';
        this.isLoggedIn = false;
        this.editingArticleId = null;
        
        this.init();
    }

    init() {
        console.log('AdminPanel initializing...');
        this.setupEventListeners();
        this.checkAuthStatus();
        console.log('AdminPanel initialized');
    }

    setupEventListeners() {
        // Login form
        const loginForm = document.getElementById('admin-login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }

        // Logout button
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.handleLogout());
        }

        // Add news button
        const addNewsBtn = document.getElementById('add-news-btn');
        if (addNewsBtn) {
            addNewsBtn.addEventListener('click', () => this.showNewsForm());
        }

        // News form
        const newsForm = document.getElementById('news-form');
        if (newsForm) {
            newsForm.addEventListener('submit', (e) => this.handleNewsSubmit(e));
        }

        // Cancel form button
        const cancelBtn = document.getElementById('cancel-form-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.hideNewsForm());
        }
    }

    checkAuthStatus() {
        // For demo purposes, we'll use sessionStorage to maintain login state
        const isAuthenticated = sessionStorage.getItem('adminAuthenticated') === 'true';
        console.log('Auth status check:', isAuthenticated);
        if (isAuthenticated) {
            console.log('User authenticated, showing dashboard');
            this.showDashboard();
        } else {
            console.log('User not authenticated, showing login');
            this.showLogin();
        }
    }

    handleLogin(e) {
        e.preventDefault();
        const passwordInput = document.getElementById('admin-password');
        const password = passwordInput.value;
        const errorDiv = document.getElementById('login-error');

        if (password === this.adminPassword) {
            sessionStorage.setItem('adminAuthenticated', 'true');
            this.isLoggedIn = true;
            this.showDashboard();
            errorDiv.style.display = 'none';
        } else {
            errorDiv.style.display = 'block';
            passwordInput.value = '';
            passwordInput.focus();
        }
    }

    handleLogout() {
        sessionStorage.removeItem('adminAuthenticated');
        this.isLoggedIn = false;
        this.showLogin();
    }

    showLogin() {
        document.getElementById('admin-login-modal').style.display = 'block';
        document.getElementById('admin-dashboard').style.display = 'none';
    }

    showDashboard() {
        document.getElementById('admin-login-modal').style.display = 'none';
        document.getElementById('admin-dashboard').style.display = 'block';
        this.loadArticlesList();
    }

    showNewsForm(article = null) {
        const formContainer = document.getElementById('news-form-container');
        const formTitle = document.getElementById('form-title');
        const form = document.getElementById('news-form');
        
        if (article) {
            // Edit mode
            formTitle.textContent = 'Edit Article';
            document.getElementById('article-id').value = article.id;
            document.getElementById('article-title').value = article.title;
            document.getElementById('article-date').value = article.date;
            document.getElementById('article-content').value = article.content;
            this.editingArticleId = article.id;
        } else {
            // Add mode
            formTitle.textContent = 'Add New Article';
            form.reset();
            document.getElementById('article-date').value = new Date().toISOString().split('T')[0];
            this.editingArticleId = null;
        }
        
        formContainer.style.display = 'block';
        document.getElementById('article-title').focus();
    }

    hideNewsForm() {
        document.getElementById('news-form-container').style.display = 'none';
        document.getElementById('news-form').reset();
        this.editingArticleId = null;
    }

    handleNewsSubmit(e) {
        e.preventDefault();
        
        const title = document.getElementById('article-title').value.trim();
        const date = document.getElementById('article-date').value;
        const content = document.getElementById('article-content').value.trim();
        
        if (!title || !date || !content) {
            alert('Please fill in all fields.');
            return;
        }

        const articles = this.getNews();
        
        if (this.editingArticleId) {
            // Update existing article
            const index = articles.findIndex(article => article.id == this.editingArticleId);
            if (index !== -1) {
                articles[index] = {
                    ...articles[index],
                    title: title,
                    content: content,
                    date: date,
                    timestamp: new Date(date).getTime()
                };
            }
        } else {
            // Add new article
            const newArticle = {
                id: Date.now(),
                title: title,
                content: content,
                date: date,
                timestamp: new Date(date).getTime()
            };
            articles.unshift(newArticle);
        }

        this.saveNews(articles);
        this.hideNewsForm();
        this.loadArticlesList();
        
        // Show success message
        this.showNotification(this.editingArticleId ? 'Article updated successfully!' : 'Article added successfully!');
    }

    deleteArticle(id) {
        if (confirm('Are you sure you want to delete this article?')) {
            const articles = this.getNews();
            const filteredArticles = articles.filter(article => article.id != id);
            this.saveNews(filteredArticles);
            this.loadArticlesList();
            this.showNotification('Article deleted successfully!');
        }
    }

    loadArticlesList() {
        const container = document.getElementById('admin-news-list');
        const articles = this.getNews();
        
        if (articles.length === 0) {
            container.innerHTML = '<div class="loading">No articles found. Add your first article!</div>';
            return;
        }

        // Sort articles by date (newest first)
        articles.sort((a, b) => b.timestamp - a.timestamp);

        const articlesHTML = articles.map(article => `
            <div class="admin-article-item">
                <div class="article-header">
                    <div class="article-info">
                        <h4>${this.escapeHtml(article.title)}</h4>
                        <div class="article-date">${this.formatDate(article.date)}</div>
                    </div>
                    <div class="article-actions">
                        <button class="btn btn-small btn-edit" onclick="adminPanel.editArticle(${article.id})">Edit</button>
                        <button class="btn btn-small btn-delete" onclick="adminPanel.deleteArticle(${article.id})">Delete</button>
                    </div>
                </div>
                <div class="article-content">
                    <div class="article-preview">${this.escapeHtml(article.content)}</div>
                </div>
            </div>
        `).join('');

        container.innerHTML = articlesHTML;
    }

    editArticle(id) {
        const articles = this.getNews();
        const article = articles.find(article => article.id == id);
        if (article) {
            this.showNewsForm(article);
        }
    }

    // Get news from localStorage
    getNews() {
        const news = localStorage.getItem(this.storageKey);
        return news ? JSON.parse(news) : [
            {
                id: 1,
                title: "International Cup 2025 dates set",
                content: "The 2025 Lansdowne International Cup will be held from Oct.17 to Oct 18th.",
                date: "2024-12-15",
                timestamp: new Date("2024-12-15").getTime()
            }
        ];
    }

    // Save news to localStorage
    saveNews(articles) {
        localStorage.setItem(this.storageKey, JSON.stringify(articles));
    }

    // Format date for display
    formatDate(dateString) {
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        return new Date(dateString).toLocaleDateString('en-US', options);
    }

    // Escape HTML to prevent XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Show notification
    showNotification(message) {
        // Create a simple notification
        const notification = document.createElement('div');
        notification.className = 'admin-notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #10b981;
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            z-index: 9999;
            font-weight: 500;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }
}

// Initialize admin panel
document.addEventListener('DOMContentLoaded', function() {
    window.adminPanel = new AdminPanel();
});

// Check if we're accessing the admin route
if (window.location.pathname.endsWith('/admin') || window.location.pathname.endsWith('/admin.html')) {
    // We're on the admin page, the AdminPanel will handle authentication
} else if (window.location.hash === '#admin' || window.location.search.includes('admin')) {
    // Redirect to admin.html if accessing via hash or query parameter
    window.location.href = 'admin.html';
}
