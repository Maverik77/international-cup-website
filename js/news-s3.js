// S3-based News Management System with GitHub API integration
class S3NewsManager {
    constructor() {
        this.newsUrl = './data/news.json';
        this.githubApi = 'https://api.github.com/repos/Maverik77/international-cup-website';
        this.cache = null;
        this.cacheExpiry = null;
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    // Read news from static JSON file
    async getNews() {
        try {
            // Check cache first
            if (this.cache && this.cacheExpiry && Date.now() < this.cacheExpiry) {
                return this.cache;
            }

            const response = await fetch(this.newsUrl + '?t=' + Date.now());
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const articles = await response.json();
            
            // Cache the result
            this.cache = articles;
            this.cacheExpiry = Date.now() + this.cacheTimeout;
            
            return articles;
        } catch (error) {
            console.error('Error reading news:', error);
            return this.getDefaultNews();
        }
    }

    // Get default news (fallback)
    getDefaultNews() {
        return [
            {
                id: Date.now(),
                title: "International Cup 2025 dates set",
                content: "The 2025 Lansdowne International Cup will be held from Oct.17 to Oct 18th.",
                date: "2024-12-15",
                timestamp: new Date("2024-12-15").getTime()
            }
        ];
    }

    // Save news via GitHub API (creates a commit)
    async saveNews(articles, adminPassword, githubToken) {
        if (adminPassword !== 'cup2025') {
            throw new Error('Invalid admin password');
        }

        if (!githubToken) {
            throw new Error('GitHub token required for saving news');
        }

        try {
            // Get current file SHA
            const fileResponse = await fetch(`${this.githubApi}/contents/data/news.json`, {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            let sha = null;
            if (fileResponse.ok) {
                const fileData = await fileResponse.json();
                sha = fileData.sha;
            }

            // Prepare the content
            const content = btoa(JSON.stringify(articles, null, 2));
            
            // Create/update the file
            const updateResponse = await fetch(`${this.githubApi}/contents/data/news.json`, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: `Update news articles - ${new Date().toISOString()}`,
                    content: content,
                    sha: sha
                })
            });

            if (!updateResponse.ok) {
                const errorData = await updateResponse.json();
                throw new Error(`GitHub API error: ${errorData.message}`);
            }

            // Clear cache
            this.cache = null;
            this.cacheExpiry = null;

            return true;
        } catch (error) {
            console.error('Error saving news via GitHub API:', error);
            throw error;
        }
    }

    // Add new article
    async addArticle(title, content, date, adminPassword, githubToken) {
        const articles = await this.getNews();
        const newArticle = {
            id: Date.now(),
            title: title,
            content: content,
            date: date,
            timestamp: new Date(date).getTime()
        };
        
        articles.unshift(newArticle); // Add to beginning
        await this.saveNews(articles, adminPassword, githubToken);
        return newArticle;
    }

    // Update existing article
    async updateArticle(id, title, content, date, adminPassword, githubToken) {
        const articles = await this.getNews();
        const index = articles.findIndex(article => article.id == id);
        
        if (index !== -1) {
            articles[index] = {
                ...articles[index],
                title: title,
                content: content,
                date: date,
                timestamp: new Date(date).getTime()
            };
            await this.saveNews(articles, adminPassword, githubToken);
            return articles[index];
        }
        throw new Error('Article not found');
    }

    // Delete article
    async deleteArticle(id, adminPassword, githubToken) {
        const articles = await this.getNews();
        const filteredArticles = articles.filter(article => article.id != id);
        await this.saveNews(filteredArticles, adminPassword, githubToken);
        return true;
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
}

// Initialize S3 news manager
document.addEventListener('DOMContentLoaded', function() {
    window.s3NewsManager = new S3NewsManager();
});

// Update homepage news section with S3 data
async function updateHomepageNews() {
    try {
        const articles = await window.s3NewsManager.getNews();
        
        // Update the news section on index.html if it exists
        const homeNewsGrid = document.querySelector('#homepage-news-grid');
        if (homeNewsGrid && articles.length > 0) {
            // Show the last 3 articles on homepage
            const sortedArticles = articles.sort((a, b) => b.timestamp - a.timestamp);
            const recentArticles = sortedArticles.slice(0, 3);
            
            const articlesHTML = recentArticles.map(article => `
                <article class="news-card">
                    <div class="news-date">${window.s3NewsManager.formatDate(article.date)}</div>
                    <h3>${window.s3NewsManager.escapeHtml(article.title)}</h3>
                    <p>${window.s3NewsManager.escapeHtml(article.content)}</p>
                </article>
            `).join('');
            
            homeNewsGrid.innerHTML = articlesHTML;
        }
    } catch (error) {
        console.error('Error updating homepage news:', error);
    }
}

// Load all news in modal
async function loadAllNewsInModal() {
    try {
        const container = document.getElementById('all-news-container');
        if (!container) return;
        
        const articles = await window.s3NewsManager.getNews();
        
        // Sort articles by date (newest first)
        const sortedArticles = articles.sort((a, b) => b.timestamp - a.timestamp);
        
        // Generate HTML for all articles
        const articlesHTML = sortedArticles.map(article => `
            <article class="modal-news-card">
                <div class="news-date">${window.s3NewsManager.formatDate(article.date)}</div>
                <h3>${window.s3NewsManager.escapeHtml(article.title)}</h3>
                <p>${window.s3NewsManager.escapeHtml(article.content)}</p>
            </article>
        `).join('');
        
        container.innerHTML = articlesHTML;
    } catch (error) {
        console.error('Error loading news in modal:', error);
        document.getElementById('all-news-container').innerHTML = 
            '<p>Error loading news articles. Please try again later.</p>';
    }
}

// Call this function when the page loads if we're on the homepage
if (window.location.pathname === '/' || window.location.pathname.endsWith('index.html')) {
    document.addEventListener('DOMContentLoaded', updateHomepageNews);
}
