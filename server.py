#!/usr/bin/env python3
"""YTEngage dev server.

Serves the static app and adds two JSON endpoints used by the
"before you watch" quiz feature:

  GET  /api/transcript?v=<videoId>   -> {"text": ..., "segments": [...], "language": ...}
  POST /api/question                 -> {"question", "options", "correct_index", "explanation", "kind"}
        body: {"title": str, "transcript": str}

Transcripts come from YouTube's InnerTube player API (no API key needed).
Question generation uses the Gemini API when GEMINI_API_KEY is set — either
in the environment or in a .env file next to this script (see .env.example);
otherwise it falls back to a transcript-based cloze question so the app works
with zero setup. No third-party packages required.

Run:  python3 server.py [port]     (default port 8000)
"""

import base64
import json
import os
import random
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


def load_dotenv(path=None):
    """Minimal .env loader (KEY=value lines, # comments, optional quotes).

    Real environment variables take precedence over .env entries.
    """
    if path is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("'\"")
            if key and key not in os.environ:
                os.environ[key] = value


load_dotenv()

# ---------------------------------------------------------------------------
# Transcript fetching (three strategies, most reliable first)
# ---------------------------------------------------------------------------

WEB_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
WEB_HEADERS = {
    "User-Agent": WEB_UA,
    "Accept-Language": "en-US,en;q=0.9",
    # Skips the EU consent interstitial, which otherwise hides player data
    "Cookie": "CONSENT=YES+cb; SOCS=CAI",
}
WEB_CONTEXT = {
    "client": {"clientName": "WEB", "clientVersion": "2.20250101.00.00", "hl": "en"}
}
INNERTUBE_TRANSCRIPT_URL = (
    "https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false"
)
INNERTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"


def _http_json(url, payload=None, headers=None, timeout=15):
    body = _http_raw(url, payload=payload, headers=headers, timeout=timeout)
    if not body.strip():
        raise RuntimeError("empty response body")
    return json.loads(body)


def _http_raw(url, payload=None, headers=None, timeout=15):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers or {})
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _walk(node, key):
    """Yield every value for `key` anywhere in a nested JSON structure."""
    if isinstance(node, dict):
        if key in node:
            yield node[key]
        for value in node.values():
            yield from _walk(value, key)
    elif isinstance(node, list):
        for item in node:
            yield from _walk(item, key)


def _transcript_via_get_transcript(video_id):
    """Primary: the same endpoint the YouTube web UI uses for its transcript
    panel. Not subject to the proof-of-origin token requirement that breaks
    timedtext caption URLs."""
    # params = protobuf field 1 (bytes) = videoId, base64-encoded
    params = base64.b64encode(
        b"\x0a" + bytes([len(video_id)]) + video_id.encode()
    ).decode()
    data = _http_json(
        INNERTUBE_TRANSCRIPT_URL,
        payload={"context": WEB_CONTEXT, "params": params},
        headers=WEB_HEADERS,
    )
    segments = []
    for seg_list in _walk(data, "transcriptSegmentListRenderer"):
        for seg in seg_list.get("initialSegments", []):
            renderer = seg.get("transcriptSegmentRenderer")
            if not renderer:
                continue
            text = "".join(
                run.get("text", "")
                for run in renderer.get("snippet", {}).get("runs", [])
            ).strip()
            if text:
                segments.append(
                    {"start": int(renderer.get("startMs", 0)) / 1000.0, "text": text}
                )
        if segments:
            break
    if not segments:
        raise RuntimeError("get_transcript returned no segments")
    return segments, "unknown"


def _segments_from_caption_tracks(tracks):
    def score(t):
        lang = t.get("languageCode", "")
        auto = t.get("kind") == "asr"
        return (0 if lang.startswith("en") else 1, 1 if auto else 0)

    track = sorted(tracks, key=score)[0]
    url = track["baseUrl"].replace("&fmt=srv3", "")
    url += ("&" if "?" in url else "?") + "fmt=json3"
    timed = _http_json(url, headers=WEB_HEADERS)
    segments = []
    for event in timed.get("events", []):
        text = "".join(seg.get("utf8", "") for seg in event.get("segs", []))
        text = text.replace("\n", " ").strip()
        if text:
            segments.append(
                {"start": event.get("tStartMs", 0) / 1000.0, "text": text}
            )
    if not segments:
        raise RuntimeError("caption track was empty")
    return segments, track.get("languageCode", "unknown")


