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

function fetchAlbumPage(url, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) {
            reject(new Error('Too many redirects'));
            return;
        }
        
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (res) => {
            // Handle redirects (301, 302, 307, 308)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = res.headers.location.startsWith('http') 
                    ? res.headers.location 
                    : `https://photos.google.com${res.headers.location}`;
                
                resolve(fetchAlbumPage(redirectUrl, redirectCount + 1));
                return;
            }
            
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
    
    // Google Photos embeds photo data in the page as URLs in various formats
    // We need to capture long photo IDs that can include many special characters
    // Format: https://lh3.googleusercontent.com/[path]/[base64-like-id][optional-size-params]
    // Use a more permissive pattern to capture everything up to whitespace or quotes
    const photoRegex = /https:\/\/lh3\.googleusercontent\.com\/[^\s"'<>]+/gi;
    const matches = html.match(photoRegex);
    
    if (matches) {
        console.log(`Found ${matches.length} URL matches`);
        
        // Deduplicate and format
        const uniqueUrls = [...new Set(matches)];
        const seenBaseUrls = new Set();
        
        uniqueUrls.forEach((url) => {
            // Extract base URL (without size parameters like =s400 or =w1920)
            const baseUrl = url.replace(/=(s|w|h|d)\d+.*$/, '');
            
            // Skip duplicates (same photo with different sizes)
            if (seenBaseUrls.has(baseUrl)) {
                return;
            }
            
            // Skip very small icons (likely UI elements, not photos)
            if (url.match(/=s(16|24|32|48|64)($|-|\/)/)) {
                return;
            }
            
            // Google Photos IDs can vary in length
            // Domain https://lh3.googleusercontent.com/ is 31 chars
            // IDs are typically 20-150+ chars, so base URL should be 51+ chars minimum
            if (baseUrl.length < 55) {
                console.log(`Skipping short URL: ${baseUrl} (length: ${baseUrl.length})`);
                return;
            }
            
            seenBaseUrls.add(baseUrl);
            
            photos.push({
                url: `${baseUrl}=w1920-h1080`, // High res version
                thumbnail: `${baseUrl}=s400`, // 400px square thumbnail
                caption: `Photo ${seenBaseUrls.size}`,
                width: 1920,
                height: 1080
            });
        });
        
        console.log(`Returning ${photos.length} unique photos`);
    }
    
    return photos;
}

