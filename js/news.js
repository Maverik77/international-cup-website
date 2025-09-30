// Simple News Management System - Read from static JSON file
class NewsManager {
    constructor() {
        this.newsUrl = './data/news.json';
        this.cache = null;
        this.cacheExpiry = null;
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    // Get all news articles from static JSON file
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

    // Format date for display
    formatDate(dateString) {
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        return new Date(dateString).toLocaleDateString('en-US', options);
    }

    // Escape HTML to prevent XSS, but allow safe internal links
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Process content to allow safe internal links
    processContent(content) {
        // First escape all HTML
        let processed = this.escapeHtml(content);
        
        // Then allow specific safe internal links
        // Pattern: [Link Text](#section) or [Link Text](/page)
        processed = processed.replace(
            /\[([^\]]+)\]\((#[a-zA-Z0-9-]+|\/[a-zA-Z0-9-\/]*)\)/g,
            '<a href="$2" class="news-link">$1</a>'
        );
        
        return processed;
    }
}

// Initialize news manager and update homepage immediately
document.addEventListener('DOMContentLoaded', function() {
    window.newsManager = new NewsManager();
    
    // Update homepage news immediately after initialization
    if (window.location.pathname === '/' || window.location.pathname.endsWith('index.html')) {
        updateHomepageNews();
    }
});

// Update homepage news section
async function updateHomepageNews() {
    try {
        // Ensure newsManager is available
        if (!window.newsManager) {
            setTimeout(updateHomepageNews, 100);
            return;
        }
        
        const articles = await window.newsManager.getNews();
        
        // Update the news section on index.html if it exists
        const homeNewsGrid = document.querySelector('#homepage-news-grid');
        if (homeNewsGrid && articles.length > 0) {
            // Show the last 3 articles on homepage
            const sortedArticles = articles.sort((a, b) => b.timestamp - a.timestamp);
            const recentArticles = sortedArticles.slice(0, 3);
            
            const articlesHTML = recentArticles.map(article => `
                <article class="news-card">
                    <div class="news-date">${window.newsManager.formatDate(article.date)}</div>
                    <h3>${window.newsManager.escapeHtml(article.title)}</h3>
                    <p>${window.newsManager.processContent(article.content)}</p>
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
        
        const articles = await window.newsManager.getNews();
        
        // Sort articles by date (newest first)
        const sortedArticles = articles.sort((a, b) => b.timestamp - a.timestamp);
        
        // Generate HTML for all articles
        const articlesHTML = sortedArticles.map(article => `
            <article class="modal-news-card">
                <div class="news-date">${window.newsManager.formatDate(article.date)}</div>
                <h3>${window.newsManager.escapeHtml(article.title)}</h3>
                <p>${window.newsManager.processContent(article.content)}</p>
            </article>
        `).join('');
        
        container.innerHTML = articlesHTML;
    } catch (error) {
        console.error('Error loading news in modal:', error);
        document.getElementById('all-news-container').innerHTML = 
            '<p>Error loading news articles. Please try again later.</p>';
    }
}