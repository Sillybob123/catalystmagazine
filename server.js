// Simple Express server to handle article publishing
// Run with: node server.js

const express = require('express');
const cors = require('cors');
const path = require('path');
const { publishArticle, deleteArticle } = require('./publish-article');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Friendly routes without .html extensions
app.get(['/article', '/article/'], (req, res) => {
    res.sendFile(path.join(__dirname, 'article.html'));
});

app.get(['/articles', '/articles/'], (req, res) => {
    res.sendFile(path.join(__dirname, 'articles.html'));
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
});

// Publish article endpoint (Node-first; also used to mimic PHP generator)
const handlePublish = (req, res) => {
    try {
        const { storyId, title, deck = '', content, coverImage, category, author, date, tags } = req.body;

        // Validate required fields
        if (!storyId || !title || !content || !coverImage || !category || !author || !date) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['storyId', 'title', 'content', 'coverImage', 'category', 'author', 'date']
            });
        }

        // Publish the article
        const result = publishArticle({
            storyId,
            title,
            deck,
            content,
            coverImage,
            category,
            author,
            date,
            tags: tags || []
        });

        res.json(result);

    } catch (error) {
        console.error('Error publishing article:', error);
        res.status(500).json({
            error: 'Failed to publish article',
            message: error.message
        });
    }
};

app.post('/api/publish-article', handlePublish);
// Allow POST to generate-article.php path so fallback works even without PHP runtime
app.post('/generate-article.php', handlePublish);
app.options('/generate-article.php', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(200);
});

// Delete article endpoint
app.post('/api/delete-article', (req, res) => {
    try {
        const { storyId } = req.body;

        if (!storyId) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['storyId']
            });
        }

        const result = deleteArticle(storyId);
        res.json(result);
    } catch (error) {
        console.error('Error deleting article:', error);
        res.status(500).json({
            error: 'Failed to delete article',
            message: error.message
        });
    }
});

// Start server
app.use(express.static('.')); // Serve static files (after API routes to avoid intercepting POSTs)
app.listen(PORT, () => {
    console.log(`\n🚀 Server is running on http://localhost:${PORT}`);
    console.log(`📝 Article publishing API available at http://localhost:${PORT}/api/publish-article\n`);
});

module.exports = app;
