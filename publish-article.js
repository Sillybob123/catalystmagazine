// Node.js script to publish articles automatically
// This can be run as a Firebase Cloud Function or as a local server

const fs = require('fs');
const path = require('path');

function generateSlug(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/[\s-]+/g, '-')
        .trim()
        .replace(/^-+|-+$/g, '');
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function generateExcerpt(htmlContent, maxLength = 200) {
    if (!htmlContent) return '';

    // Strip HTML tags
    const text = htmlContent
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Truncate to maxLength
    if (text.length <= maxLength) {
        return text;
    }

    // Find the last complete word within maxLength
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');

    return truncated.substring(0, lastSpace) + '...';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function generateArticleHTML(data) {
    const { title, deck = '', content, coverImage, category, author, date, tags = [] } = data;

    const safeTitle = escapeHtml(title);
    const safeAuthor = escapeHtml(author);
    const safeCategory = escapeHtml(category);
    const safeCoverImage = escapeHtml(coverImage);
    const safeDeck = deck ? escapeHtml(deck) : '';

    const dateFormatted = new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    let tagsHTML = '';
    if (tags && tags.length > 0) {
        tagsHTML = tags.map(tag => {
            const safeTag = escapeHtml(tag);
            return `<span class="article-tag">${safeTag}</span>`;
        }).join('');
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <!-- Google Tag Manager -->
    <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
    new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
    j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
    'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
    })(window,document,'script','dataLayer','GTM-TV2SBHW5');</script>
    <!-- End Google Tag Manager -->

    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${safeTitle} - The Catalyst Magazine">
    <title>${safeTitle} | The Catalyst Magazine</title>

    <!-- Favicons -->
    <link rel="icon" type="image/png" sizes="32x32" href="../../favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="../../favicon-16x16.png">
    <link rel="apple-touch-icon" sizes="180x180" href="../../apple-touch-icon.png">
    <link rel="manifest" href="../../site.webmanifest">

    <!-- Open Graph / Social Media -->
    <meta property="og:type" content="article">
    <meta property="og:title" content="${safeTitle} | The Catalyst Magazine">
    <meta property="og:description" content="${safeTitle} - The Catalyst Magazine">
    <meta property="og:image" content="${safeCoverImage}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${safeTitle} | The Catalyst Magazine">
    <meta name="twitter:description" content="${safeTitle} - The Catalyst Magazine">
    <meta name="twitter:image" content="${safeCoverImage}">

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="../../css/styles.css">

    <style>
        .article-detail-header {
            margin-bottom: 40px;
        }

        .article-detail-category {
            display: inline-block;
            padding: 8px 18px;
            background: var(--accent-gradient);
            border-radius: var(--radius-full);
            font-size: 0.8rem;
            font-weight: 600;
            color: white;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 20px;
        }

        .article-detail-title {
            font-size: clamp(2rem, 4vw, 3rem);
            font-weight: 800;
            line-height: 1.2;
            margin-bottom: 20px;
            color: var(--text-dark);
        }

        .article-deck {
            font-size: 20px;
            color: var(--text-muted);
            line-height: 1.6;
            margin-bottom: 24px;
        }

        .article-detail-meta {
            display: flex;
            align-items: center;
            gap: 20px;
            font-size: 1rem;
            color: var(--text-muted);
        }

        .article-detail-image {
            width: 100%;
            border-radius: var(--radius-xl);
            overflow: hidden;
            margin-bottom: 40px;
            box-shadow: var(--glass-shadow-lg);
        }

        .article-detail-image img {
            width: 100%;
            height: 100%;
            display: block;
            object-fit: cover;
        }

        .article-detail-content {
            background: rgba(255, 255, 255, 0.92);
            backdrop-filter: blur(16px);
            border: 1px solid #e5e7eb;
            border-radius: var(--radius-xl);
            padding: 48px;
            box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
        }

        .article-detail-content p {
            font-size: 1.1rem;
            line-height: 1.9;
            color: var(--text-body);
            margin-bottom: 24px;
        }

        .article-detail-content h1,
        .article-detail-content h2,
        .article-detail-content h3 {
            font-weight: 700;
            margin: 48px 0 24px;
            color: var(--text-dark);
        }

        .article-detail-content h1 { font-size: 1.8rem; }
        .article-detail-content h2 {
            font-size: 1.6rem;
            padding-bottom: 12px;
            border-bottom: 2px solid var(--accent-primary);
        }
        .article-detail-content h3 { font-size: 1.4rem; }

        .article-detail-content img {
            max-width: 100%;
            border-radius: var(--radius-sm);
            margin: 32px 0;
        }

        .article-detail-content blockquote {
            border-left: 4px solid var(--accent-primary);
            padding-left: 24px;
            margin: 32px 0;
            font-style: italic;
            color: var(--text-muted);
            font-size: 1.15rem;
        }

        .article-detail-content ul,
        .article-detail-content ol {
            margin: 24px 0;
            padding-left: 32px;
        }

        .article-detail-content li {
            margin-bottom: 12px;
            line-height: 1.8;
        }

        .article-detail-content code {
            background: var(--bg-light);
            padding: 3px 8px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
        }

        .article-detail-content pre {
            background: var(--bg-light);
            padding: 20px;
            border-radius: var(--radius-sm);
            overflow-x: auto;
            margin: 24px 0;
        }

        .article-detail-content a {
            color: var(--accent-primary);
            text-decoration: none;
            font-weight: 600;
        }

        .article-detail-content a:hover {
            text-decoration: underline;
        }

        .article-tags {
            margin-top: 48px;
            padding-top: 32px;
            border-top: 1px solid #e5e7eb;
        }

        .article-tag {
            display: inline-block;
            padding: 8px 16px;
            margin-right: 12px;
            margin-bottom: 12px;
            background: var(--bg-light);
            border-radius: var(--radius-full);
            font-size: 14px;
            color: var(--text-muted);
            font-weight: 500;
        }

        @media (max-width: 768px) {
            .article-detail-content {
                padding: 32px 24px;
            }
        }
    </style>
</head>
<body data-page="article">
    <!-- Google Tag Manager (noscript) -->
    <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-TV2SBHW5"
    height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
    <!-- End Google Tag Manager (noscript) -->

    <!-- Animated Background Blobs -->
    <div class="bg-blobs">
        <div class="blob blob-1"></div>
        <div class="blob blob-2"></div>
        <div class="blob blob-3"></div>
        <div class="blob blob-4"></div>
    </div>

    <div id="site-header"></div>

    <main>
        <section class="article-page">
            <div class="container">
                <a href="../../articles.html" class="back-link">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M19 12H5M12 19l-7-7 7-7"/>
                    </svg>
                    Back to Articles
                </a>

                <div class="article-detail">
                    <div class="article-detail-header">
                        <span class="article-detail-category">${safeCategory}</span>
                        <h1 class="article-detail-title">${safeTitle}</h1>
                        ${safeDeck ? `<p class="article-deck">${safeDeck}</p>` : ''}
                        <div class="article-detail-meta">
                            <span>${safeAuthor}</span>
                            <span>•</span>
                            <span>${dateFormatted}</span>
                        </div>
                    </div>

                    <div class="article-detail-image">
                        <img src="${safeCoverImage}" alt="${safeTitle}">
                    </div>

                    <div class="article-detail-content">
                        ${content}
                    </div>

                    ${tagsHTML ? `<div class="article-tags">${tagsHTML}</div>` : ''}
                </div>
            </div>
        </section>
    </main>

    <div id="site-footer"></div>

    <script src="../../js/layout.js"></script>
    <script src="../../js/mailchimp-handler.js"></script>
</body>
</html>`;
}

function publishArticle(storyData) {
    const { storyId, title, deck = '', content, coverImage, category, author, date, tags } = storyData;

    // Generate slug and filename
    const slug = generateSlug(title);
    const filename = `${slug}-${String(storyId).substring(0, 8)}.html`;

    // Create directory if it doesn't exist
    const articleDir = path.join(__dirname, 'posts', 'published');
    if (!fs.existsSync(articleDir)) {
        fs.mkdirSync(articleDir, { recursive: true });
    }

    // Generate HTML
    const html = generateArticleHTML(storyData);

    // Write file
    const filepath = path.join(articleDir, filename);
    fs.writeFileSync(filepath, html, 'utf8');

    // Generate excerpt from content or use deck
    const excerpt = deck || generateExcerpt(content);

    // Format date consistently (e.g., "Jan 22, 2026")
    const formattedDate = formatDate(date);

    // Update data.js
    updateDataJS({
        id: storyId,
        title,
        image: coverImage,
        category: category.toLowerCase(),
        author,
        date: formattedDate,
        deck: deck || '',
        excerpt: excerpt,
        tags,
        url: `posts/published/${filename}`,
        link: `posts/published/${filename}`
    });

    return {
        success: true,
        filename,
        filepath,
        url: `/posts/published/${filename}`
    };
}

function updateDataJS(articleData) {
    const dataJsPath = path.join(__dirname, 'js', 'data.js');

    if (!fs.existsSync(dataJsPath)) {
        console.error('data.js not found');
        return;
    }

    let content = fs.readFileSync(dataJsPath, 'utf8');

    // Remove any existing entry with the same id to avoid duplicates
    // More robust regex that handles multiline object with nested arrays
    const lines = content.split('\n');
    const filtered = [];
    let skipUntilComma = false;
    let braceCount = 0;
    let inTargetObject = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Check if this line starts an object with our target ID
        if (line.includes('"id"') && line.includes(`"${articleData.id}"`)) {
            inTargetObject = true;
            braceCount = 0;
            continue;
        }

        if (inTargetObject) {
            // Count braces to track object depth
            for (const char of line) {
                if (char === '{') braceCount++;
                if (char === '}') braceCount--;
            }

            // If we've closed all braces, we're done with this object
            if (line.includes('},') || (line.includes('}') && braceCount <= 0)) {
                inTargetObject = false;
                continue;
            }
            continue;
        }

        filtered.push(line);
    }

    content = filtered.join('\n');

    // Clean up any double commas or empty lines
    content = content.replace(/,\s*,/g, ',');
    content = content.replace(/\[\s*,/g, '[');

    // Convert article data to JS object literal (not JSON - no quotes around property names)
    const tagsStr = Array.isArray(articleData.tags) && articleData.tags.length > 0
        ? `[${articleData.tags.map(t => `"${t}"`).join(', ')}]`
        : '[]';

    const articleEntry = `  {
    id: "${articleData.id}",
    title: "${articleData.title}",
    image: "${articleData.image}",
    category: "${articleData.category}",
    author: "${articleData.author}",
    date: "${articleData.date}",
    deck: "${articleData.deck || ''}",
    excerpt: "${articleData.excerpt || ''}",
    tags: ${tagsStr},
    url: "${articleData.url}",
    link: "${articleData.link}"
  }`;

    // Find the articles array and add the new article at the beginning
    if (content.includes('const articles = [')) {
        content = content.replace(
            /(const articles = \[)/,
            `$1\n${articleEntry},`
        );

        fs.writeFileSync(dataJsPath, content, 'utf8');
        console.log('Updated data.js with new article');
    }
}

function deleteArticle(storyId) {
    if (!storyId) {
        return { success: false, error: 'Missing storyId' };
    }

    // Delete HTML file (match by storyId snippet)
    const articleDir = path.join(__dirname, 'posts', 'published');
    if (fs.existsSync(articleDir)) {
        const files = fs.readdirSync(articleDir);
        const snippet = storyId.substring(0, 8);
        const match = files.find(f => f.includes(snippet));
        if (match) {
            const filepath = path.join(articleDir, match);
            try {
                fs.unlinkSync(filepath);
                console.log(`Deleted HTML file: ${filepath}`);
            } catch (err) {
                console.error('Error deleting HTML file:', err);
            }
        }
    }

    removeFromDataJS(storyId);

    return {
        success: true,
        message: 'Article deleted successfully'
    };
}

function removeFromDataJS(storyId) {
    const dataJsPath = path.join(__dirname, 'js', 'data.js');

    if (!fs.existsSync(dataJsPath)) {
        console.error('data.js not found');
        return;
    }

    let content = fs.readFileSync(dataJsPath, 'utf8');

    // Match both string IDs and numeric IDs
    const patterns = [
        new RegExp(`\\s*\\{[^}]*"id"\\s*:\\s*"${storyId}"[\\s\\S]*?\\},?\\n?`, 'g'),
        new RegExp(`\\s*\\{[^}]*id\\s*:\\s*"${storyId}"[\\s\\S]*?\\},?\\n?`, 'g')
    ];

    patterns.forEach(pattern => {
        content = content.replace(pattern, '\n');
    });

    fs.writeFileSync(dataJsPath, content, 'utf8');
    console.log('Removed article from data.js');
}

// Export for use in other modules or Firebase Functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        publishArticle,
        deleteArticle,
        generateArticleHTML,
        generateSlug
    };
}

// Example usage:
// const result = publishArticle({
//     storyId: 'abc123',
//     title: 'My Amazing Article',
//     content: '<p>Article content here...</p>',
//     coverImage: 'https://example.com/image.jpg',
//     category: 'Feature',
//     author: 'John Doe',
//     date: '2026-01-19',
//     tags: ['science', 'technology']
// });
