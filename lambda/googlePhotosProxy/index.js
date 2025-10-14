// Google Photos Proxy Lambda
// Fetches photos from a public Google Photos shared album

const https = require('https');

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    try {
        const shareUrl = event.queryStringParameters?.shareUrl;
        
        if (!shareUrl) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'shareUrl parameter is required' })
            };
        }

        // Extract album ID from share URL
        const albumIdMatch = shareUrl.match(/(?:photos\.app\.goo\.gl\/|share\/)([a-zA-Z0-9_-]+)/);
        if (!albumIdMatch) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Invalid Google Photos share URL' })
            };
        }

        const albumId = albumIdMatch[1];
        
        // Fetch the album page
        const html = await fetchAlbumPage(shareUrl);
        
        // Parse photo URLs from the HTML
        const photos = parsePhotosFromHTML(html);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                albumId,
                photos,
                count: photos.length
            })
        };

    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: 'Failed to fetch photos',
                message: error.message 
            })
        };
    }
};

function fetchAlbumPage(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                resolve(data);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

function parsePhotosFromHTML(html) {
    const photos = [];
    
    // Google Photos embeds photo data in the page
    // Look for the photo URLs in the HTML
    // Pattern: https://lh3.googleusercontent.com/[photoId]
    const photoRegex = /https:\/\/lh3\.googleusercontent\.com\/[a-zA-Z0-9_-]+/g;
    const matches = html.match(photoRegex);
    
    if (matches) {
        // Deduplicate and format
        const uniqueUrls = [...new Set(matches)];
        
        uniqueUrls.forEach((url, index) => {
            // Skip very small images (likely thumbnails or icons)
            if (url.includes('=s')) {
                return;
            }
            
            photos.push({
                url: url,
                thumbnail: `${url}=s400`, // 400px thumbnail
                caption: `Photo ${index + 1}`,
                width: 1920,
                height: 1080
            });
        });
    }
    
    return photos;
}

