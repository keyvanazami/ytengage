/* ============ YTEngage — YouTube-style prototype ============
 * Search YouTube (Data API v3) and play videos (IFrame Player API).
 * Falls back to bundled demo videos when no API key is configured.
 * Likes / comments / subscriptions are stored in localStorage as a
 * foundation for the engagement features coming next.
 */

"use strict";

// ---------- State ----------

const LS_KEYS = {
  apiKey: "ytengage.apiKey",
  engagement: "ytengage.engagement", // { [videoId]: { liked, disliked, likes, comments: [] } }
  subs: "ytengage.subs",             // { [channelName]: true }
};

const state = {
  apiKey: localStorage.getItem(LS_KEYS.apiKey) || "",
  results: [],        // current list shown in the grid
  currentVideo: null, // video object being watched
  player: null,       // YT.Player instance
  playerReady: false,
  pendingVideoId: null,
};

// ---------- Demo catalog (works without an API key; all embeddable) ----------

const DEMO_VIDEOS = [
  {
    id: "jNQXAC9IVRw",
    title: "Me at the zoo — the first video ever uploaded to YouTube",
    channel: "jawed",
    description:
      "The first video on YouTube, uploaded on April 23, 2005. A great test clip for prototypes.",
    publishedAt: "2005-04-23T00:00:00Z",
  },
  {
    id: "aqz-KE-bpKQ",
    title: "Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film",
    channel: "Blender",
    description:
      "The classic open-movie short film by the Blender Foundation. Free to use, perfect demo footage.",
    publishedAt: "2014-11-10T00:00:00Z",
  },
  {
    id: "eRsGyueVLvQ",
    title: "Sintel - Third Open Movie by Blender Foundation",
    channel: "Blender",
    description: "Blender Foundation's third open movie, 'Sintel'.",
    publishedAt: "2010-09-30T00:00:00Z",
  },
  {
    id: "R6MlUcmOul8",
    title: "Caminandes 3: Llamigos - Blender Animated Short",
    channel: "Blender",
    description: "Llama-based comedy short from the Blender Institute.",
    publishedAt: "2016-01-27T00:00:00Z",
  },
  {
    id: "WhWc3b3KhnY",
    title: "Spring - Blender Open Movie",
    channel: "Blender",
    description: "Poetic fantasy short film made entirely with Blender.",
    publishedAt: "2019-04-04T00:00:00Z",
  },
  {
    id: "_cMxraX_5RE",
    title: "Coffee Run - Blender Open Movie",
    channel: "Blender",
    description: "A caffeinated sprint through memories. Blender open movie.",
    publishedAt: "2020-05-29T00:00:00Z",
  },
];

// Hand-written "before you watch" questions for the demo catalog, so the
// quiz flow works with no server and no network access.
const DEMO_QUESTIONS = {
  jNQXAC9IVRw: {
    kind: "misconception",
    question:
      "The very first YouTube video ever uploaded was about which of these?",
    options: [
      "A music video",
      "Elephants at the zoo",
      "A tech product demo",
      "A cat playing piano",
    ],
    correct_index: 1,
    explanation:
      "Many people assume YouTube launched with music or cat videos — but the first upload, by co-founder Jawed Karim in April 2005, is 19 seconds of elephants at the San Diego Zoo.",
  },
  "aqz-KE-bpKQ": {
    kind: "misconception",
    question: "Why did the Blender Foundation make Big Buck Bunny?",
    options: [
      "As a paid streaming release",
      "To advertise a game",
      "To prove open-source software can make pro films",
      "As a school project",
    ],
    correct_index: 2,
    explanation:
      "Big Buck Bunny is an 'open movie': made entirely with free, open-source tools to push Blender's development — and released free for anyone to use.",
  },
  eRsGyueVLvQ: {
    kind: "prediction",
    question:
      "Sintel is named after something in the film. What do you predict it is?",
    options: [
      "The dragon she raises",
      "The main character herself",
      "The city where it begins",
      "Her sword",
    ],
    correct_index: 1,
    explanation:
      "Sintel is the protagonist's name — but her bond with the baby dragon Scales is the heart of the story. Watch for the twist ending.",
  },
  R6MlUcmOul8: {
    kind: "prediction",
    question:
      "In Caminandes 3, a llama battles a rival over food. Who is the rival?",
    options: ["A penguin", "Another llama", "A park ranger", "A fox"],
    correct_index: 0,
    explanation:
      "Koro the llama faces off against a very determined penguin. Three minutes of Patagonian slapstick — see who wins.",
  },
  WhWc3b3KhnY: {
    kind: "challenge",
    question:
      "Spring was made entirely with open-source tools. How large do you think the core team was?",
    options: [
      "About 8 people",
      "Around 50 people",
      "Over 200 people",
      "One person",
    ],
    correct_index: 0,
    explanation:
      "A team of roughly eight artists and developers made this studio-quality short — a showcase of what tiny teams can do with Blender.",
  },
  _cMxraX_5RE: {
    kind: "prediction",
    question:
      "Coffee Run plays out inside something unusual. What do you predict frames the story?",
    options: [
      "A single cup of coffee being drunk",
      "A video game speedrun",
      "A dream sequence",
      "A phone screen",
    ],
    correct_index: 0,
    explanation:
      "The whole film unfolds during one coffee — a literal 'coffee run' through bittersweet memories. Watch how the ending lands.",
  },
};

