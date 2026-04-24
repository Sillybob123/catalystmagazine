// ============================================
// THE CATALYST MAGAZINE - DATA
// ============================================
//
// Articles are sourced exclusively from Firestore (the `stories` collection).
// This file used to carry a hardcoded mirror of every article, but those
// entries linked out to old catalyst-magazine.com/post/... Wix URLs that now
// 404, and any time a title/slug drifted between the two sources the stale
// copy survived the merge and rendered as a dead-link card on the articles
// page. Keeping these arrays empty makes Firestore the single source of
// truth and prevents that class of bug from coming back.

const heroSlides = [];
const articles = [];
const editorials = [];

// Expose data to main.js (it reads from window.articles)
if (typeof window !== 'undefined') {
    window.heroSlides = heroSlides;
    window.articles = articles;
    window.editorials = editorials;
}
