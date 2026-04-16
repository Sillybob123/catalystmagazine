// js/admin-publish-bridge.js
// Drop-in helper: `await publishStory(storyId)` from any admin page.
// It grabs the currently signed-in user's Firebase ID token and POSTs to
// /api/publish. The server verifies the token, publishes the story, and
// (every 3 published stories) triggers the newsletter.
//
// Expose a global `window.catalystPublish` so non-module code can call it.

import { auth } from './firebase-config.js';

async function publishStory(storyId) {
  if (!storyId) throw new Error('storyId is required');
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to publish');

  const token = await user.getIdToken(/* forceRefresh */ false);

  const res = await fetch('/api/publish', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ storyId }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.ok) {
    const message = payload.error || `Publish failed (HTTP ${res.status})`;
    throw new Error(message);
  }
  return payload;
}

window.catalystPublish = publishStory;
export { publishStory };
