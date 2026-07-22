# YTEngage — YouTube-style engagement prototype

A YouTube-looking prototype for experimenting with user engagement features on
top of video playback. This first iteration covers **in-app YouTube search**
and **video playback**, plus a starter set of local engagement interactions
(likes, comments, subscribe, share) to build on.

## Running it

No build step and no packages to install — Python 3 standard library only.

```bash
# One-time: put your Gemini key in a .env file (gitignored)
cp .env.example .env    # then edit .env and paste your key

# Recommended: makes transcript fetching reliable against YouTube's
# anti-bot changes (the app still runs without it)
pip install youtube-transcript-api

python3 server.py
```

Then open http://localhost:8000.

`server.py` serves the static app plus two endpoints powering the
"before you watch" quiz: `/api/transcript` (fetches the video's captions from
YouTube) and `/api/question` (turns the transcript into a question).
Any plain static server (`npx serve .`) still works too — you just lose the
transcript-based questions for real YouTube videos; the demo catalog keeps
its built-in questions.

### Gemini API key (for AI-written questions)

`server.py` reads `GEMINI_API_KEY` from a `.env` file in the repo root (see
`.env.example`) or from the environment — environment variables win if both
are set. `.env` is gitignored so the key can't be committed. Get one free at
[Google AI Studio](https://aistudio.google.com/apikey). Optionally pick a
model with `GEMINI_MODEL` (default: `gemini-2.5-flash`). Without a key, the
server builds a fill-in-the-blank question from the transcript instead.

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
- Watch page with the official **YouTube IFrame Player** (up-next rail from
  the current result set).
- **Before-you-watch quiz**: when you open a video, the app fetches its
  transcript, finds a misconception / challenge / prediction question
  (Gemini-written, or heuristic without a key), and asks you before the video
  plays. Answer or skip — then playback starts. Demo videos ship with
  hand-written questions so this works offline. Results are stored per video
  in `localStorage`.
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
| `index.html` | App shell and all views (grid, watch page, quiz + settings modals) |
| `styles.css` | YouTube-style dark theme |
| `app.js` | Search (Data API v3 + demo fallback), player, quiz flow, engagement state |
| `server.py` | Static server + `/api/transcript` (YouTube captions) + `/api/question` (Gemini or heuristic) |