def _transcript_via_player_api(video_id):
    """Fallback: InnerTube player API -> captionTracks -> timedtext."""
    player = _http_json(
        INNERTUBE_PLAYER_URL,
        payload={"context": WEB_CONTEXT, "videoId": video_id},
        headers=WEB_HEADERS,
    )
    status = player.get("playabilityStatus", {}).get("status", "OK")
    if status not in ("OK", "CONTENT_CHECK_REQUIRED"):
        raise RuntimeError(f"player API status {status}")
    tracks = (
        player.get("captions", {})
        .get("playerCaptionsTracklistRenderer", {})
        .get("captionTracks", [])
    )
    if not tracks:
        raise RuntimeError("player API: video has no caption tracks")
    return _segments_from_caption_tracks(tracks)


def _transcript_via_watch_page(video_id):
    """Last resort: scrape captionTracks out of the watch page HTML."""
    html = _http_raw(
        f"https://www.youtube.com/watch?v={video_id}&hl=en", headers=WEB_HEADERS
    )
    match = re.search(r'"captionTracks":(\[.*?\])(?=,\s*")', html)
    if not match:
        raise RuntimeError("watch page: no captionTracks found")
    tracks = json.loads(match.group(1))
    return _segments_from_caption_tracks(tracks)


def fetch_transcript(video_id):
    """Return {"text", "segments", "language"} or raise RuntimeError."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{5,20}", video_id):
        raise RuntimeError("invalid video id")

    errors = []
    for strategy in (
        _transcript_via_get_transcript,
        _transcript_via_player_api,
        _transcript_via_watch_page,
    ):
        try:
            segments, language = strategy(video_id)
            return {
                "text": " ".join(s["text"] for s in segments),
                "segments": segments,
                "language": language,
            }
        except Exception as exc:
            errors.append(f"{strategy.__name__}: {exc}")
            print(f"[transcript] {video_id} {strategy.__name__} failed: {exc}")

    raise RuntimeError("; ".join(errors))


# ---------------------------------------------------------------------------
# Question generation — Gemini API (preferred) with a heuristic fallback
# ---------------------------------------------------------------------------

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)

# Gemini structured-output schema (OpenAPI-style subset).
QUESTION_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "question": {"type": "STRING"},
        "options": {"type": "ARRAY", "items": {"type": "STRING"}},
        "correct_index": {"type": "INTEGER"},
        "explanation": {"type": "STRING"},
        "kind": {
            "type": "STRING",
            "enum": ["misconception", "challenge", "prediction"],
        },
    },
    "required": ["question", "options", "correct_index", "explanation", "kind"],
}

QUESTION_PROMPT = """You are creating a short "before you watch" engagement question \
for a YouTube video, based on its transcript. Find the most interesting misconception \
the video corrects, or a genuinely thought-provoking challenge/prediction question the \
video answers. The viewer has NOT watched the video yet, so the question must be \
answerable from general intuition — and ideally most people get it wrong, so the video \
becomes the payoff.

Write exactly 4 answer options (one correct). Keep the question under 40 words and \
each option under 15 words. The explanation (under 50 words) should tease what the \
video reveals without spoiling everything.

Video title: {title}

