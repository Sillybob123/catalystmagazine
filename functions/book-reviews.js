// GET /book-reviews — the static page plus a crawlable list of every review.
// See functions/_utils/story-index.js.

import { withStoryIndex } from "./_utils/story-index.js";

export const onRequestGet = (context) =>
  withStoryIndex(context, { reviews: true, heading: "Every book review from The Catalyst" });