const SUGGESTED_CHIPS = [
  "All",
  "Lo-fi beats",
  "Space documentaries",
  "Cooking basics",
  "TED talks",
  "Blender shorts",
  "Live concerts",
];

// ---------- DOM helpers ----------

const $ = (id) => document.getElementById(id);

const els = {
  searchForm: $("searchForm"),
  searchInput: $("searchInput"),
  videoGrid: $("videoGrid"),
  resultsView: $("resultsView"),
  watchView: $("watchView"),
  spinner: $("spinner"),
  notice: $("notice"),
  chipsRow: $("chipsRow"),
  watchTitle: $("watchTitle"),
  watchChannel: $("watchChannel"),
  watchChannelAvatar: $("watchChannelAvatar"),
  watchMeta: $("watchMeta"),
  watchDescription: $("watchDescription"),
  upNextList: $("upNextList"),
  likeBtn: $("likeBtn"),
  likeCount: $("likeCount"),
  dislikeBtn: $("dislikeBtn"),
  shareBtn: $("shareBtn"),
  subscribeBtn: $("subscribeBtn"),
  commentForm: $("commentForm"),
  commentInput: $("commentInput"),
  commentList: $("commentList"),
  commentsTitle: $("commentsTitle"),
  settingsModal: $("settingsModal"),
  apiKeyInput: $("apiKeyInput"),
  toast: $("toast"),
  quizModal: $("quizModal"),
  quizKind: $("quizKind"),
  quizLoading: $("quizLoading"),
  quizLoadingText: $("quizLoadingText"),
  quizBody: $("quizBody"),
  quizQuestion: $("quizQuestion"),
  quizOptions: $("quizOptions"),
  quizFeedback: $("quizFeedback"),
  quizSkipBtn: $("quizSkipBtn"),
  quizPlayBtn: $("quizPlayBtn"),
};

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  show(els.toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(els.toast), 2600);
}