Transcript:
{transcript}"""


def gemini_question(title, transcript):
    """Generate a question with the Gemini API. Returns a dict or None."""
    if not GEMINI_API_KEY:
        return None

    try:
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {
                            "text": QUESTION_PROMPT.format(
                                title=title, transcript=transcript[:60000]
                            )
                        }
                    ],
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": QUESTION_SCHEMA,
                "temperature": 0.7,
            },
        }
        result = _http_json(
            GEMINI_URL.format(model=GEMINI_MODEL),
            payload=payload,
            headers={"x-goog-api-key": GEMINI_API_KEY},
            timeout=30,
        )
        text = result["candidates"][0]["content"]["parts"][0]["text"]
        data = json.loads(text)
        if len(data.get("options", [])) == 4 and 0 <= data.get("correct_index", -1) <= 3:
            data["source"] = "gemini"
            return data
        print(f"[question] Gemini returned malformed data, using fallback: {data}")
    except Exception as exc:
        print(f"[question] Gemini generation failed, using fallback: {exc}")
    return None


STOPWORDS = set(
    """the a an and or but if then this that these those is are was were be been being
    have has had do does did will would can could should may might must not no of in
    on at to for with from by about as into like through after before between out
    against during without within it its it's we you they he she i my your our their
    his her them him us me so just very really actually going gonna want know think
    see get got make made one two thing things right okay yeah well now here there
    what when where which who how why all some any more most other than too also
    over under while because many much such even still each both few own same very""".split()
)


def heuristic_question(title, transcript):
    """Zero-dependency fallback: a fill-in-the-blank question from the transcript."""
    words = re.findall(r"[A-Za-z][A-Za-z'-]{3,}", transcript)
    content_words = [w for w in words if w.lower() not in STOPWORDS]
    if len(content_words) < 12:
        return None

    freq = Counter(w.lower() for w in content_words)

    sentences = re.split(r"(?<=[.!?])\s+", transcript)
    if len(sentences) < 3:
        # Auto-captions often lack punctuation; chunk by word count instead.
        chunks, step = [], 22
        toks = transcript.split()
        for i in range(0, len(toks), step):
            chunks.append(" ".join(toks[i : i + step]))
        sentences = chunks

    # Pick an informative sentence from the middle of the video.
    lo, hi = int(len(sentences) * 0.2), max(int(len(sentences) * 0.8), 2)
    candidates = [s for s in sentences[lo:hi] if 8 <= len(s.split()) <= 40]
    if not candidates:
        candidates = [s for s in sentences if len(s.split()) >= 8] or sentences

    def sentence_score(s):
        toks = [w for w in re.findall(r"[A-Za-z][A-Za-z'-]{3,}", s)]
        return sum(freq.get(w.lower(), 0) for w in toks if w.lower() not in STOPWORDS)

    sentence = max(candidates, key=sentence_score)

    sent_words = [
        w
        for w in re.findall(r"[A-Za-z][A-Za-z'-]{3,}", sentence)
        if w.lower() not in STOPWORDS
    ]
    if not sent_words:
        return None
    target = max(sent_words, key=lambda w: (freq.get(w.lower(), 0), len(w)))

    distractor_pool = [
        w
        for w, _ in freq.most_common(40)
        if w != target.lower() and w not in sentence.lower()
    ]
    if len(distractor_pool) < 3:
        return None
    distractors = random.sample(distractor_pool[:15], 3)

    options = distractors + [target.lower()]
    random.shuffle(options)
    blanked = re.sub(re.escape(target), "_____", sentence, count=1)

    return {
        "question": f'Fill in the blank — at one point this video says: "{blanked}"',
        "options": options,
        "correct_index": options.index(target.lower()),
        "explanation": f'The video says: "{sentence.strip()}" Watch to hear it in context!',
        "kind": "challenge",
        "source": "heuristic",
    }


def build_question(title, transcript):
    return gemini_question(title, transcript) or heuristic_question(title, transcript)


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------


class Handler(SimpleHTTPRequestHandler):
    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/transcript"):
            from urllib.parse import parse_qs, urlparse

            video_id = parse_qs(urlparse(self.path).query).get("v", [""])[0]
            try:
                self._send_json(fetch_transcript(video_id))
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=502)
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/question":
            try:
                length = int(self.headers.get("Content-Length", 0))
                payload = json.loads(self.rfile.read(length) or b"{}")
                title = str(payload.get("title", ""))[:300]
                transcript = str(payload.get("transcript", ""))
                if len(transcript) < 200:
                    self._send_json({"error": "transcript too short"}, status=400)
                    return
                question = build_question(title, transcript)
                if question is None:
                    self._send_json({"error": "could not build a question"}, status=502)
                    return
                self._send_json(question)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)
            return
        self.send_error(404)

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"YTEngage running at http://localhost:{PORT}")
    if GEMINI_API_KEY:
        print(f"Question generation: Gemini ({GEMINI_MODEL})")
    else:
        print(
            "Question generation: heuristic fallback "
            "(set GEMINI_API_KEY for Gemini-written questions)"
        )
    server.serve_forever()
