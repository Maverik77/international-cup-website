// Photo Gallery Manager
class PhotoGallery {
    constructor() {
        this.albums = [];
        this.currentAlbum = null;
        this.currentPhotoIndex = 0;
        this.slideshowInterval = null;
        this.slideshowSpeed = 3000; // 3 seconds
        this.photoCache = {}; // Cache loaded photos
    }

    async init() {
        try {
            const response = await fetch('./data/photos.json');
            this.albums = await response.json();
            this.renderYearSelection();
        } catch (error) {
            console.error('Failed to load photo albums:', error);
            this.showError('Failed to load photo albums. Please try again later.');
        }
    }

    // Extract album ID from Google Photos share URL
    extractAlbumId(shareUrl) {
        // Google Photos share URLs: https://photos.app.goo.gl/xxxxx
        // or https://photos.google.com/share/xxxxx
        const match = shareUrl.match(/(?:photos\.app\.goo\.gl\/|share\/)([a-zA-Z0-9_-]+)/);
        return match ? match[1] : null;
    }

    // Load photos from Google Photos shared album
    async loadPhotosFromGoogleAlbum(album) {
        const albumId = this.extractAlbumId(album.shareUrl);
        
        if (!albumId) {
            console.error('Invalid Google Photos share URL');
            return [];
        }

        // Check cache first
        if (this.photoCache[albumId]) {
            return this.photoCache[albumId];
        }

        try {
            // Use Google Photos album JSON endpoint (works for public shared albums)
            // This endpoint returns album data without authentication
            const embedUrl = `https://photos.app.goo.gl/${albumId}`;
            
            // Since we can't directly fetch due to CORS, we'll use an iframe approach
            // For now, return a message to use the manual setup
            // In production, you'd set up a simple backend proxy or use the embed viewer
            
            // Alternative: Use the RSS feed if available
            // For this implementation, we'll provide a fallback message
            return this.fetchAlbumViaProxy(embedUrl, albumId);
            
        } catch (error) {
            console.error('Failed to load photos from Google Photos:', error);
            return [];
        }
    }