function thumbUrl(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const units = [
    [31536000000, "year"],
    [2592000000, "month"],
    [604800000, "week"],
    [86400000, "day"],
    [3600000, "hour"],
    [60000, "minute"],
  ];
  for (const [ms, name] of units) {
    const n = Math.floor(diff / ms);
    if (n >= 1) return `${n} ${name}${n > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

const AVATAR_COLORS = ["#e53935", "#8e24aa", "#3949ab", "#00897b", "#f4511e", "#546e7a", "#6d4c41"];
function avatarColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// ---------- Engagement store (localStorage) ----------

function loadEngagement() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.engagement)) || {}; }
  catch { return {}; }
}
function saveEngagement(data) {
  localStorage.setItem(LS_KEYS.engagement, JSON.stringify(data));
}
function videoEngagement(id) {
  const all = loadEngagement();
  return all[id] || { liked: false, disliked: false, likes: 0, comments: [] };
}
function updateEngagement(id, patch) {
  const all = loadEngagement();
  all[id] = { ...videoEngagement(id), ...patch };
  saveEngagement(all);
  return all[id];
}

function loadSubs() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.subs)) || {}; }
  catch { return {}; }
}
function toggleSub(channel) {
  const subs = loadSubs();
  if (subs[channel]) delete subs[channel];
  else subs[channel] = true;
  localStorage.setItem(LS_KEYS.subs, JSON.stringify(subs));
  return !!subs[channel];
}

// ---------- Search ----------

async function search(query) {
  showResultsView();
  hide(els.notice);
  els.videoGrid.innerHTML = "";
  show(els.spinner);

  try {
    const videos = state.apiKey
      ? await searchYouTubeApi(query)
      : searchDemo(query);
    state.results = videos;
    renderGrid(videos, query);
  } catch (err) {
    console.error(err);
    els.notice.innerHTML =
      `<strong>Search failed:</strong> ${escapeHtml(err.message)}. ` +
      `Falling back to demo videos. Check your API key in Settings (gear icon).`;
    show(els.notice);
    state.results = searchDemo(query);
    renderGrid(state.results, query);
  } finally {
    hide(els.spinner);
  }
}

async function searchYouTubeApi(query) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    part: "snippet",
    q: query,
    type: "video",
    maxResults: "24",
    videoEmbeddable: "true",
    safeSearch: "moderate",
    key: state.apiKey,
  });

  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return (data.items || [])
    .filter((it) => it.id?.videoId)
    .map((it) => ({
      id: it.id.videoId,
      title: decodeEntities(it.snippet.title),
      channel: decodeEntities(it.snippet.channelTitle),
      description: decodeEntities(it.snippet.description || ""),
      publishedAt: it.snippet.publishedAt,
      thumb: it.snippet.thumbnails?.high?.url || it.snippet.thumbnails?.medium?.url,
    }));
}

function searchDemo(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q || q === "all") return [...DEMO_VIDEOS];
  const hits = DEMO_VIDEOS.filter(
    (v) =>
      v.title.toLowerCase().includes(q) ||
      v.channel.toLowerCase().includes(q) ||
      v.description.toLowerCase().includes(q)
  );
  return hits.length ? hits : [...DEMO_VIDEOS];
}

function decodeEntities(str) {
  const el = document.createElement("textarea");
  el.innerHTML = str;
  return el.value;
}

function escapeHtml(str) {
  const el = document.createElement("div");
  el.textContent = str;
  return el.innerHTML;
}

// ---------- Rendering: results grid ----------

function renderGrid(videos, query) {
  els.videoGrid.innerHTML = "";

  if (!state.apiKey) {
    els.notice.innerHTML =
      `<strong>Demo mode.</strong> Showing bundled sample videos` +
      (query && query !== "All" ? ` matching “${escapeHtml(query)}”` : "") +
      `. Add a free YouTube Data API key in Settings (gear icon, top right) to search all of YouTube.`;
    show(els.notice);
  }

  if (!videos.length) {
    els.notice.innerHTML = `No results for “${escapeHtml(query)}”. Try a different search.`;
    show(els.notice);
    return;
  }

  for (const v of videos) {
    const card = document.createElement("div");
    card.className = "video-card";
    card.innerHTML = `
      <div class="thumb-wrap">
        <img src="${v.thumb || thumbUrl(v.id)}" alt="" loading="lazy" />
      </div>
      <div class="card-body">
        <div class="card-avatar" style="background:${avatarColor(v.channel)}">${escapeHtml(v.channel.charAt(0).toUpperCase())}</div>
        <div class="card-text">
          <div class="card-title">${escapeHtml(v.title)}</div>
          <div class="card-channel">${escapeHtml(v.channel)}</div>
          <div class="card-meta">${timeAgo(v.publishedAt)}</div>
        </div>
      </div>`;
    card.addEventListener("click", () => openVideo(v));
    els.videoGrid.appendChild(card);
  }
}

function renderChips(activeLabel) {
  els.chipsRow.innerHTML = "";
  for (const label of SUGGESTED_CHIPS) {
    const chip = document.createElement("button");
    chip.className = "chip" + (label === activeLabel ? " active" : "");
    chip.textContent = label;
    chip.addEventListener("click", () => {
      renderChips(label);
      search(label === "All" ? "" : label);
    });
    els.chipsRow.appendChild(chip);
  }
}

// ---------- Views ----------

function showResultsView() {
  show(els.resultsView);
  hide(els.watchView);
  quiz.token++; // cancel any in-flight quiz fetches
  hide(els.quizModal);
  if (state.player && state.playerReady) {
    try { state.player.stopVideo(); } catch {}
  }
  window.scrollTo(0, 0);
}

function showWatchView() {
  hide(els.resultsView);
  show(els.watchView);
  window.scrollTo(0, 0);
}

// ---------- Player (YouTube IFrame API) ----------

function loadPlayerApi() {
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(tag);
}

// Called by the IFrame API script once it has loaded.
window.onYouTubeIframeAPIReady = function () {
  state.player = new YT.Player("player", {
    width: "100%",
    height: "100%",
    playerVars: { autoplay: 1, rel: 0, modestbranding: 1 },
    events: {
      onReady: () => {
        state.playerReady = true;
        if (state.pendingVideoId) {
          state.player.loadVideoById(state.pendingVideoId);
          state.pendingVideoId = null;
        }
      },
      onError: () => {
        toast("This video can't be embedded — try another one.");
      },
    },
  });
};

function playVideo(id) {
  if (state.player && state.playerReady) {
    state.player.loadVideoById(id);
  } else {
    state.pendingVideoId = id;
  }
}

// ---------- Watch page ----------

function openVideo(video) {
  state.currentVideo = video;
  showWatchView();
  startPreWatchQuiz(video); // playback starts after the quiz (or skip)

  els.watchTitle.textContent = video.title;
  els.watchChannel.textContent = video.channel;
  els.watchChannelAvatar.textContent = video.channel.charAt(0).toUpperCase();
  els.watchChannelAvatar.style.background = avatarColor(video.channel);
  els.watchMeta.textContent = `Published ${timeAgo(video.publishedAt)}`;
  els.watchDescription.textContent = video.description || "No description.";
  els.watchDescription.classList.remove("expanded");

  renderEngagement();
  renderComments();
  renderUpNext();
}

// ---------- Before-you-watch quiz ----------

const KIND_LABELS = {
  misconception: "Common misconception",
  challenge: "Challenge",
  prediction: "Make a prediction",
};

const quiz = { video: null, question: null, answered: false, token: 0 };

function startPreWatchQuiz(video) {
  quiz.video = video;
  quiz.question = null;
  quiz.answered = false;
  const token = ++quiz.token; // invalidates stale fetches if user moves on

  // Reset modal to loading state
  els.quizKind.textContent = "Before you watch";
  show(els.quizLoading);
  hide(els.quizBody);
  hide(els.quizFeedback);
  hide(els.quizPlayBtn);
  show(els.quizSkipBtn);
  els.quizSkipBtn.textContent = "Skip & play";
  els.quizLoadingText.textContent = "Reading the transcript…";
  show(els.quizModal);

  const canned = DEMO_QUESTIONS[video.id];
  if (canned) {
    // Small delay so the flow reads naturally in demo mode
    setTimeout(() => {
      if (token === quiz.token) showQuizQuestion(canned);
    }, 600);
    return;
  }

  buildQuestionFromTranscript(video, token)
    .then((question) => {
      if (token !== quiz.token) return;
      if (question) showQuizQuestion(question);
      else dismissQuiz("No transcript available for this video — enjoy!");
    })
    .catch(() => {
      if (token !== quiz.token) return;
      dismissQuiz("Couldn't build a question for this one — enjoy!");
    });
}

async function buildQuestionFromTranscript(video, token) {
  const tRes = await fetch(`/api/transcript?v=${encodeURIComponent(video.id)}`);
  if (tRes.status === 404) {
    // Static file server (e.g. `npx serve`) — the API only exists in server.py
    dismissQuiz("Quiz needs the app served by: python3 server.py");
    return undefined; // already handled
  }
  const transcript = await tRes.json().catch(() => ({}));
  if (!tRes.ok) {
    console.warn("transcript fetch failed:", transcript.error);
    return null;
  }
  if (!transcript.text || transcript.text.length < 200) return null;

  if (token !== quiz.token) return null;
  els.quizLoadingText.textContent = "Finding an interesting question…";

  const qRes = await fetch("/api/question", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: video.title, transcript: transcript.text }),
  });
  if (!qRes.ok) return null;
  const question = await qRes.json();
  return question.options?.length === 4 ? question : null;
}

function showQuizQuestion(question) {
  quiz.question = question;
  els.quizKind.textContent = KIND_LABELS[question.kind] || "Before you watch";
  els.quizQuestion.textContent = question.question;

  els.quizOptions.innerHTML = "";
  question.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "quiz-option";
    btn.textContent = opt;
    btn.addEventListener("click", () => answerQuiz(i));
    els.quizOptions.appendChild(btn);
  });

  hide(els.quizLoading);
  show(els.quizBody);
}

function answerQuiz(index) {
  if (quiz.answered) return;
  quiz.answered = true;
  const q = quiz.question;
  const correct = index === q.correct_index;

  const buttons = els.quizOptions.querySelectorAll(".quiz-option");
  buttons.forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.correct_index) btn.classList.add("correct");
    else if (i === index) btn.classList.add("wrong");
  });

  els.quizFeedback.innerHTML =
    `<span class="verdict ${correct ? "good" : "bad"}">` +
    (correct ? "Nice — you got it! 🎉" : "Not quite — now you have to watch 😄") +
    `</span>${escapeHtml(q.explanation || "")}`;
  show(els.quizFeedback);

  hide(els.quizSkipBtn);
  show(els.quizPlayBtn);

  // Persist the result as engagement data
  const v = state.currentVideo;
  const eng = videoEngagement(v.id);
  updateEngagement(v.id, {
    quizzes: [
      ...(eng.quizzes || []),
      { correct, kind: q.kind, at: new Date().toISOString() },
    ],
  });
}

function dismissQuiz(message) {
  quiz.token++;
  hide(els.quizModal);
  if (message) toast(message);
  if (state.currentVideo) playVideo(state.currentVideo.id);
}

function renderEngagement() {
  const v = state.currentVideo;
  const eng = videoEngagement(v.id);
  els.likeCount.textContent = String(eng.likes);
  els.likeBtn.classList.toggle("on", eng.liked);
  els.dislikeBtn.classList.toggle("on", eng.disliked);

  const subbed = !!loadSubs()[v.channel];
  els.subscribeBtn.textContent = subbed ? "Subscribed" : "Subscribe";
  els.subscribeBtn.classList.toggle("subscribed", subbed);
}

function renderComments() {
  const v = state.currentVideo;
  const eng = videoEngagement(v.id);
  els.commentsTitle.textContent = `${eng.comments.length} Comment${eng.comments.length === 1 ? "" : "s"}`;
  els.commentList.innerHTML = "";
  for (const c of [...eng.comments].reverse()) {
    const div = document.createElement("div");
    div.className = "comment";
    div.innerHTML = `
      <div class="channel-avatar small">K</div>
      <div class="comment-body">
        <div class="comment-author">You <span>${timeAgo(c.at)}</span></div>
        <div class="comment-text">${escapeHtml(c.text)}</div>
      </div>`;
    els.commentList.appendChild(div);
  }
}

function renderUpNext() {
  const current = state.currentVideo;
  const list = state.results.filter((v) => v.id !== current.id);
  const pool = list.length ? list : DEMO_VIDEOS.filter((v) => v.id !== current.id);
  els.upNextList.innerHTML = "";
  for (const v of pool.slice(0, 10)) {
    const item = document.createElement("div");
    item.className = "upnext-item";
    item.innerHTML = `
      <img class="upnext-thumb" src="${v.thumb || thumbUrl(v.id)}" alt="" loading="lazy" />
      <div class="upnext-text">
        <div class="upnext-title">${escapeHtml(v.title)}</div>
        <div class="upnext-channel">${escapeHtml(v.channel)}</div>
        <div class="upnext-channel">${timeAgo(v.publishedAt)}</div>
      </div>`;
    item.addEventListener("click", () => openVideo(v));
    els.upNextList.appendChild(item);
  }
}

// ---------- Event wiring ----------

function wireEvents() {
  els.searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = els.searchInput.value.trim();
    renderChips(null);
    search(q);
  });

  $("logoLink").addEventListener("click", (e) => {
    e.preventDefault();
    els.searchInput.value = "";
    renderChips("All");
    search("");
  });

  $("menuBtn").addEventListener("click", () => {
    $("sidebar").classList.toggle("collapsed");
    $("main").classList.toggle("full");
  });

  document.querySelectorAll(".side-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".side-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const nav = btn.dataset.nav;
      els.searchInput.value = "";
      renderChips("All");
      if (nav === "home") search("");
      else if (nav === "trending") search(state.apiKey ? "trending" : "");
      else search(""); // demo picks
    });
  });

  // Engagement: like / dislike / share / subscribe
  els.likeBtn.addEventListener("click", () => {
    const v = state.currentVideo;
    const eng = videoEngagement(v.id);
    const liked = !eng.liked;
    updateEngagement(v.id, {
      liked,
      disliked: false,
      likes: Math.max(0, eng.likes + (liked ? 1 : -1)),
    });
    renderEngagement();
  });

  els.dislikeBtn.addEventListener("click", () => {
    const v = state.currentVideo;
    const eng = videoEngagement(v.id);
    updateEngagement(v.id, {
      disliked: !eng.disliked,
      liked: false,
      likes: eng.liked ? Math.max(0, eng.likes - 1) : eng.likes,
    });
    renderEngagement();
  });

  els.shareBtn.addEventListener("click", async () => {
    const url = `https://www.youtube.com/watch?v=${state.currentVideo.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied to clipboard");
    } catch {
      toast(url);
    }
  });

  els.subscribeBtn.addEventListener("click", () => {
    const subbed = toggleSub(state.currentVideo.channel);
    toast(subbed ? `Subscribed to ${state.currentVideo.channel}` : "Subscription removed");
    renderEngagement();
  });

  els.watchDescription.addEventListener("click", () => {
    els.watchDescription.classList.toggle("expanded");
  });

  // Comments
  els.commentForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = els.commentInput.value.trim();
    if (!text) return;
    const v = state.currentVideo;
    const eng = videoEngagement(v.id);
    updateEngagement(v.id, {
      comments: [...eng.comments, { text, at: new Date().toISOString() }],
    });
    els.commentInput.value = "";
    renderComments();
  });

  // Before-you-watch quiz
  els.quizSkipBtn.addEventListener("click", () => dismissQuiz(null));
  els.quizPlayBtn.addEventListener("click", () => dismissQuiz(null));

  // Settings modal
  $("settingsBtn").addEventListener("click", () => {
    els.apiKeyInput.value = state.apiKey;
    show(els.settingsModal);
    els.apiKeyInput.focus();
  });
  $("closeModalBtn").addEventListener("click", () => hide(els.settingsModal));
  els.settingsModal.addEventListener("click", (e) => {
    if (e.target === els.settingsModal) hide(els.settingsModal);
  });
  $("saveKeyBtn").addEventListener("click", () => {
    state.apiKey = els.apiKeyInput.value.trim();
    localStorage.setItem(LS_KEYS.apiKey, state.apiKey);
    hide(els.settingsModal);
    toast(state.apiKey ? "API key saved — searching YouTube for real now" : "No key set — demo mode");
    search(els.searchInput.value.trim());
  });
  $("clearKeyBtn").addEventListener("click", () => {
    state.apiKey = "";
    localStorage.removeItem(LS_KEYS.apiKey);
    els.apiKeyInput.value = "";
    toast("API key cleared — back to demo mode");
  });
}

// ---------- Boot ----------

function init() {
  loadPlayerApi();
  wireEvents();
  renderChips("All");
  search("");
}

init();
