<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Accept POST (preferred) and GET (fallback when POST is blocked)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
} else {
    // Build input from query parameters for GET fallback
    $input = [
        'storyId' => $_GET['storyId'] ?? null,
        'title' => $_GET['title'] ?? null,
        'deck' => $_GET['deck'] ?? '',
        'content' => $_GET['content'] ?? null,
        'coverImage' => $_GET['coverImage'] ?? null,
        'category' => $_GET['category'] ?? null,
        'author' => $_GET['author'] ?? null,
        'date' => $_GET['date'] ?? null,
        'tags' => isset($_GET['tags']) ? explode(',', $_GET['tags']) : []
    ];
}

if (!$input) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON or query params']);
    exit();
}

// Validate required fields
$requiredFields = ['storyId', 'title', 'content', 'coverImage', 'category', 'author', 'date'];
foreach ($requiredFields as $field) {
    if (!isset($input[$field])) {
        http_response_code(400);
        echo json_encode(['error' => "Missing required field: $field"]);
        exit();
    }
}

// Extract data
$storyId = $input['storyId'];
$title = htmlspecialchars($input['title'], ENT_QUOTES, 'UTF-8');
$content = $input['content']; // Already HTML from Quill
$coverImage = htmlspecialchars($input['coverImage'], ENT_QUOTES, 'UTF-8');
$category = htmlspecialchars($input['category'], ENT_QUOTES, 'UTF-8');
$author = htmlspecialchars($input['author'], ENT_QUOTES, 'UTF-8');
$tags = isset($input['tags']) ? $input['tags'] : [];
$date = date('F j, Y', strtotime($input['date']));
$slug = generateSlug($title);

// Create article directory if it doesn't exist
$articleDir = __DIR__ . '/posts/published';
if (!is_dir($articleDir)) {
    mkdir($articleDir, 0755, true);
}

// Generate unique filename
$filename = $slug . '-' . substr($storyId, 0, 8) . '.html';
$filepath = $articleDir . '/' . $filename;

// Generate HTML content
$html = generateArticleHTML($title, $content, $coverImage, $category, $author, $date, $tags);

// Write file
if (file_put_contents($filepath, $html) === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to write article file']);
    exit();
}

// Update data.js with new article
updateDataJS($storyId, $title, $coverImage, $category, $author, $date, $tags, $filename);

http_response_code(200);
echo json_encode([
    'success' => true,
    'filename' => $filename,
    'url' => '/article?id=' . $storyId
]);

function generateSlug($text) {
    // Convert to lowercase
    $text = strtolower($text);
    // Remove special characters
    $text = preg_replace('/[^a-z0-9\s-]/', '', $text);
    // Replace spaces with hyphens
    $text = preg_replace('/[\s-]+/', '-', $text);
    // Trim hyphens from ends
    $text = trim($text, '-');
    return $text;
}

