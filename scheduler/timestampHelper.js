// ===============================
// Timestamp Helper - Fixes null timestamp issues
// ===============================

/**
 * Safely gets a timestamp value, handling pending server timestamps
 * @param {*} timestamp - Firebase timestamp or null
 * @returns {Date} - Valid Date object
 */
function getTimestampValue(timestamp) {
    if (!timestamp) {
        // If timestamp is null (pending server timestamp), use current time
        return new Date();
    }
    
    if (timestamp.seconds !== undefined) {
        // Firestore Timestamp object
        return new Date(timestamp.seconds * 1000);
    }
    
    if (timestamp instanceof Date) {
        // Already a Date object
        return timestamp;
    }
    
    if (typeof timestamp === 'string') {
        // String date
        return new Date(timestamp);
    }
    
    // Fallback to current time
    return new Date();
}

/**
 * Safely renders an activity feed with proper timestamp handling
 * @param {Array} activity - Array of activity items
 * @returns {string} - HTML string for activity feed
 */
function renderActivityWithTimestamps(activity) {
    if (!activity || activity.length === 0) {
        return '<p>No activity yet.</p>';
    }
    
    const sortedActivity = [...activity].sort((a, b) => {
        const aTime = getTimestampValue(a.timestamp).getTime();
        const bTime = getTimestampValue(b.timestamp).getTime();
        return bTime - aTime;
    });
    
    return sortedActivity.map(item => {
        const timestamp = getTimestampValue(item.timestamp);
        const timeString = timestamp.toLocaleString();
        
        return `
            <div class="feed-item">
                <div class="user-avatar" style="background-color: ${stringToColor(item.authorName)}">
                    ${item.authorName.charAt(0)}
                </div>
                <div class="feed-content">
                    <p><span class="author">${item.authorName}</span> ${item.text}</p>
                    <span class="timestamp">${timeString}</span>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Checks if a document has pending server timestamps
 * @param {Object} doc - Firestore document data
 * @returns {boolean} - True if has pending timestamps
 */
function hasPendingTimestamps(doc) {
    if (!doc) return false;
    
    // Check common timestamp fields
    if (doc.createdAt === null) return true;
    if (doc.updatedAt === null) return true;
    
    // Check activity timestamps
    if (doc.activity && Array.isArray(doc.activity)) {
        return doc.activity.some(item => item.timestamp === null);
    }
    
    return false;
}

/**
 * Normalizes a document by replacing null timestamps with current time
 * @param {Object} doc - Firestore document data
 * @returns {Object} - Normalized document
 */
function normalizeDocument(doc) {
    if (!doc) return doc;
    
    const normalized = { ...doc };
    const now = new Date();
    
    // Normalize createdAt
    if (normalized.createdAt === null) {
        normalized.createdAt = { seconds: Math.floor(now.getTime() / 1000) };
    }
    
    // Normalize updatedAt
    if (normalized.updatedAt === null) {
        normalized.updatedAt = { seconds: Math.floor(now.getTime() / 1000) };
    }
    
    // Normalize activity timestamps
    if (normalized.activity && Array.isArray(normalized.activity)) {
        normalized.activity = normalized.activity.map(item => {
            if (item.timestamp === null) {
                return {
                    ...item,
                    timestamp: { seconds: Math.floor(now.getTime() / 1000) }
                };
            }
            return item;
        });
    }
    
    return normalized;
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getTimestampValue,
        renderActivityWithTimestamps,
        hasPendingTimestamps,
        normalizeDocument
    };
}
