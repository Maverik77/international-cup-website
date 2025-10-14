// Photo Gallery Manager
class PhotoGallery {
    constructor() {
        this.albums = [];
        this.currentAlbum = null;
        this.currentPhotoIndex = 0;
        this.slideshowInterval = null;
        this.slideshowSpeed = 3000; // 3 seconds
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

    showAlbum(year) {
        this.currentAlbum = this.albums.find(album => album.year === year);
        
        if (!this.currentAlbum) return;

        // Hide year selection
        document.getElementById('year-selection').style.display = 'none';
        
        // Show gallery
        const gallerySection = document.getElementById('gallery-section');
        gallerySection.classList.add('active');
        
        // Update header
        document.getElementById('gallery-year').textContent = this.currentAlbum.title;
        document.getElementById('gallery-description').textContent = this.currentAlbum.description;
        
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

