# YTEngage — YouTube-style engagement prototype

A YouTube-looking prototype for experimenting with user engagement features on
top of video playback. This first iteration covers **in-app YouTube search**
and **video playback**, plus a starter set of local engagement interactions
(likes, comments, subscribe, share) to build on.

## Running it

No build step — it's a static single-page app.

```bash
# from the repo root, any static server works:
npx serve .
# or
python3 -m http.server 8000
```

Then open http://localhost:8000 (or the port your server prints).

> Opening `index.html` directly from disk mostly works too, but serving it
> over HTTP is recommended so the YouTube IFrame player behaves consistently.

## Search: demo mode vs. real YouTube search

- **Demo mode (default, zero setup):** without an API key the app shows a
  bundled catalog of embeddable sample videos (Blender open movies, the first
  YouTube video, etc.). Search filters within that catalog, and playback is
  fully functional.
- **Real YouTube search:** click the **gear icon** (top right) and paste a
  **YouTube Data API v3** key. Search then queries all of YouTube
  (24 results, embeddable videos only). The key is stored only in your
  browser's `localStorage` — it never touches the repo or a server.

### Getting a free API key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com).
2. Create (or pick) a project and click **Enable** on "YouTube Data API v3".
3. Under **APIs & Services → Credentials**, create an **API key**.
4. Paste it into the app's Settings dialog.

The free quota (10,000 units/day; a search costs 100 units) is plenty for
prototyping.

## What's implemented

- YouTube-style dark UI: top bar with search, collapsible sidebar, suggestion
  chips, responsive video grid.
- Watch page with the official **YouTube IFrame Player** (autoplay, up-next
  rail from the current result set).
- Engagement starters, persisted in `localStorage` per video:
  - Like / dislike with counts
  - Local comments
  - Subscribe / unsubscribe per channel
  - Share (copies the real YouTube URL)

## Ideas for the next engagement iterations

- Timed comments / reactions anchored to playback position (the IFrame API
  exposes `getCurrentTime()`).
- Live emoji reaction bursts over the player.
- Polls and quizzes that pause the video at set timestamps.
- Watch parties: synced playback state across viewers.
- A "moments" heatmap showing where viewers reacted most.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell and all views (grid, watch page, settings modal) |
| `styles.css` | YouTube-style dark theme |
| `app.js` | Search (Data API v3 + demo fallback), player, engagement state |