function generateArticleHTML($title, $content, $coverImage, $category, $author, $date, $tags) {
    $tagsHTML = '';
    if (!empty($tags)) {
        $tagsHTML = '<div style="margin-top: 24px;">';
        foreach ($tags as $tag) {
            $tag = htmlspecialchars($tag, ENT_QUOTES, 'UTF-8');
            $tagsHTML .= '<span style="display: inline-block; padding: 6px 12px; margin-right: 8px; background: var(--bg-light); border-radius: var(--radius-full); font-size: 13px; color: var(--text-muted);">' . $tag . '</span>';
        }
        $tagsHTML .= '</div>';
    }

    return <<<HTML
<!DOCTYPE html>
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
    <meta name="description" content="$title - The Catalyst Magazine">
    <title>$title | The Catalyst Magazine</title>

    <!-- Favicons -->
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="manifest" href="/site.webmanifest">

    <!-- Open Graph / Social Media -->
    <meta property="og:type" content="article">
    <meta property="og:url" content="https://www.catalyst-magazine.com/posts/published/$filename">
    <meta property="og:title" content="$title | The Catalyst Magazine">
    <meta property="og:description" content="$title - The Catalyst Magazine">
    <meta property="og:image" content="$coverImage">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:url" content="https://www.catalyst-magazine.com/posts/published/$filename">
    <meta name="twitter:title" content="$title | The Catalyst Magazine">
    <meta name="twitter:description" content="$title - The Catalyst Magazine">
    <meta name="twitter:image" content="$coverImage">

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/css/styles.css">

    <style>
        .article-header {
            margin-bottom: 32px;
        }

        .article-category {
            display: inline-block;
            padding: 6px 16px;
            background: var(--accent-gradient);
            color: white;
            border-radius: var(--radius-full);
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 16px;
        }

        .article-title {
            font-size: 42px;
            font-weight: 700;
            color: var(--text-dark);
            margin-bottom: 16px;
            line-height: 1.2;
        }

        .article-meta {
            display: flex;
            gap: 16px;
            font-size: 15px;
            color: var(--text-muted);
        }

        .article-cover {
            width: 100%;
            border-radius: var(--radius-lg);
            margin-bottom: 40px;
        }

        .article-content {
            font-size: 17px;
            line-height: 1.8;
            color: var(--text-body);
        }

        .article-content h1,
        .article-content h2,
        .article-content h3 {
            color: var(--text-dark);
            margin-top: 32px;
            margin-bottom: 16px;
            font-weight: 700;
        }

        .article-content h1 {
            font-size: 32px;
        }

        .article-content h2 {
            font-size: 28px;
        }

        .article-content h3 {
            font-size: 24px;
        }

        .article-content p {
            margin-bottom: 20px;
        }

        .article-content img {
            max-width: 100%;
            border-radius: var(--radius-sm);
            margin: 24px 0;
        }

        .article-content blockquote {
            border-left: 4px solid var(--accent-primary);
            padding-left: 20px;
            margin: 24px 0;
            font-style: italic;
            color: var(--text-muted);
        }

        .article-content ul,
        .article-content ol {
            margin: 20px 0;
            padding-left: 24px;
        }

        .article-content li {
            margin-bottom: 8px;
        }

        .article-content code {
            background: var(--bg-light);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 14px;
        }

        .article-content pre {
            background: var(--bg-light);
            padding: 16px;
            border-radius: var(--radius-sm);
            overflow-x: auto;
            margin: 20px 0;
        }

        .article-content a {
            color: var(--accent-primary);
            text-decoration: none;
            font-weight: 600;
        }

        .article-content a:hover {
            text-decoration: underline;
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
                <a href="/articles" class="back-link">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M19 12H5M12 19l-7-7 7-7"/>
                    </svg>
                    Back to Articles
                </a>

                <article>
                    <div class="article-header">
                        <span class="article-category">$category</span>
                        <h1 class="article-title">$title</h1>
                        <div class="article-meta">
                            <span>By $author</span>
                            <span>•</span>
                            <span>$date</span>
                        </div>
                    </div>

                    <img src="$coverImage" alt="$title" class="article-cover">

                    <div class="article-content">
                        $content
                    </div>

                    $tagsHTML
                </article>
            </div>
        </section>
    </main>

    <div id="site-footer"></div>

    <script src="/js/layout.js"></script>
    <script src="/js/mailchimp-handler.js"></script>
</body>
</html>
HTML;
}

function updateDataJS($storyId, $title, $coverImage, $category, $author, $date, $tags, $filename) {
    $dataJsPath = __DIR__ . '/js/data.js';

    // Create article entry for data.js
    $articleEntry = [
        'id' => $storyId,
        'title' => $title,
        'image' => $coverImage,
        'category' => $category,
        'author' => $author,
        'date' => $date,
        'tags' => $tags,
        'url' => 'posts/published/' . $filename
    ];

    // Read existing data.js
    if (file_exists($dataJsPath)) {
        $dataJsContent = file_get_contents($dataJsPath);

        // Check if the articles array exists
        if (strpos($dataJsContent, 'const articles = [') !== false) {
            // Add new article to the beginning of the array
            $newArticleJSON = json_encode($articleEntry, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            $newArticleJS = str_replace(['{', '}'], ['  {', '  }'], $newArticleJSON);

            // Insert after "const articles = ["
            $dataJsContent = preg_replace(
                '/(const articles = \[)/',
                "$1\n$newArticleJS,",
                $dataJsContent,
                1
            );

            file_put_contents($dataJsPath, $dataJsContent);
        }
    }
}
?>
