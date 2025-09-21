// News Management System
class NewsManager {
    constructor() {
        this.storageKey = 'internationalCupNews';
        this.init();
    }

    init() {
        this.loadNews();
    }

    // Get all news articles from localStorage
    getNews() {
        const news = localStorage.getItem(this.storageKey);
        return news ? JSON.parse(news) : this.getDefaultNews();
    }

    // Get default news (fallback)
    getDefaultNews() {
        return [
            {
                id: 1,
                title: "International Cup 2025 dates set",
                content: "The 2025 Lansdowne International Cup will be held from Oct.17 to Oct 18th.",
                date: "2024-12-15",
                timestamp: new Date("2024-12-15").getTime()
            }
        ];
    }

    // Save news articles to localStorage
    saveNews(articles) {
        localStorage.setItem(this.storageKey, JSON.stringify(articles));
    }

    // Add new article
    addArticle(title, content, date) {
        const articles = this.getNews();
        const newArticle = {
            id: Date.now(),
            title: title,
            content: content,
            date: date,
            timestamp: new Date(date).getTime()
        };
        
        articles.unshift(newArticle); // Add to beginning
        this.saveNews(articles);
        return newArticle;
    }

    // Update existing article
    updateArticle(id, title, content, date) {
        const articles = this.getNews();
        const index = articles.findIndex(article => article.id == id);
        
        if (index !== -1) {
            articles[index] = {
                ...articles[index],
                title: title,
                content: content,
                date: date,
                timestamp: new Date(date).getTime()
            };
            this.saveNews(articles);
            return articles[index];
        }
        return null;
    }

    // Delete article
    deleteArticle(id) {
        const articles = this.getNews();
        const filteredArticles = articles.filter(article => article.id != id);
        this.saveNews(filteredArticles);
        return true;
    }

    // Load and display news on the news page
    loadNews() {
        const container = document.getElementById('news-articles-container');
        if (!container) return;

        const articles = this.getNews();
        
        if (articles.length === 0) {
            container.innerHTML = `
                <div class="no-news">
                    <p>No news articles available at this time.</p>
                </div>
            `;
            return;
        }

        // Sort articles by date (newest first)
        articles.sort((a, b) => b.timestamp - a.timestamp);

        const articlesHTML = articles.map(article => `
            <article class="news-article">
                <div class="news-article-date">${this.formatDate(article.date)}</div>
                <h2>${this.escapeHtml(article.title)}</h2>
                <div class="news-article-content">${this.escapeHtml(article.content)}</div>
            </article>
        `).join('');

        container.innerHTML = articlesHTML;
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

// Initialize news manager
document.addEventListener('DOMContentLoaded', function() {
    window.newsManager = new NewsManager();
});

// Update homepage news section
function updateHomepageNews() {
    const newsManager = new NewsManager();
    const articles = newsManager.getNews();
    
    // Update the news section on index.html if it exists
    const homeNewsGrid = document.querySelector('.news-grid');
    if (homeNewsGrid && articles.length > 0) {
        // Show only the latest article on homepage
        const latestArticle = articles.sort((a, b) => b.timestamp - a.timestamp)[0];
        
        homeNewsGrid.innerHTML = `
            <article class="news-card">
                <div class="news-date">${newsManager.formatDate(latestArticle.date)}</div>
                <h3>${newsManager.escapeHtml(latestArticle.title)}</h3>
                <p>${newsManager.escapeHtml(latestArticle.content)}</p>
                <a href="news.html" class="news-link">Read More →</a>
            </article>
        `;
    }
}

// Call this function when the page loads if we're on the homepage
if (window.location.pathname === '/' || window.location.pathname.endsWith('index.html')) {
    document.addEventListener('DOMContentLoaded', updateHomepageNews);
}
