// GET /articles — the static page plus a crawlable list of every story.
// See functions/_utils/story-index.js.

import { withStoryIndex } from "./_utils/story-index.js";

export const onRequestGet = (context) =>
  withStoryIndex(context, { reviews: false, heading: "Every story from The Catalyst" });