    async fetchAlbumViaProxy(url, albumId) {
        try {
            // Use the Google Photos proxy API endpoint
            const apiUrl = `${window.location.origin.includes('staging') 
                ? 'https://9iz68mvngi.execute-api.us-east-1.amazonaws.com/prod'
                : 'https://p6t8fgm1qf.execute-api.us-east-1.amazonaws.com/prod'}/google-photos?shareUrl=${encodeURIComponent(url)}`;
            
            const response = await fetch(apiUrl);
            
            if (!response.ok) {
                throw new Error(`API returned ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.photos && data.photos.length > 0) {
                // Cache the results
                this.photoCache[albumId] = data.photos;
                return data.photos;
            }
            
            return [];
        } catch (error) {
            console.error('Failed to fetch via proxy:', error);
            return [];
        }
    }

    renderYearSelection() {
        const container = document.getElementById('year-selection');
        const grid = document.getElementById('years-grid');
        
        if (!grid) return;

        // Sort albums by year (newest first)
        const sortedAlbums = [...this.albums].sort((a, b) => parseInt(b.year) - parseInt(a.year));

        grid.innerHTML = sortedAlbums.map(album => `
            <div class="year-card" onclick="photoGallery.showAlbum('${album.year}')">
                <div class="year-card-image">${album.year}</div>
                <div class="year-card-content">
                    <h3>${album.title}</h3>
                    <p>${album.description}</p>
                </div>
                <div class="year-card-footer">
                    ${album.photos.length} ${album.photos.length === 1 ? 'photo' : 'photos'}
                </div>
            </div>
        `).join('');

        container.style.display = 'block';
    }

    async showAlbum(year) {
        this.currentAlbum = this.albums.find(album => album.year === year);
        
        if (!this.currentAlbum) return;

        // Hide year selection
        document.getElementById('year-selection').style.display = 'none';
        
        // Show gallery with loading state
        const gallerySection = document.getElementById('gallery-section');
        gallerySection.classList.add('active');
        
        // Update header
        document.getElementById('gallery-year').textContent = this.currentAlbum.title;
        document.getElementById('gallery-description').textContent = this.currentAlbum.description;
        
        // Show loading state
        document.getElementById('photos-grid').innerHTML = `
            <div class="loading" style="grid-column: 1/-1;">
                <div class="loading-spinner"></div>
                <p>Loading photos...</p>
            </div>
        `;
        
        // Load photos from Google Photos if shareUrl is provided
        if (this.currentAlbum.shareUrl && this.currentAlbum.shareUrl !== 'PASTE_YOUR_GOOGLE_PHOTOS_SHARE_LINK_HERE') {
            const photos = await this.loadPhotosFromGoogleAlbum(this.currentAlbum);
            this.currentAlbum.photos = photos;
        }
        
        // Fallback to photos array if available
        if (!this.currentAlbum.photos || this.currentAlbum.photos.length === 0) {
            this.currentAlbum.photos = [];
            document.getElementById('photos-grid').innerHTML = `
                <div class="loading" style="grid-column: 1/-1;">
                    <p style="color: #e53e3e;">No photos found. Please configure the Google Photos share URL in data/photos.json or add photos manually.</p>
                    <p style="margin-top: 1rem;"><a href="PHOTOS_SETUP.md" style="color: #667eea;">View setup instructions →</a></p>
                </div>
            `;
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        
        // Render photos
        this.renderPhotos();
        
        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    renderPhotos() {
        const grid = document.getElementById('photos-grid');
        
        grid.innerHTML = this.currentAlbum.photos.map((photo, index) => `
            <div class="photo-item" onclick="photoGallery.openLightbox(${index})">
                <img src="${photo.thumbnail}" alt="${photo.caption}" loading="lazy">
                <div class="photo-caption">${photo.caption}</div>
            </div>
        `).join('');
    }

    backToYears() {
        // Stop slideshow if running
        this.stopSlideshow();
        
        // Hide gallery
        document.getElementById('gallery-section').classList.remove('active');
        
        // Show year selection
        document.getElementById('year-selection').style.display = 'block';
        
        // Reset current album
        this.currentAlbum = null;
        
        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    toggleSlideshow() {
        const btn = document.getElementById('btn-slideshow');
        
        if (this.slideshowInterval) {
            this.stopSlideshow();
        } else {
            this.startSlideshow();
        }
    }

    startSlideshow() {
        const btn = document.getElementById('btn-slideshow');
        btn.classList.add('playing');
        btn.innerHTML = '<span>⏸</span> Pause Slideshow';
        
        // Open lightbox with first photo if not already open
        if (!document.getElementById('lightbox').classList.contains('active')) {
            this.openLightbox(0);
        }
        
        // Auto-advance photos
        this.slideshowInterval = setInterval(() => {
            this.nextPhoto();
        }, this.slideshowSpeed);
    }

    stopSlideshow() {
        const btn = document.getElementById('btn-slideshow');
        btn.classList.remove('playing');
        btn.innerHTML = '<span>▶</span> Start Slideshow';
        
        if (this.slideshowInterval) {
            clearInterval(this.slideshowInterval);
            this.slideshowInterval = null;
        }
    }

    openLightbox(index) {
        this.currentPhotoIndex = index;
        const lightbox = document.getElementById('lightbox');
        const photo = this.currentAlbum.photos[index];
        
        document.getElementById('lightbox-image').src = photo.url;
        document.getElementById('lightbox-caption').textContent = photo.caption;
        document.getElementById('lightbox-counter').textContent = 
            `${index + 1} / ${this.currentAlbum.photos.length}`;
        
        lightbox.classList.add('active');
        
        // Prevent body scroll
        document.body.style.overflow = 'hidden';
    }

    closeLightbox() {
        const lightbox = document.getElementById('lightbox');
        lightbox.classList.remove('active');
        
        // Stop slideshow when closing
        this.stopSlideshow();
        
        // Restore body scroll
        document.body.style.overflow = 'auto';
    }

    nextPhoto() {
        this.currentPhotoIndex = (this.currentPhotoIndex + 1) % this.currentAlbum.photos.length;
        this.updateLightbox();
    }

    prevPhoto() {
        this.currentPhotoIndex = (this.currentPhotoIndex - 1 + this.currentAlbum.photos.length) % this.currentAlbum.photos.length;
        this.updateLightbox();
    }

    updateLightbox() {
        const photo = this.currentAlbum.photos[this.currentPhotoIndex];
        const img = document.getElementById('lightbox-image');
        
        // Fade effect
        img.style.opacity = '0';
        
        setTimeout(() => {
            img.src = photo.url;
            document.getElementById('lightbox-caption').textContent = photo.caption;
            document.getElementById('lightbox-counter').textContent = 
                `${this.currentPhotoIndex + 1} / ${this.currentAlbum.photos.length}`;
            img.style.opacity = '1';
        }, 150);
    }

    showError(message) {
        const container = document.getElementById('year-selection');
        container.innerHTML = `
            <div class="loading">
                <p style="color: #e53e3e; font-size: 1.2rem;">${message}</p>
            </div>
        `;
    }

    handleKeyboard(event) {
        if (!document.getElementById('lightbox').classList.contains('active')) {
            return;
        }

        switch(event.key) {
            case 'Escape':
                this.closeLightbox();
                break;
            case 'ArrowLeft':
                this.prevPhoto();
                break;
            case 'ArrowRight':
                this.nextPhoto();
                break;
        }
    }
}

// Initialize gallery
const photoGallery = new PhotoGallery();

// Setup event listeners
document.addEventListener('DOMContentLoaded', function() {
    photoGallery.init();
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => photoGallery.handleKeyboard(e));
    
    // Click outside lightbox to close
    document.getElementById('lightbox')?.addEventListener('click', function(e) {
        if (e.target === this) {
            photoGallery.closeLightbox();
        }
    });
});

