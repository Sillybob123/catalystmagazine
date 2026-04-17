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
    const authorInitial = (author || 'A').trim().charAt(0).toUpperCase();

    const dateFormatted = new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    // Rough reading time (200 wpm)
    const wordCount = (content || '').replace(/<[^>]+>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
    const readMinutes = Math.max(1, Math.round(wordCount / 200));

    let tagsHTML = '';
    if (tags && tags.length > 0) {
        tagsHTML = tags.map(tag => {
            const safeTag = escapeHtml(tag);
            return `<a class="tag-pill" href="../../articles.html?tag=${encodeURIComponent(tag)}">#${safeTag}</a>`;
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
    <meta name="description" content="${safeDeck || safeTitle + ' - The Catalyst Magazine'}">
    <title>${safeTitle} | The Catalyst Magazine</title>

    <!-- Favicons -->
    <link rel="icon" type="image/png" sizes="32x32" href="../../favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="../../favicon-16x16.png">
    <link rel="apple-touch-icon" sizes="180x180" href="../../apple-touch-icon.png">
    <link rel="manifest" href="../../site.webmanifest">

    <!-- Open Graph / Social Media -->
    <meta property="og:type" content="article">
    <meta property="og:title" content="${safeTitle} | The Catalyst Magazine">
    <meta property="og:description" content="${safeDeck || safeTitle + ' - The Catalyst Magazine'}">
    <meta property="og:image" content="${safeCoverImage}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${safeTitle} | The Catalyst Magazine">
    <meta name="twitter:description" content="${safeDeck || safeTitle + ' - The Catalyst Magazine'}">
    <meta name="twitter:image" content="${safeCoverImage}">

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Source+Serif+Pro:ital,wght@0,400;0,600;0,700;1,400&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="../../css/styles.css">
    <link rel="stylesheet" href="../../css/article-premium.css">
</head>
<body data-page="article">
    <!-- Google Tag Manager (noscript) -->
    <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-TV2SBHW5"
    height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
    <!-- End Google Tag Manager (noscript) -->

    <!-- Reading progress bar -->
    <div id="reading-progress" class="reading-progress" aria-hidden="true"><span></span></div>

    <!-- Floating back link -->
    <a href="../../articles.html" class="article-back-fab" aria-label="Back to articles">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        <span>Back</span>
    </a>

    <div id="site-header"></div>

    <main>
        <!-- CNN/NYT style full-bleed hero -->
        <header class="article-hero">
            <div class="article-hero__image" style="background-image:url('${safeCoverImage}')"></div>
            <div class="article-hero__scrim"></div>
            <div class="article-hero__inner">
                <span class="article-hero__category">${safeCategory}</span>
                <h1 class="article-hero__title">${safeTitle}</h1>
                ${safeDeck ? `<p class="article-hero__deck">${safeDeck}</p>` : ''}
                <div class="article-hero__meta">
                    <span class="article-hero__avatar" aria-hidden="true">${escapeHtml(authorInitial)}</span>
                    <span class="article-hero__author">By ${safeAuthor}</span>
                    <span class="article-hero__dot">·</span>
                    <span class="article-hero__date">${dateFormatted}</span>
                    <span class="article-hero__dot">·</span>
                    <span class="article-hero__read">${readMinutes} min read</span>
                </div>
            </div>
        </header>

        <section class="article-body-wrap">
            <article class="article-body">${content}</article>

            ${tagsHTML ? `<div class="article-tags-row">${tagsHTML}</div>` : ''}

            <aside class="article-byline">
                <div class="article-byline__avatar" aria-hidden="true">${escapeHtml(authorInitial)}</div>
                <div class="article-byline__body">
                    <div class="article-byline__label">Written by</div>
                    <div class="article-byline__name">${safeAuthor}</div>
                    <div class="article-byline__bio">Contributor, The Catalyst Magazine</div>
                </div>
            </aside>

            <div class="article-share" role="group" aria-label="Share this article">
                <span class="article-share__label">Share this story</span>
                <a class="article-share__btn article-share__btn--twitter" target="_blank" rel="noopener"
                   href="https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2H21l-6.52 7.45L22.5 22h-6.77l-4.74-6.2L5.4 22H2.64l6.97-7.97L1.5 2h6.86l4.29 5.65L18.244 2Zm-1.19 18h1.77L7.03 4H5.13l11.924 16Z"/></svg>
                </a>
                <a class="article-share__btn article-share__btn--linkedin" target="_blank" rel="noopener"
                   href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent('')}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.452 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.851-3.037-1.853 0-2.136 1.446-2.136 2.94v5.666H9.356V9h3.414v1.561h.047c.476-.9 1.637-1.85 3.37-1.85 3.602 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.06 2.06 0 01-2.063-2.06 2.06 2.06 0 012.063-2.06 2.06 2.06 0 012.062 2.06 2.06 2.06 0 01-2.062 2.06zm1.777 13.019H3.56V9h3.554v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.226.792 24 1.771 24h20.451C23.2 24 24 23.226 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                </a>
                <button class="article-share__btn article-share__btn--copy" type="button" onclick="(function(btn){navigator.clipboard.writeText(window.location.href).then(()=>{btn.classList.add('is-copied');setTimeout(()=>btn.classList.remove('is-copied'),1800);});})(this)" aria-label="Copy link">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
            </div>
        </section>
    </main>

    <div id="site-footer"></div>

    <script>
      // Reading progress bar
      (function(){
        var bar = document.querySelector('#reading-progress span');
        if (!bar) return;
        function onScroll(){
          var h = document.documentElement;
          var max = h.scrollHeight - h.clientHeight;
          var pct = max > 0 ? (h.scrollTop / max) * 100 : 0;
          bar.style.width = pct + '%';
        }
        window.addEventListener('scroll', onScroll, { passive:true });
        onScroll();
      })();
    </script>
    <script src="../../js/layout.js"></script>
    <script src="../../js/newsletter-handler.js"></script>
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
