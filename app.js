const app = document.querySelector("#app");

const STORAGE = {
  logs: "sit_practice_logs",
  adminHash: "sit_admin_hash",
  adminSalt: "sit_admin_salt",
  adminSession: "sit_admin_session",
  dayBrightness: "sit_day_brightness",
  events: "sit_interaction_events"
};

const DB_NAME = "screen-to-inner-time-db";
const DB_VERSION = 1;
const MEDIA_STORE = "media";
const SESSION_MINUTES = [15, 30];
const MEDIA_API = "/api/media";
const APP_BASE = detectAppBase();
const IS_STATIC_PREVIEW = isStaticPreviewHost();
const MEDIA_LOAD_TIMEOUT_MS = IS_STATIC_PREVIEW ? 900 : 2500;
const BUNDLED_MEDIA_ITEMS = bundledMediaItems();

let activeSession = null;
let activeTimer = null;
let installPrompt = null;

window.addEventListener("popstate", safeRenderRoute);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  if (routeName() === "home") safeRenderRoute();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && activeSession) {
    updateSessionClock();
  }
  if (document.visibilityState === "hidden" && activeSession) {
    persistActiveSession("in_progress");
  }
});

window.addEventListener("beforeunload", () => {
  if (activeSession) persistActiveSession("left");
});

applyDayBrightness();
registerServiceWorker();
safeRenderRoute();
migrateLocalMediaToServer().catch(() => undefined);

function routeName() {
  const path = normalizedPath();
  if (path.startsWith("/admin/dashboard")) return "admin-dashboard";
  if (path.startsWith("/admin/login")) return "admin-login";
  if (path.startsWith("/admin/media")) return "admin-media";
  if (path.startsWith("/admin/admins")) return "admin-users";
  if (path === "/admin") return "admin-dashboard";
  if (path.startsWith("/session/")) return "session";
  return "home";
}

function normalizedPath() {
  let path = window.location.pathname || "/";
  if (APP_BASE && (path === APP_BASE || path.startsWith(`${APP_BASE}/`))) {
    path = path.slice(APP_BASE.length) || "/";
  }
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path || "/";
}

function detectAppBase() {
  const [firstSegment] = (window.location.pathname || "").split("/").filter(Boolean);
  return firstSegment?.toLowerCase() === "innertime" ? `/${firstSegment}` : "";
}

function isStaticPreviewHost() {
  return window.location.hostname.endsWith(".github.io") || new URLSearchParams(window.location.search).has("static-preview");
}

function bundledMediaItems() {
  const addedAt = "2026-06-26T00:00:00.000Z";
  return [
    bundledMedia("bundled-track-1-15", "Track 1 - 15 Min. Vishvas Meditation", 15, "track-1-15-min-vishvas-meditation.mp3", 14662167, addedAt),
    bundledMedia("bundled-track-2-15", "Track 2 - 15 Min. Vishvas Meditation", 15, "track-2-15-min-vishvas-meditation.mp3", 15367381, addedAt),
    bundledMedia("bundled-track-3-15", "Track 3 - 15 Min. Vishvas Meditation", 15, "track-3-15-min-vishvas-meditation.mp3", 14533971, addedAt),
    bundledMedia("bundled-track-4-15", "Track 4 - 15 Min. Vishvas Meditation", 15, "track-4-15-min-vishvas-meditation.mp3", 14533971, addedAt),
    bundledMedia("bundled-track-5-15", "Track 5 - 15 Min. Vishvas Meditation", 15, "track-5-15-min-vishvas-meditation.mp3", 15126101, addedAt),
    bundledMedia("bundled-track-1-30", "Track 1 - 30 Min. Vishvas Meditation", 30, "track-1-30-min-vishvas-meditation.mp3", 29090882, addedAt),
    bundledMedia("bundled-track-2-30", "Track 2 - 30 Min. Vishvas Meditation", 30, "track-2-30-min-vishvas-meditation.mp3", 43179449, addedAt),
    bundledMedia("bundled-track-3-30", "Track 3 - 30 Min. Vishvas Meditation", 30, "track-3-30-min-vishvas-meditation.mp3", 41043469, addedAt),
    bundledMedia("bundled-track-4-30", "Track 4 - 30 Min. Vishvas Meditation", 30, "track-4-30-min-vishvas-meditation.mp3", 43443391, addedAt)
  ];
}

function bundledMedia(id, title, duration, fileName, size, updatedAt) {
  return {
    id,
    title,
    duration,
    type: "audio",
    source: "Vishvas Meditation audio gallery",
    permission: "private-test",
    status: "published",
    url: appUrl(`/assets/audio/${fileName}`),
    fileName,
    size,
    updatedAt,
    bundled: true
  };
}

function appUrl(path = "/") {
  if (!path.startsWith("/")) return path;
  if (!APP_BASE) return path;
  return path === "/" ? `${APP_BASE}/` : `${APP_BASE}${path}`;
}

function navigate(path) {
  window.history.pushState({}, "", appUrl(path));
  safeRenderRoute();
}

function replace(path) {
  window.history.replaceState({}, "", appUrl(path));
  safeRenderRoute();
}

function safeRenderRoute() {
  renderRoute().catch(renderRouteError);
}

function renderRouteError(error) {
  console.error(error);
  app.className = "app";
  app.innerHTML = `
    <div class="page">
      ${topbarMarkup("home")}
      <section class="practice-surface" aria-labelledby="recover-title">
        <p class="eyebrow">InnerTime</p>
        <h2 id="recover-title" class="title">The page needed a clean restart.</h2>
        <p class="lead">Your local practice notes are still on this device. Return to the start screen and begin again.</p>
        <div class="button-row" style="margin-top: 24px;">
          <button class="tool-button dark" data-route="/">Back to practice</button>
          <button class="quiet-button" data-route="/session/15/">Start 15 minutes</button>
        </div>
      </section>
    </div>
  `;
  bindCommonActions();
}

async function renderRoute() {
  if (activeSession) persistActiveSession("left");
  clearActiveTimer();
  activeSession = null;
  app.className = "app";

  const route = routeName();
  if (route === "admin-login") {
    await renderAdminLogin();
    return;
  }

  if (route === "admin-dashboard") {
    await renderAdminDashboard();
    return;
  }

  if (route === "admin-media") {
    await renderAdminMedia();
    return;
  }

  if (route === "admin-users") {
    await renderAdminUsers();
    return;
  }

  if (route === "session") {
    const minutes = durationFromPath();
    await renderSessionStart(minutes);
    return;
  }

  await renderHome();
}

function durationFromPath() {
  const match = normalizedPath().match(/\/session\/(\d+)/);
  const minutes = match ? Number(match[1]) : 15;
  return SESSION_MINUTES.includes(minutes) ? minutes : 15;
}

function brandMarkup() {
  return `
    <div class="brand">
      <img class="brand-logo" src="${appUrl("/assets/vishvas-meditation-logo.png")}" alt="Vishvas Meditation">
      <div>
        <h1 class="brand-title">InnerTime</h1>
        <p class="brand-subtitle">Screen to Inner Time</p>
      </div>
    </div>
  `;
}

function topbarMarkup(active = "home") {
  const adminPrimaryRoute = isAdmin() ? "/admin/dashboard/" : "/admin/login/";
  const adminNav = active === "admin"
    ? isAdmin()
      ? `
      <button class="quiet-button" data-route="/admin/dashboard/">Dashboard</button>
      <button class="quiet-button" data-route="/admin/media/">Media</button>
      ${isOwner() ? `<button class="quiet-button" data-route="/admin/admins/">Admins</button>` : ""}
      <button class="quiet-button" data-route="/">Explore</button>
      <button class="quiet-button" data-action="logout">Log out</button>
    `
      : `
      <button class="quiet-button" data-route="/">Explore</button>
      <button class="quiet-button" data-route="/session/15/">Start Sitting</button>
    `
    : `
      <button class="quiet-button" data-route="/">Explore</button>
      <button class="quiet-button" data-route="/session/15/">Start Sitting</button>
      <button class="quiet-button" data-route="${adminPrimaryRoute}">Admin</button>
    `;
  return `
    <header class="topbar-shell">
      <div class="topbar">
        ${brandMarkup()}
        <nav class="nav-actions" aria-label="Primary">
          ${adminNav}
        </nav>
      </div>
    </header>
  `;
}

async function renderHome() {
  const stats = practiceStats();
  const media = await getAllMediaSafe();
  const hasFifteen = hasPracticeOption(media, 15);
  const hasThirty = hasPracticeOption(media, 30);
  const brightness = getDayBrightness();

  app.innerHTML = `
    <div class="page">
      ${topbarMarkup("home")}
      <section class="intro-band" aria-label="Practice intention">
        <button type="button" data-scroll="#practice-start">Sittings</button>
        <button type="button" data-scroll="#why-this-exists">Why this helps</button>
      </section>
      <section id="practice-start" class="hero-tool" aria-labelledby="home-title">
        <div class="practice-surface">
          <p class="eyebrow">Vishvas Meditation</p>
          <h2 id="home-title" class="title">Convert screen time into inner time.</h2>
          <p class="lead">A simple audio-first space for the moment you feel pulled toward browsing, YouTube, or endless scrolling. Choose a sitting, close your eyes, and return inward.</p>
          <div class="duration-grid" aria-label="Choose sitting length">
            <button class="duration-button" data-start-duration="15">
              <span>
                <span class="duration-number">15</span>
                <span class="duration-label">minute sitting</span>
              </span>
              <p class="duration-copy">${hasFifteen ? "Choose from available 15-minute recordings." : "Upload a 15-minute audio first."}</p>
            </button>
            <button class="duration-button secondary" data-start-duration="30">
              <span>
                <span class="duration-number">30</span>
                <span class="duration-label">deep sitting</span>
              </span>
              <p class="duration-copy">${hasThirty ? "Choose from available 30-minute recordings." : "Upload a 30-minute audio first."}</p>
            </button>
          </div>
        </div>

        <aside class="side-stack" aria-label="Practice overview">
          <section class="panel">
            <p class="panel-kicker">Today’s story</p>
            <h2>${stats.todayMinutes ? `${stats.todayMinutes} minutes inward` : "Begin your first sitting"}</h2>
            <p>${stats.todayMinutes ? "You already shifted attention from the outer screen toward inner observation today." : "The first win is not browsing more. It is choosing one sitting before the screen loop takes over."}</p>
            <div class="stat-grid">
              <div class="stat">
                <strong>${stats.todaySessions}</strong>
                <span>sittings</span>
              </div>
              <div class="stat">
                <strong>${stats.todayMinutes}</strong>
                <span>minutes</span>
              </div>
              <div class="stat">
                <strong>${stats.replacements}</strong>
                <span>screen shifts</span>
              </div>
            </div>
          </section>

          <section class="panel">
            <p class="panel-kicker">Practice rhythm</p>
            <h2>Last 7 days</h2>
            <p>Practice time from sittings you started.</p>
            <div class="week-bars" aria-label="Practice minutes over the last 7 days">
              ${weekBarsMarkup(stats.week)}
            </div>
          </section>

          <section class="panel">
            <p class="panel-kicker">Day Mode</p>
            <h2>Brightness control</h2>
            <p>This dims the bright interface. Close-Eyes Mode is always black.</p>
            <label class="field">
              <span>Brightness</span>
              <input type="range" min="40" max="100" step="5" value="${brightness}" data-action="brightness">
            </label>
          </section>

          <section class="install-action" aria-label="Install InnerTime">
            <button class="tool-button" data-action="install">Install app</button>
          </section>
        </aside>
      </section>

      <section id="why-this-exists" class="site-section" aria-labelledby="difference-title">
        <div class="section-heading">
          <p class="eyebrow">Why this exists</p>
          <h2 id="difference-title">Not another feed. A doorway.</h2>
        </div>
        <div class="story-grid">
          <button class="story-card explore-card is-active" type="button" data-explore="master-audio">
            <span class="story-number">01</span>
            <h3>Master-guided audio</h3>
            <p>Audio stays central so practice can happen with eyes closed instead of another visual feed.</p>
            <span class="read-more">Read this idea</span>
          </button>
          <button class="story-card explore-card" type="button" data-explore="close-eyes">
            <span class="story-number">02</span>
            <h3>Close-Eyes practice</h3>
            <p>The session starts black by default, with only the essentials available if needed.</p>
            <span class="read-more">Read this idea</span>
          </button>
          <button class="story-card explore-card" type="button" data-explore="inner-time">
            <span class="story-number">03</span>
            <h3>Screen to Inner Time</h3>
            <p>The app measures whether screen urges are becoming completed practice time.</p>
            <span class="read-more">Read this idea</span>
          </button>
        </div>
        <article class="explore-article" data-explore-panel>
          ${exploreArticleMarkup("master-audio")}
        </article>
      </section>
    </div>
  `;

  bindCommonActions();
  bindExploreCards();
  document.querySelectorAll("[data-start-duration]").forEach((button) => {
    button.addEventListener("click", () => {
      navigate(`/session/${button.dataset.startDuration}/`);
    });
  });
  const brightnessInput = document.querySelector("[data-action='brightness']");
  brightnessInput?.addEventListener("input", (event) => {
    setDayBrightness(Number(event.currentTarget.value));
  });
  document.querySelector("[data-action='install']")?.addEventListener("click", async () => {
    if (!installPrompt) {
      showToast("Use your browser menu to install InnerTime.");
      return;
    }
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    renderHome();
  });
}

function exploreArticleMarkup(topic) {
  const articles = {
    "master-audio": {
      kicker: "Master-guided audio",
      title: "The voice is the doorway, not the screen.",
      body: "InnerTime is designed so the user does not need to keep watching. It is an on-demand sitting for the exact moment the urge appears.",
      action: "Start with a 15-minute sitting when the pull toward scrolling begins."
    },
    "close-eyes": {
      kicker: "Close-Eyes practice",
      title: "The default experience removes visual noise.",
      body: "A normal app asks for more attention. This one does the opposite. When a sitting begins, the screen turns black, the timer stays quiet, and the user can simply listen, close the eyes, and observe what is happening inside.",
      action: "Day Mode stays available only for controls, brightness, and audio recovery."
    },
    "inner-time": {
      kicker: "Screen to Inner Time",
      title: "Progress means returning to yourself.",
      body: "The goal is not streak pressure or entertainment. The meaningful signal is whether a user replaced a screen loop with practice, completed a sitting, and noticed how they felt afterward. The dashboard tells that story through sittings, reflections, frequency, and screen shifts.",
      action: "For the first version, progress stays private on the device."
    }
  };
  const article = articles[topic] || articles["master-audio"];
  return `
    <p class="panel-kicker">${escapeHtml(article.kicker)}</p>
    <h3>${escapeHtml(article.title)}</h3>
    <p>${escapeHtml(article.body)}</p>
    <strong>${escapeHtml(article.action)}</strong>
  `;
}

function bindExploreCards() {
  const panel = document.querySelector("[data-explore-panel]");
  const cards = Array.from(document.querySelectorAll("[data-explore]"));
  if (!panel || !cards.length) return;
  cards.forEach((card) => {
    card.addEventListener("click", () => {
      cards.forEach((item) => item.classList.remove("is-active"));
      card.classList.add("is-active");
      panel.innerHTML = exploreArticleMarkup(card.dataset.explore);
    });
  });
}

function visibleMediaForUser(media) {
  return media.filter((item) => (item.status === "published" || isAdmin()) && mediaUrlForItem(item));
}

function hasPracticeOption(media, duration) {
  return visibleMediaForUser(media).some((item) => Number(item.duration) === Number(duration));
}

async function renderSessionStart(minutes) {
  const media = await getSelectableMedia(minutes);
  const selectedTrackId = selectedTrackFromUrl(media);
  const selected = media.find((item) => item.id === selectedTrackId) || media[0] || null;
  const canStart = Boolean(selected) || IS_STATIC_PREVIEW;
  const shouldAutostart = new URLSearchParams(window.location.search).get("autostart") === "1";

  if (shouldAutostart && selected) {
    await startSitting(minutes, "Quick start from recording library.", selected.id);
    return;
  }

  app.innerHTML = `
    <div class="page">
      ${topbarMarkup("home")}
      <section class="practice-surface" aria-labelledby="precheck-title">
        <p class="eyebrow">${minutes} minute sitting</p>
        <h2 id="precheck-title" class="title">Before you begin, notice the pull.</h2>
        <p class="lead">This is not for guilt. It is just a clear look at the moment when the screen loop usually begins.</p>
        <form class="form-grid" data-form="begin-session" style="margin-top: 24px;">
          <label class="field">
            <span>Choose recording</span>
            <select name="mediaId" data-action="track-select" ${media.length ? "" : "disabled"}>
              ${media.length ? media.map((item) => `
                <option value="${escapeHtml(item.id)}" ${item.id === selected?.id ? "selected" : ""}>
                  ${escapeHtml(item.title)} ${item.status === "published" ? "" : "(admin draft)"}
                </option>
              `).join("") : `<option value="">No ${minutes}-minute recording available yet</option>`}
            </select>
          </label>
          ${selected ? "" : `
            <div class="empty-state">
              <strong>${IS_STATIC_PREVIEW ? "No live recording connected yet." : "No recording selected."}</strong>
              <span>${IS_STATIC_PREVIEW ? "This published preview can still start a silent timer. Uploaded master audio needs the Netlify/Supabase backend." : `Upload and publish a ${minutes}-minute master audio in Admin > Media first.`}</span>
            </div>
          `}
          <label class="field">
            <span>What pulled me toward the screen?</span>
            <textarea name="urge" placeholder="Example: tiredness, stress, loneliness, boredom, habit, wanting escape"></textarea>
          </label>
          <fieldset class="field">
            <legend>Quick check</legend>
            <div class="choice-grid">
              ${quickCheckOptions().map((item) => `
                <label class="choice emoji-choice">
                  <input type="checkbox" name="pulls" value="${escapeHtml(item.label)}">
                  <span class="choice-emoji" aria-hidden="true">${item.emoji}</span>
                  <span class="choice-label">${escapeHtml(item.label)}</span>
                </label>
              `).join("")}
            </div>
          </fieldset>
          <div class="start-assurance" aria-live="polite">
            <div class="assurance-icons" aria-hidden="true">
              <span>🎧</span>
              <span>😌</span>
              <span>🧘</span>
            </div>
            <div>
              <strong>Ready for Close-Eyes Mode</strong>
              <p><span data-selected-track-name>${selected ? escapeHtml(sessionAudioLabel(selected)) : `${minutes}-minute silent timer`}</span> ${selected ? "will play" : "will begin"} when you start.</p>
            </div>
          </div>
          <div class="button-row">
            <button class="tool-button dark" type="submit" ${canStart ? "" : "disabled"}>Start Close-Eyes Sitting</button>
            <button class="quiet-button" type="button" data-route="/">Not now</button>
          </div>
        </form>
      </section>
    </div>
  `;

  bindCommonActions();
  bindTrackSelector(media);
  document.querySelector("[data-form='begin-session']").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedPulls = form.getAll("pulls");
    const typedUrge = String(form.get("urge") || "").trim();
    const urge = [typedUrge, ...selectedPulls].filter(Boolean).join("; ");
    await startSitting(minutes, urge, String(form.get("mediaId") || ""));
  });
}

function bindTrackSelector(media) {
  const select = document.querySelector("[data-action='track-select']");
  const selectedName = document.querySelector("[data-selected-track-name]");
  if (!select || !selectedName) return;
  const updateSelectedName = () => {
    const selected = media.find((item) => item.id === select.value);
    if (!selected) return;
    selectedName.textContent = sessionAudioLabel(selected);
  };
  updateSelectedName();
  select.addEventListener("change", updateSelectedName);
}

function quickCheckOptions() {
  return [
    { emoji: "😴", label: "Tired" },
    { emoji: "⚡", label: "Restless" },
    { emoji: "🕒", label: "Avoiding work" },
    { emoji: "💭", label: "Overthinking" },
    { emoji: "🤲", label: "Seeking comfort" },
    { emoji: "🔁", label: "Habit" }
  ];
}

async function startSitting(minutes, urge, mediaId = "") {
  let media = await findMediaForSession(minutes, mediaId);
  let audioUrl = mediaUrlForItem(media);
  if (!media || !audioUrl) {
    if (!IS_STATIC_PREVIEW) {
      showToast(`Upload and publish a ${minutes}-minute master audio first.`);
      return;
    }
    media = fallbackSessionMedia(minutes);
    audioUrl = "";
  }
  const audio = audioUrl ? new Audio(audioUrl) : null;
  if (audio) {
    audio.preload = "auto";
  }

  activeSession = {
    id: uniqueId(),
    minutes,
    plannedMs: minutes * 60 * 1000,
    remainingMs: minutes * 60 * 1000,
    elapsedMs: 0,
    startedAt: new Date().toISOString(),
    urge,
    media,
    audio,
    audioUrl,
    mode: "close",
    isPaused: false,
    lastTick: Date.now(),
    lastPersistedAt: 0
  };
  persistActiveSession("in_progress");
  recordInteraction("session_start", {
    duration: minutes,
    mediaId: media?.id || null,
    mediaTitle: media?.title || "Silent timer"
  });

  if (activeTimer) window.clearInterval(activeTimer);
  renderActiveSession();
  activeTimer = window.setInterval(tickSession, 500);

  if (audio) {
    const playAttempt = audio.play();
    if (playAttempt?.catch) playAttempt.catch(() => {
      showToast("Audio could not start automatically. Use Day Mode and press play if needed.");
    });
  } else {
    playBell();
  }
}

function renderActiveSession() {
  if (!activeSession) return;
  app.className = activeSession.mode === "close" ? "app close-app" : "app";

  if (activeSession.mode === "close") {
    app.innerHTML = `
      <section class="close-mode" aria-labelledby="close-title">
        <div class="close-center">
          <div class="breath-ring" aria-hidden="true"></div>
          <div>
            <p class="eyebrow" style="color: #f0c766;">Close-Eyes Mode</p>
            <h2 id="close-title" class="timer" data-session-timer>${formatMs(activeSession.remainingMs)}</h2>
            <p class="close-copy">${sessionAudioLabel(activeSession.media)}. Keep the screen away from the center. Just listen, close your eyes, and observe.</p>
          </div>
          <div class="close-controls">
            <button class="quiet-button" data-action="toggle-pause">${activeSession.isPaused ? "Resume" : "Pause"}</button>
            <button class="quiet-button" data-action="day-mode">Day Mode</button>
            <button class="quiet-button" data-action="gentle-end">End</button>
          </div>
        </div>
      </section>
    `;
  } else {
    const progress = sessionProgress(activeSession);
    app.innerHTML = `
      <div class="session-day">
        ${topbarMarkup("home")}
        <section class="session-grid" aria-labelledby="session-title">
          <div class="session-clock">
            <p class="eyebrow">Day Mode</p>
            <h2 id="session-title" class="title" style="font-size: 3rem;">${activeSession.minutes} minute sitting</h2>
            <div class="timer" data-session-timer style="font-size: 4.6rem;">${formatMs(activeSession.remainingMs)}</div>
            <div class="progress-track" aria-hidden="true"><span data-progress style="width: ${progress}%"></span></div>
            <p class="audio-label">${sessionAudioLabel(activeSession.media)}</p>
            <div class="session-audio-slot" data-session-audio-slot></div>
            <p class="hint">${activeSession.audio ? "If your browser blocks automatic playback, use this audio control once, then return to Close-Eyes Mode." : "This preview is running as a quiet timer until uploaded master audio is connected."}</p>
            <div class="button-row">
              <button class="tool-button dark" data-action="close-mode">Close-Eyes Mode</button>
              <button class="quiet-button" data-action="toggle-pause">${activeSession.isPaused ? "Resume" : "Pause"}</button>
              <button class="danger-button" data-action="gentle-end">End</button>
            </div>
          </div>
          <aside class="side-stack">
            <section class="panel">
              <h2>What pulled you here?</h2>
              <p>${activeSession.urge ? escapeHtml(activeSession.urge) : "No words needed. You noticed the pull and started."}</p>
            </section>
            <section class="panel">
              <h2>Day brightness</h2>
              <label class="field">
                <span>Brightness</span>
                <input type="range" min="40" max="100" step="5" value="${getDayBrightness()}" data-action="brightness">
              </label>
            </section>
          </aside>
        </section>
      </div>
    `;
  }

  bindCommonActions();
  bindSessionActions();
  attachSessionAudioControl();
}

function bindSessionActions() {
  document.querySelectorAll("[data-action='toggle-pause']").forEach((button) => {
    button.addEventListener("click", togglePause);
  });
  document.querySelectorAll("[data-action='day-mode']").forEach((button) => {
    button.addEventListener("click", () => {
      activeSession.mode = "day";
      renderActiveSession();
    });
  });
  document.querySelectorAll("[data-action='close-mode']").forEach((button) => {
    button.addEventListener("click", () => {
      activeSession.mode = "close";
      renderActiveSession();
    });
  });
  document.querySelectorAll("[data-action='gentle-end']").forEach((button) => {
    button.addEventListener("click", showGentleEndModal);
  });
  const brightnessInput = document.querySelector("[data-action='brightness']");
  brightnessInput?.addEventListener("input", (event) => {
    setDayBrightness(Number(event.currentTarget.value));
  });
}

function attachSessionAudioControl() {
  const slot = document.querySelector("[data-session-audio-slot]");
  if (!slot || !activeSession?.audio) return;
  activeSession.audio.controls = true;
  activeSession.audio.controlsList = "nodownload";
  activeSession.audio.className = "session-audio-control";
  slot.appendChild(activeSession.audio);
}

function tickSession() {
  if (!activeSession || activeSession.isPaused) return;
  const now = Date.now();
  const delta = now - activeSession.lastTick;
  activeSession.lastTick = now;
  activeSession.remainingMs = Math.max(0, activeSession.remainingMs - delta);
  activeSession.elapsedMs = activeSession.plannedMs - activeSession.remainingMs;
  if (now - (activeSession.lastPersistedAt || 0) > 3000) {
    persistActiveSession("in_progress");
  }
  updateSessionClock();
  if (activeSession.remainingMs <= 0) {
    completeSession(true);
  }
}

function updateSessionClock() {
  if (!activeSession) return;
  document.querySelectorAll("[data-session-timer]").forEach((node) => {
    node.textContent = formatMs(activeSession.remainingMs);
  });
  document.querySelectorAll("[data-progress]").forEach((node) => {
    node.style.width = `${sessionProgress(activeSession)}%`;
  });
}

function togglePause() {
  if (!activeSession) return;
  activeSession.isPaused = !activeSession.isPaused;
  activeSession.lastTick = Date.now();
  if (activeSession.audio) {
    if (activeSession.isPaused) {
      activeSession.audio.pause();
    } else {
      activeSession.audio.play().catch(() => showToast("Press play in Day Mode if audio does not resume."));
    }
  }
  renderActiveSession();
}

function showGentleEndModal() {
  if (!activeSession) return;
  const wasPaused = activeSession.isPaused;
  activeSession.isPaused = true;
  activeSession.audio?.pause();
  showModal(`
    <h2>Pause gently</h2>
    <p>The urge to leave is also something you can observe. Choose without guilt.</p>
    <div class="button-row" style="margin-top: 16px;">
      <button class="tool-button dark" data-modal-action="continue">Continue sitting</button>
      <button class="quiet-button" data-modal-action="stay-paused">Stay paused</button>
      <button class="danger-button" data-modal-action="end">End now</button>
    </div>
  `);
  document.querySelector("[data-modal-action='continue']").addEventListener("click", () => {
    closeModal();
    activeSession.isPaused = wasPaused;
    activeSession.lastTick = Date.now();
    if (!activeSession.isPaused) activeSession.audio?.play().catch(() => undefined);
    renderActiveSession();
  });
  document.querySelector("[data-modal-action='stay-paused']").addEventListener("click", () => {
    closeModal();
    activeSession.isPaused = true;
    renderActiveSession();
  });
  document.querySelector("[data-modal-action='end']").addEventListener("click", () => {
    closeModal();
    completeSession(false);
  });
}

function completeSession(completed) {
  if (!activeSession) return;
  clearActiveTimer();
  activeSession.audio?.pause();
  if (activeSession.audioUrl?.startsWith("blob:")) URL.revokeObjectURL(activeSession.audioUrl);
  if (completed) playBell();
  activeSession.completed = completed;
  activeSession.endedAt = new Date().toISOString();
  activeSession.mode = "day";
  persistActiveSession(completed ? "completed" : "ended");
  renderPostSession();
}

function renderPostSession() {
  if (!activeSession) return;
  const minutesGiven = Math.max(1, Math.round(activeSession.elapsedMs / 60000));
  app.className = "app";
  app.innerHTML = `
    <div class="page">
      ${topbarMarkup("home")}
      <section class="practice-surface" aria-labelledby="after-title">
        <p class="eyebrow">${activeSession.completed ? "Sitting complete" : "Sitting ended"}</p>
        <h2 id="after-title" class="title">You gave ${minutesGiven} minute${minutesGiven === 1 ? "" : "s"} to inner practice.</h2>
        <p class="lead">Seal the sitting with one clear look. This stays on this device.</p>
        <form class="form-grid" data-form="after-session" style="margin-top: 24px;">
          <label class="field">
            <span>How do I feel now?</span>
            <textarea name="after" placeholder="Example: calmer, restless but aware, clearer, sleepy, grateful"></textarea>
          </label>
          <fieldset class="field">
            <legend>Did this replace YouTube, browsing, or scrolling?</legend>
            <div class="choice-grid">
              <label class="choice"><input type="radio" name="replaced" value="yes"> <span>Yes</span></label>
              <label class="choice"><input type="radio" name="replaced" value="no"> <span>No</span></label>
            </div>
          </fieldset>
          <label class="field">
            <span>Estimated screen minutes protected</span>
            <input name="shiftedMinutes" type="number" min="0" max="240" step="1" value="${activeSession.minutes}">
          </label>
          <div class="button-row">
            <button class="tool-button dark" type="submit">Save reflection</button>
            <button class="quiet-button" type="button" data-action="skip-reflection">Skip reflection</button>
          </div>
        </form>
      </section>
    </div>
  `;
  bindCommonActions();
  document.querySelector("[data-form='after-session']").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    savePracticeLog({
      after: String(form.get("after") || "").trim(),
      replaced: String(form.get("replaced") || "not-sure"),
      shiftedMinutes: Number(form.get("shiftedMinutes") || 0)
    });
    renderSavedSummary();
  });
  document.querySelector("[data-action='skip-reflection']").addEventListener("click", () => {
    savePracticeLog({ after: "", replaced: "skipped", shiftedMinutes: 0 });
    renderSavedSummary();
  });
}

function renderSavedSummary() {
  const log = readLogs()[0];
  const displayMinutes = displayMinutesFromMs(log.actualMs || 0) || creditedMinutes(log);
  app.innerHTML = `
    <div class="page">
      ${topbarMarkup("home")}
      <section class="practice-surface" aria-labelledby="saved-title">
        <p class="eyebrow">Practice saved</p>
        <h2 id="saved-title" class="title">You shifted ${displayMinutes} minute${displayMinutes === 1 ? "" : "s"} toward inner time.</h2>
        <p class="lead">Return when the screen loop starts again. One sitting is enough for this moment.</p>
        <div class="button-row" style="margin-top: 24px;">
          <button class="tool-button dark" data-route="/">Back to practice</button>
          <button class="quiet-button" data-route="/session/15/">Start another 15 minutes</button>
        </div>
      </section>
    </div>
  `;
  bindCommonActions();
}

async function renderAdminLogin() {
  if (IS_STATIC_PREVIEW) {
    renderStaticAdminNotice();
    return;
  }

  const bootstrap = await getAdminBootstrap();
  const hasAdmins = Boolean(bootstrap?.hasAdmins);
  app.innerHTML = `
    <div class="page">
      ${topbarMarkup("admin")}
      <section class="practice-surface" aria-labelledby="admin-login-title">
        <p class="eyebrow">Owner access</p>
        <h2 id="admin-login-title" class="title">${hasAdmins ? "Log in to admin." : "Create original owner admin."}</h2>
        <p class="lead">${hasAdmins ? "Admin tools are restricted to assigned admins." : "The first admin becomes the original owner. Only the owner can add admins or reset passwords."}</p>
        <form class="form-grid" data-form="admin-login" style="margin-top: 24px;">
          <label class="field">
            <span>Admin name</span>
            <input name="name" type="text" maxlength="60" autocomplete="username" placeholder="${hasAdmins ? "Owner or assigned admin" : "Your owner admin name"}" required>
          </label>
          <label class="field">
            <span>Passcode</span>
            <input name="passcode" type="password" minlength="6" autocomplete="current-password" required>
          </label>
          ${hasAdmins ? "" : `
            <label class="field">
              <span>Confirm passcode</span>
              <input name="confirm" type="password" minlength="6" autocomplete="new-password" required>
            </label>
          `}
          <div class="notice">
            <strong>Password reset policy</strong>
            ${hasAdmins ? "If an assigned admin forgets a passcode, the original owner resets it from Admins. Owner recovery uses the recovery code shown during owner setup." : "Save the owner recovery code shown after setup. It is the only local recovery path for the original owner."}
          </div>
          <div class="button-row">
            <button class="tool-button dark" type="submit">${hasAdmins ? "Log in" : "Create owner admin"}</button>
            <button class="quiet-button" type="button" data-route="/">Practice</button>
          </div>
        </form>
        ${hasAdmins ? `
          <form class="form-grid" data-form="owner-recovery" style="margin-top: 24px;">
            <p class="panel-kicker">Owner recovery</p>
            <label class="field">
              <span>Owner name</span>
              <input name="name" type="text" maxlength="60" autocomplete="username">
            </label>
            <label class="field">
              <span>Recovery code</span>
              <input name="recoveryCode" type="password" autocomplete="one-time-code">
            </label>
            <label class="field">
              <span>New owner passcode</span>
              <input name="passcode" type="password" minlength="6" autocomplete="new-password">
            </label>
            <div class="button-row">
              <button class="quiet-button" type="submit">Reset owner passcode</button>
            </div>
          </form>
        ` : ""}
      </section>
    </div>
  `;
  bindCommonActions();
  document.querySelector("[data-form='admin-login']").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const passcode = String(form.get("passcode") || "");
    if (!hasAdmins) {
      const confirm = String(form.get("confirm") || "");
      if (passcode !== confirm) {
        showToast("Passcodes do not match.");
        return;
      }
      const created = await createOwnerAdmin(name, passcode);
      if (!created?.admin) return;
      setAdminSession(created.admin);
      showOwnerRecoveryModal(created.recoveryCode);
      return;
    }

    const loggedIn = await loginAdmin(name, passcode);
    if (!loggedIn?.admin) {
      showToast("Admin name or passcode did not match.");
      return;
    }
    setAdminSession(loggedIn.admin);
    navigate("/admin/dashboard/");
  });
  document.querySelector("[data-form='owner-recovery']")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const recovered = await recoverOwnerPasscode(
      String(form.get("name") || "").trim(),
      String(form.get("recoveryCode") || ""),
      String(form.get("passcode") || "")
    );
    if (!recovered?.admin) return;
    setAdminSession(recovered.admin);
    showToast("Owner passcode reset.");
    navigate("/admin/dashboard/");
  });
}

function renderStaticAdminNotice() {
  app.innerHTML = `
    <div class="page">
      ${topbarMarkup("admin")}
      <section class="practice-surface" aria-labelledby="static-admin-title">
        <p class="eyebrow">Admin setup</p>
        <h2 id="static-admin-title" class="title">Admin media needs a backend.</h2>
        <p class="lead">This GitHub Pages link is a static website preview. The public practice flow works here, but admin login, audio upload, downloads, and shared media storage need the Netlify/Supabase backend before they can work live.</p>
        <div class="notice" style="margin-top: 20px;">
          <strong>What works on this link</strong>
          <span>Users can explore, start a sitting, use Close-Eyes Mode, and save local practice progress on the same device.</span>
        </div>
        <div class="notice" style="margin-top: 14px;">
          <strong>What needs the next publish step</strong>
          <span>Admin accounts, uploaded master audio, media publishing, and backups require server storage. GitHub Pages cannot store private uploaded files by itself.</span>
        </div>
        <div class="button-row" style="margin-top: 24px;">
          <button class="tool-button dark" data-route="/">Back to practice</button>
          <button class="quiet-button" data-route="/session/15/">Test 15-minute sitting</button>
        </div>
      </section>
    </div>
  `;
  bindCommonActions();
}

async function renderAdminDashboard() {
  if (IS_STATIC_PREVIEW) {
    renderStaticAdminNotice();
    return;
  }

  if (!isAdmin()) {
    replace("/admin/login/");
    return;
  }

  const filters = dashboardFilters();
  const media = await getAllMediaSafe();
  const analytics = analyticsStats(filters);

  app.innerHTML = `
    <div class="page">
      ${topbarMarkup("admin")}
      <section class="intro-band" aria-label="Dashboard focus">
        <button type="button" data-scroll="#dashboard-metrics">Usage story</button>
        <button type="button" data-scroll="#dashboard-details">User interaction</button>
        <button type="button" data-route="/admin/media/">Recordings</button>
      </section>

      <section class="dashboard-hero" aria-labelledby="dashboard-title">
        <div>
          <p class="eyebrow">Admin dashboard</p>
          <h2 id="dashboard-title" class="title">Practice health at a glance.</h2>
          <p class="lead">${analytics.story}</p>
        </div>
        <form class="dashboard-filters" data-form="dashboard-filters" aria-label="Dashboard filters">
          <label class="field">
            <span>Range</span>
            <select name="range">
              ${dashboardOption("7", "Last 7 days", filters.range)}
              ${dashboardOption("30", "Last 30 days", filters.range)}
              ${dashboardOption("90", "Last 90 days", filters.range)}
              ${dashboardOption("365", "Last 12 months", filters.range)}
              ${dashboardOption("all", "All time", filters.range)}
            </select>
          </label>
          <label class="field">
            <span>Duration</span>
            <select name="duration">
              ${dashboardOption("all", "All sittings", filters.duration)}
              ${dashboardOption("15", "15 minutes", filters.duration)}
              ${dashboardOption("30", "30 minutes", filters.duration)}
            </select>
          </label>
          <label class="field">
            <span>Screen shift</span>
            <select name="replaced">
              ${dashboardOption("all", "All responses", filters.replaced)}
              ${dashboardOption("yes", "Replaced scrolling", filters.replaced)}
              ${dashboardOption("no", "Did not replace", filters.replaced)}
            </select>
          </label>
          <button class="tool-button dark" type="submit">Apply filters</button>
        </form>
      </section>

      <section id="dashboard-metrics" class="metric-grid" aria-label="Core activity metrics">
        ${metricCard("DAU", analytics.dau, "local active user today", analytics.dau ? "Today has practice activity." : "No completed sitting today yet.")}
        ${metricCard("MAU", analytics.mau, "active days this month", `${analytics.mau} day${analytics.mau === 1 ? "" : "s"} with practice in the current month.`)}
        ${metricCard("YAU", analytics.yau, "active months this year", `${analytics.yau} month${analytics.yau === 1 ? "" : "s"} with practice in the current year.`)}
        ${metricCard("Frequency", analytics.frequency, "sessions per active day", "How often practice repeats on days when the app is used.")}
      </section>

      <section id="dashboard-details" class="dashboard-grid" aria-label="Detailed dashboard">
        <div class="admin-panel story-panel">
          <p class="panel-kicker">Conversion funnel</p>
          <h2>From urge to sitting</h2>
          <div class="funnel">
            <div class="funnel-row">
              <span>Session starts</span>
              <strong>${analytics.starts}</strong>
            </div>
            <div class="funnel-row">
              <span>Saved reflections</span>
              <strong>${analytics.logs.length}</strong>
            </div>
            <div class="funnel-row">
              <span>Completed sittings</span>
              <strong>${analytics.completed}</strong>
            </div>
            <div class="funnel-row">
              <span>Completion rate</span>
              <strong>${analytics.completionRate}%</strong>
            </div>
            <div class="funnel-row">
              <span>Screen shifts</span>
              <strong>${analytics.screenShifts}</strong>
            </div>
          </div>
        </div>

        <div class="admin-panel">
          <p class="panel-kicker">Practice minutes</p>
          <h2>${analytics.minutes} minutes inward</h2>
          <p>${analytics.minutes ? "Total completed practice minutes in the selected filter." : "No practice minutes match this filter yet."}</p>
          <div class="timeline-bars" aria-label="Practice timeline">
            ${timelineBarsMarkup(analytics.timeline)}
          </div>
        </div>

        <div class="admin-panel">
          <p class="panel-kicker">Recording health</p>
          <h2>${publishedCount(media)} published / ${media.length} total</h2>
          <p>Published audio appears on the public website. Drafts remain admin-only.</p>
          <div class="media-health">
            ${recordingHealthMarkup(media)}
          </div>
          <div class="button-row" style="margin-top: 14px;">
            <button class="tool-button" data-route="/admin/media/">Manage recordings</button>
          </div>
        </div>

        <div class="admin-panel">
          <p class="panel-kicker">Recent interaction</p>
          <h2>Latest practice notes</h2>
          ${recentLogsMarkup(analytics.logs)}
        </div>
      </section>
    </div>
  `;

  bindCommonActions();
  bindDashboardActions();
}

async function renderAdminUsers() {
  if (IS_STATIC_PREVIEW) {
    renderStaticAdminNotice();
    return;
  }

  if (!isAdmin()) {
    replace("/admin/login/");
    return;
  }
  if (!isOwner()) {
    replace("/admin/dashboard/");
    showToast("Only the original owner can manage admins.");
    return;
  }

  const data = await getAdminUsers();
  const admins = data?.admins || [];
  const maxAdmins = data?.maxAdmins || 10;
  const canAdd = admins.length < maxAdmins;

  app.innerHTML = `
    <div class="page">
      ${topbarMarkup("admin")}
      <section class="intro-band" aria-label="Admin users">
        <button type="button" data-scroll="#admin-create">Add admin</button>
        <button type="button" data-scroll="#admin-list">Admin list</button>
        <button type="button" data-route="/admin/dashboard/">Dashboard</button>
      </section>
      <section class="admin-layout" aria-label="Admin management">
        <div id="admin-create" class="admin-panel">
          <p class="eyebrow">Owner only</p>
          <h2>Assign another admin</h2>
          <p>You are the original owner. Only the owner can add admins, reset passcodes, or remove admins. Maximum ${maxAdmins} admins total.</p>
          <form class="form-grid" data-form="admin-create" style="margin-top: 16px;">
            <label class="field">
              <span>Admin name</span>
              <input name="name" type="text" maxlength="60" required ${canAdd ? "" : "disabled"}>
            </label>
            <label class="field">
              <span>Temporary passcode</span>
              <input name="passcode" type="password" minlength="6" required ${canAdd ? "" : "disabled"}>
            </label>
            <div class="notice">
              <strong>Reset policy</strong>
              Assigned admins cannot self-reset without the owner. If they forget their passcode, the owner sets a new temporary passcode here.
            </div>
            <div class="button-row">
              <button class="tool-button dark" type="submit" ${canAdd ? "" : "disabled"}>Create admin</button>
            </div>
          </form>
        </div>

        <div id="admin-list" class="admin-panel">
          <p class="eyebrow">Admins</p>
          <h2>${admins.length} / ${maxAdmins} admins</h2>
          <p>The original owner cannot be removed or demoted.</p>
          <div class="media-list" style="margin-top: 16px;">
            ${admins.map(adminUserMarkup).join("")}
          </div>
        </div>
      </section>
    </div>
  `;

  bindCommonActions();
  bindAdminUsersActions();
}

function adminUserMarkup(admin) {
  const isOriginalOwner = admin.role === "owner";
  return `
    <article class="media-item">
      <div class="media-head">
        <div>
          <h3 class="media-title">${escapeHtml(admin.name)}</h3>
          <div class="meta-row">
            <span>${escapeHtml(admin.role)}</span>
            <span>created ${new Date(admin.createdAt).toLocaleDateString()}</span>
            ${admin.lastLoginAt ? `<span>last login ${new Date(admin.lastLoginAt).toLocaleDateString()}</span>` : ""}
          </div>
        </div>
        <span class="pill ${isOriginalOwner ? "live" : "draft"}">${isOriginalOwner ? "Owner" : "Admin"}</span>
      </div>
      <form class="form-grid" data-form="admin-reset" data-id="${escapeHtml(admin.id)}">
        <label class="field">
          <span>New temporary passcode</span>
          <input name="passcode" type="password" minlength="6" required>
        </label>
        <div class="button-row">
          <button class="quiet-button" type="submit">Reset passcode</button>
          ${isOriginalOwner ? "" : `<button class="danger-button" type="button" data-action="remove-admin" data-id="${escapeHtml(admin.id)}">Remove admin</button>`}
        </div>
      </form>
    </article>
  `;
}

async function renderAdminMedia() {
  if (IS_STATIC_PREVIEW) {
    renderStaticAdminNotice();
    return;
  }

  if (!isAdmin()) {
    replace("/admin/login/");
    return;
  }

  const media = await getAllMediaSafe();
  app.innerHTML = `
    <div class="page">
      ${topbarMarkup("admin")}
      <section class="intro-band" aria-label="Admin intention">
        <button type="button" data-scroll="#upload-panel">Upload</button>
        <button type="button" data-scroll="#media-library">Recording library</button>
        <button type="button" data-route="/admin/dashboard/">Dashboard</button>
      </section>
      <section class="admin-layout" aria-label="Media administration">
        <div id="upload-panel" class="admin-panel">
          <p class="eyebrow">Audio upload</p>
          <h2>Upload, preview, publish</h2>
          <p>Published uploads are saved to the local media server and appear in every browser using this preview URL. Drafts stay admin-only.</p>
          <form class="form-grid" data-form="media-upload" style="margin-top: 16px;">
            <label class="field">
              <span>Audio file</span>
              <input name="file" type="file" accept="audio/*" required>
            </label>
            <label class="field">
              <span>Title</span>
              <input name="title" type="text" maxlength="90" placeholder="Example: 15 Minute Master-Guided Sitting" required>
            </label>
            <label class="field">
              <span>Duration</span>
              <select name="duration" required>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="10">10 minutes, later</option>
                <option value="20">20 minutes, later</option>
                <option value="45">45 minutes, later</option>
                <option value="60">60 minutes, later</option>
              </select>
            </label>
            <label class="field">
              <span>Source or credit</span>
              <input name="source" type="text" maxlength="140" placeholder="Example: Personal test file, permitted upload, official link">
            </label>
            <label class="field">
              <span>Permission status</span>
              <select name="permission" required>
                <option value="private-test">Private test only</option>
                <option value="owned">Owned by me</option>
                <option value="permitted">Permission received</option>
                <option value="official-link">Official link or embed only</option>
                <option value="needs-permission">Needs permission before sharing</option>
              </select>
            </label>
            <label class="field">
              <span>Publish status</span>
              <select name="status" required>
                <option value="published">Published to practice flow</option>
                <option value="draft">Draft, admin preview only</option>
              </select>
            </label>
            <div id="selected-preview" class="empty-state">
              <strong>Preview appears here after choosing audio.</strong>
              <span class="hint">After saving, publish the recording to make it available for sittings.</span>
            </div>
            <div class="button-row">
              <button class="tool-button dark" type="submit">Save audio</button>
              <button class="quiet-button" type="button" data-action="export-catalog">Export catalog</button>
            </div>
          </form>
        </div>

        <div id="media-library" class="admin-panel">
          <p class="eyebrow">Recording library</p>
          <h2>${media.length} audio recording${media.length === 1 ? "" : "s"}</h2>
          <p>Admin-only library for uploads, previews, publishing, and backups.</p>
          <div class="media-list" style="margin-top: 16px;">
            ${media.length ? mediaListMarkup(media) : `
              <div class="empty-state">
                <strong>No audio uploaded yet.</strong>
                <span>Upload one 15-minute file first, then test the sitting flow.</span>
              </div>
            `}
          </div>
        </div>
      </section>
    </div>
  `;

  bindCommonActions();
  bindAdminMediaActions();
}

function bindAdminMediaActions() {
  const form = document.querySelector("[data-form='media-upload']");
  const fileInput = form.querySelector("input[type='file']");
  const preview = document.querySelector("#selected-preview");

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      showToast("Please choose an audio file.");
      fileInput.value = "";
      return;
    }
    const url = URL.createObjectURL(file);
    preview.className = "";
    preview.innerHTML = `
      <audio controls src="${url}"></audio>
      <p class="hint">${escapeHtml(file.name)} | ${formatBytes(file.size)}</p>
    `;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const file = data.get("file");
    if (!file || !file.type?.startsWith("audio/")) {
      showToast("Choose an audio file first.");
      return;
    }

    const item = {
      id: uniqueId(),
      title: String(data.get("title") || "").trim(),
      duration: Number(data.get("duration") || 15),
      source: String(data.get("source") || "").trim(),
      permission: String(data.get("permission") || "private-test"),
      status: String(data.get("status") || "draft"),
      type: "audio",
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      blob: file
    };

    await putMedia(item);
    showToast("Audio saved.");
    renderAdminMedia();
  });

  document.querySelector("[data-action='export-catalog']")?.addEventListener("click", async () => {
    const media = await getAllMediaSafe();
    const catalog = media.map(({ blob, ...item }) => item);
    downloadText("screen-to-inner-time-media-catalog.json", JSON.stringify(catalog, null, 2), "application/json");
  });

  document.querySelectorAll("[data-action='toggle-status']").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = await getMedia(button.dataset.id);
      if (!item) return;
      await updateMediaStatus(item.id, item.status === "published" ? "draft" : "published");
      renderAdminMedia();
    });
  });

  document.querySelectorAll("[data-action='download-media']").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = await getMedia(button.dataset.id);
      if (item?.blob) {
        downloadBlob(item.fileName || `${slugify(item.title)}.audio`, item.blob);
        return;
      }
      const url = item?.downloadUrl || item?.url;
      if (!url) return;
      const link = document.createElement("a");
      link.href = url;
      link.download = item.fileName || `${slugify(item.title)}.audio`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
  });

  document.querySelectorAll("[data-action='delete-media']").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = await getMedia(button.dataset.id);
      if (!item) return;
      const confirmed = window.confirm(`Delete "${item.title}" from the shared media library? Download a backup first if needed.`);
      if (!confirmed) return;
      await deleteMedia(item.id);
      renderAdminMedia();
    });
  });
}

function bindAdminUsersActions() {
  document.querySelector("[data-form='admin-create']")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const created = await createAdminUser(String(form.get("name") || "").trim(), String(form.get("passcode") || ""));
    if (!created?.admin) return;
    showToast("Admin created.");
    renderAdminUsers();
  });

  document.querySelectorAll("[data-form='admin-reset']").forEach((formNode) => {
    formNode.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(formNode);
      const reset = await resetAdminPasscode(formNode.dataset.id, String(form.get("passcode") || ""));
      if (!reset?.admin) return;
      showToast("Passcode reset.");
      renderAdminUsers();
    });
  });

  document.querySelectorAll("[data-action='remove-admin']").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = window.confirm("Remove this admin? They will lose admin access.");
      if (!confirmed) return;
      const removed = await removeAdminUser(button.dataset.id);
      if (!removed?.ok) return;
      showToast("Admin removed.");
      renderAdminUsers();
    });
  });
}

function mediaListMarkup(media) {
  return media
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map((item) => {
      const url = mediaUrlForItem(item);
      const statusClass = item.status === "published" ? "live" : "draft";
      const isBundled = Boolean(item.bundled);
      return `
        <article class="media-item">
          <div class="media-head">
            <div>
              <h3 class="media-title">${escapeHtml(item.title)}</h3>
              <div class="meta-row">
                <span>${item.duration} minutes</span>
                <span>${formatBytes(item.size || 0)}</span>
                <span>${escapeHtml(item.permission || "private-test")}</span>
                ${isBundled ? "<span>bundled</span>" : ""}
              </div>
            </div>
            <span class="pill ${statusClass}">${item.status === "published" ? "Published" : "Draft"}</span>
          </div>
          ${url ? `<audio controls src="${url}"></audio>` : ""}
          <p class="hint">${escapeHtml(item.source || "No source credit added.")}</p>
          <div class="button-row">
            <button class="quiet-button" data-action="download-media" data-id="${escapeHtml(item.id)}">Download</button>
            ${isBundled ? "" : `
              <button class="quiet-button" data-action="toggle-status" data-id="${escapeHtml(item.id)}">${item.status === "published" ? "Move to draft" : "Publish"}</button>
              <button class="danger-button" data-action="delete-media" data-id="${escapeHtml(item.id)}">Delete</button>
            `}
          </div>
        </article>
      `;
    })
    .join("");
}

function dashboardOption(value, label, selected) {
  return `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function metricCard(label, value, caption, detail) {
  return `
    <article class="metric-card">
      <p>${escapeHtml(label)}</p>
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(caption)}</span>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function bindDashboardActions() {
  const form = document.querySelector("[data-form='dashboard-filters']");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const params = new URLSearchParams();
    params.set("range", String(data.get("range") || "30"));
    params.set("duration", String(data.get("duration") || "all"));
    params.set("replaced", String(data.get("replaced") || "all"));
    navigate(`/admin/dashboard/?${params.toString()}`);
  });
}

function dashboardFilters() {
  const params = new URLSearchParams(window.location.search);
  const range = ["7", "30", "90", "365", "all"].includes(params.get("range")) ? params.get("range") : "30";
  const duration = ["all", "15", "30"].includes(params.get("duration")) ? params.get("duration") : "all";
  const replaced = ["all", "yes", "no"].includes(params.get("replaced")) ? params.get("replaced") : "all";
  return { range, duration, replaced };
}

function analyticsStats(filters) {
  const allLogs = readLogs();
  const allEvents = readEvents();
  const rangeStart = rangeStartDate(filters.range);
  const inRange = (iso) => !rangeStart || new Date(iso) >= rangeStart;
  const durationMatches = (duration) => filters.duration === "all" || Number(duration) === Number(filters.duration);
  const replacedMatches = (value) => filters.replaced === "all" || value === filters.replaced;

  const logs = allLogs.filter((log) =>
    inRange(log.endedAt || log.startedAt) &&
    durationMatches(log.plannedMinutes) &&
    replacedMatches(log.replaced)
  );
  const events = allEvents.filter((event) =>
    inRange(event.createdAt) &&
    durationMatches(event.duration || event.meta?.duration || "all")
  );

  const starts = Math.max(
    events.filter((event) => event.type === "session_start").length,
    logs.length
  );
  const completed = logs.filter((log) => log.completed || log.status === "completed").length;
  const minutes = logs.reduce((sum, log) => sum + creditedMinutes(log), 0);
  const screenShifts = logs.filter((log) => log.replaced === "yes").length;
  const activeDayKeys = new Set(logs.map((log) => localDateKey(new Date(log.endedAt || log.startedAt))));
  const frequencyValue = activeDayKeys.size ? logs.length / activeDayKeys.size : 0;
  const completionRate = starts ? Math.round((completed / starts) * 100) : 0;

  const now = new Date();
  const todayKey = localDateKey(now);
  const dau = allLogs.some((log) => localDateKey(new Date(log.endedAt || log.startedAt)) === todayKey) ? 1 : 0;
  const mau = new Set(
    allLogs
      .filter((log) => {
        const date = new Date(log.endedAt || log.startedAt);
        return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
      })
      .map((log) => localDateKey(new Date(log.endedAt || log.startedAt)))
  ).size;
  const yau = new Set(
    allLogs
      .filter((log) => new Date(log.endedAt || log.startedAt).getFullYear() === now.getFullYear())
      .map((log) => String(new Date(log.endedAt || log.startedAt).getMonth()))
  ).size;

  return {
    logs,
    events,
    starts,
    completed,
    minutes,
    screenShifts,
    completionRate,
    dau,
    mau,
    yau,
    frequency: frequencyValue ? frequencyValue.toFixed(1) : "0",
    timeline: dashboardTimeline(logs, filters.range),
    story: dashboardStory({ logs, minutes, screenShifts, completionRate, activeDays: activeDayKeys.size })
  };
}

function dashboardStory(stats) {
  if (!stats.logs.length) {
    return "No practice data yet. Once users start sittings and save reflections, this dashboard will show whether screen urges are turning into inner practice.";
  }
  if (stats.screenShifts) {
    return `${stats.screenShifts} screen shift${stats.screenShifts === 1 ? "" : "s"} and ${stats.minutes} meditation minute${stats.minutes === 1 ? "" : "s"} show the app is doing its main job: redirecting attention inward.`;
  }
  return `${stats.logs.length} sitting${stats.logs.length === 1 ? "" : "s"} logged. Next signal to watch: whether users mark sittings as replacing YouTube, browsing, or scrolling.`;
}

function rangeStartDate(range) {
  if (range === "all") return null;
  const days = Number(range);
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (days - 1));
  return date;
}

function dashboardTimeline(logs, range) {
  if (range === "365") {
    const months = [];
    for (let i = 11; i >= 0; i -= 1) {
      const date = new Date();
      date.setDate(1);
      date.setMonth(date.getMonth() - i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const minutes = logs
        .filter((log) => {
          const logDate = new Date(log.endedAt || log.startedAt);
          return `${logDate.getFullYear()}-${String(logDate.getMonth() + 1).padStart(2, "0")}` === key;
        })
        .reduce((sum, log) => sum + creditedMinutes(log), 0);
      months.push({ key, label: date.toLocaleDateString(undefined, { month: "short" }), minutes });
    }
    return months;
  }

  const days = range === "all" ? 30 : Math.min(Number(range), 30);
  const timeline = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const key = localDateKey(date);
    const minutes = logs
      .filter((log) => localDateKey(new Date(log.endedAt || log.startedAt)) === key)
      .reduce((sum, log) => sum + creditedMinutes(log), 0);
    timeline.push({ key, label: shortDayLabel(key), minutes });
  }
  return timeline;
}

function timelineBarsMarkup(timeline) {
  const max = Math.max(15, ...timeline.map((item) => item.minutes));
  return timeline.map((item) => {
    const height = Math.max(8, Math.round((item.minutes / max) * 122));
    return `
      <div class="timeline-bar-wrap">
        <div class="timeline-bar" style="height: ${height}px;" title="${escapeHtml(item.key)}: ${item.minutes} min"></div>
        <span>${escapeHtml(item.label)}</span>
      </div>
    `;
  }).join("");
}

function recordingHealthMarkup(media) {
  const durations = [15, 30, 45, 60];
  return durations.map((duration) => {
    const published = media.filter((item) => item.status === "published" && Number(item.duration) === duration).length;
    const draft = media.filter((item) => item.status !== "published" && Number(item.duration) === duration).length;
    return `
      <div class="health-row">
        <span>${duration} min</span>
        <strong>${published}</strong>
        <small>${draft} draft</small>
      </div>
    `;
  }).join("");
}

function recentLogsMarkup(logs) {
  if (!logs.length) {
    return `
      <div class="empty-state">
        <strong>No reflections yet.</strong>
        <span>After a sitting, saved reflections appear here for quick review.</span>
      </div>
    `;
  }
  return `
    <div class="recent-list">
      ${logs.slice(0, 5).map((log) => `
        <article class="recent-item">
          <strong>${creditedMinutes(log)} min | ${escapeHtml(log.replaced === "yes" ? "screen shifted" : log.source === "recording_listen" ? "listened" : "practice logged")}</strong>
          <p>${escapeHtml(log.after || log.urge || "No note added.")}</p>
          <span>${new Date(log.endedAt || log.startedAt).toLocaleString()}</span>
        </article>
      `).join("")}
    </div>
  `;
}

function bindCommonActions() {
  document.querySelectorAll("[data-route]").forEach((control) => {
    control.addEventListener("click", () => navigate(control.dataset.route));
  });
  document.querySelectorAll("[data-scroll]").forEach((control) => {
    control.addEventListener("click", () => {
      document.querySelector(control.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  document.querySelector("[data-action='logout']")?.addEventListener("click", () => {
    localStorage.removeItem(STORAGE.adminSession);
    navigate("/");
  });
}

function showModal(markup) {
  closeModal();
  const wrapper = document.createElement("div");
  wrapper.className = "modal-backdrop";
  wrapper.dataset.modal = "true";
  wrapper.innerHTML = `<div class="modal-panel" role="dialog" aria-modal="true">${markup}</div>`;
  document.body.appendChild(wrapper);
}

function closeModal() {
  document.querySelector("[data-modal='true']")?.remove();
}

function showOwnerRecoveryModal(recoveryCode) {
  showModal(`
    <h2>Save owner recovery code</h2>
    <p>This code is shown only now. Keep it private. It is the local recovery path for the original owner admin.</p>
    <div class="notice" style="margin: 14px 0;">
      <strong>${escapeHtml(recoveryCode || "Recovery code unavailable")}</strong>
    </div>
    <div class="button-row">
      <button class="tool-button dark" data-modal-action="continue-owner">I saved it</button>
    </div>
  `);
  document.querySelector("[data-modal-action='continue-owner']").addEventListener("click", () => {
    closeModal();
    navigate("/admin/dashboard/");
  });
}

function clearActiveTimer() {
  if (activeTimer) window.clearInterval(activeTimer);
  activeTimer = null;
}

function sessionProgress(session) {
  if (!session) return 0;
  return Math.min(100, Math.max(0, (session.elapsedMs / session.plannedMs) * 100));
}

function sessionAudioLabel(media) {
  if (!media) return "Silent timer until a matching audio is published";
  return `${media.title} (${media.duration} min)`;
}

function fallbackSessionMedia(minutes) {
  return {
    id: `timer-${minutes}`,
    title: `${minutes} minute Close-Eyes timer`,
    duration: minutes,
    type: "timer",
    status: "published",
    source: "Static preview fallback"
  };
}

function readLogs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE.logs) || "[]");
  } catch {
    return [];
  }
}

function writeLogs(logs) {
  localStorage.setItem(STORAGE.logs, JSON.stringify(logs.slice(0, 300)));
}

function readEvents() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE.events) || "[]");
  } catch {
    return [];
  }
}

function writeEvents(events) {
  localStorage.setItem(STORAGE.events, JSON.stringify(events.slice(0, 800)));
}

function recordInteraction(type, meta = {}) {
  const events = readEvents();
  events.unshift({
    id: uniqueId(),
    type,
    createdAt: new Date().toISOString(),
    ...meta
  });
  writeEvents(events);
}

function bindRecordingAudioTracking() {
  document.querySelectorAll("[data-listen-id]").forEach((audio) => {
    audio.addEventListener("play", () => {
      document.querySelectorAll("[data-listen-id]").forEach((otherAudio) => {
        if (otherAudio !== audio) otherAudio.pause();
      });
      startOrUpdateListeningLog(audio, "listening");
    });
    audio.addEventListener("timeupdate", () => updateListeningLog(audio, "listening"));
    audio.addEventListener("pause", () => updateListeningLog(audio, "paused"));
    audio.addEventListener("ended", () => updateListeningLog(audio, "completed"));
  });
}

function startOrUpdateListeningLog(audio, status) {
  if (!audio.dataset.listenLogId) {
    audio.dataset.listenLogId = uniqueId();
    recordInteraction("recording_listen_start", {
      duration: Number(audio.dataset.listenDuration || 0),
      mediaId: audio.dataset.listenId || "",
      mediaTitle: audio.dataset.listenTitle || "Recording"
    });
  }
  updateListeningLog(audio, status);
}

function updateListeningLog(audio, status) {
  const id = audio.dataset.listenLogId;
  if (!id) return;
  const plannedMinutes = Number(audio.dataset.listenDuration || 0);
  const actualMs = Math.max(0, Math.round(Number(audio.currentTime || 0) * 1000));
  upsertPracticeLog({
    id,
    source: "recording_listen",
    status,
    startedAt: audio.dataset.listenStartedAt || new Date().toISOString(),
    endedAt: status === "completed" || status === "paused" ? new Date().toISOString() : "",
    plannedMinutes,
    creditMinutes: plannedMinutes || displayMinutesFromMs(actualMs),
    actualMs,
    completed: status === "completed",
    urge: "",
    after: "",
    replaced: "listened",
    shiftedMinutes: 0,
    mediaTitle: audio.dataset.listenTitle || "Recording"
  });
  audio.dataset.listenStartedAt = audio.dataset.listenStartedAt || new Date().toISOString();
}

function persistActiveSession(status) {
  if (!activeSession) return;
  activeSession.lastPersistedAt = Date.now();
  upsertPracticeLog(sessionLog(status));
}

function sessionLog(status) {
  return {
    id: activeSession.id,
    source: "sitting",
    status,
    startedAt: activeSession.startedAt,
    endedAt: activeSession.endedAt || (status === "in_progress" ? "" : new Date().toISOString()),
    plannedMinutes: activeSession.minutes,
    creditMinutes: activeSession.minutes,
    actualMs: activeSession.elapsedMs,
    completed: Boolean(activeSession.completed),
    urge: activeSession.urge,
    after: "",
    replaced: status === "in_progress" ? "pending" : "not-sure",
    shiftedMinutes: 0,
    mediaTitle: activeSession.media?.title || "Silent timer"
  };
}

function savePracticeLog(afterData) {
  if (!activeSession) return;
  const log = {
    id: activeSession.id,
    source: "sitting",
    status: activeSession.completed ? "completed" : "ended",
    startedAt: activeSession.startedAt,
    endedAt: activeSession.endedAt || new Date().toISOString(),
    plannedMinutes: activeSession.minutes,
    creditMinutes: activeSession.minutes,
    actualMs: activeSession.elapsedMs,
    completed: Boolean(activeSession.completed),
    urge: activeSession.urge,
    after: afterData.after,
    replaced: afterData.replaced,
    shiftedMinutes: Number(afterData.shiftedMinutes || 0),
    mediaTitle: activeSession.media?.title || "Silent timer"
  };
  upsertPracticeLog(log);
  recordInteraction("session_complete", {
    duration: activeSession.minutes,
    completed: Boolean(activeSession.completed),
    replaced: afterData.replaced,
    shiftedMinutes: Number(afterData.shiftedMinutes || 0),
    mediaTitle: activeSession.media?.title || "Silent timer"
  });
}

function upsertPracticeLog(log) {
  const logs = readLogs();
  const index = logs.findIndex((item) => item.id === log.id);
  if (index >= 0) {
    logs[index] = { ...logs[index], ...log };
  } else {
    logs.unshift(log);
  }
  logs.sort((a, b) => String(b.startedAt || b.endedAt).localeCompare(String(a.startedAt || a.endedAt)));
  writeLogs(logs);
}

function practiceStats() {
  const logs = readLogs();
  const today = localDateKey();
  const todayLogs = logs.filter((log) => localDateKey(new Date(log.endedAt || log.startedAt)) === today);
  const weekKeys = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    weekKeys.push(localDateKey(date));
  }

  const week = weekKeys.map((key) => {
    const minutes = logs
      .filter((log) => localDateKey(new Date(log.endedAt || log.startedAt)) === key)
      .reduce((sum, log) => sum + creditedMinutes(log), 0);
    return { key, label: shortDayLabel(key), minutes };
  });

  return {
    todaySessions: todayLogs.length,
    todayMinutes: todayLogs.reduce((sum, log) => sum + creditedMinutes(log), 0),
    replacements: logs.filter((log) => log.replaced === "yes").length,
    week
  };
}

function creditedMinutes(log) {
  if (Number.isFinite(Number(log.creditMinutes)) && Number(log.creditMinutes) > 0) {
    return Number(log.creditMinutes);
  }
  if (Number.isFinite(Number(log.plannedMinutes)) && Number(log.plannedMinutes) > 0) {
    return Number(log.plannedMinutes);
  }
  return displayMinutesFromMs(log.actualMs || 0);
}

function displayMinutesFromMs(ms) {
  const value = Number(ms || 0);
  if (value <= 0) return 0;
  return Math.max(1, Math.ceil(value / 60000));
}

function weekBarsMarkup(week) {
  const max = Math.max(15, ...week.map((day) => day.minutes));
  return week.map((day) => {
    const height = Math.max(8, Math.round((day.minutes / max) * 92));
    return `
      <div class="bar-wrap">
        <div class="bar" style="height: ${height}px;" title="${day.minutes} minutes"></div>
        <span>${escapeHtml(day.label)}</span>
      </div>
    `;
  }).join("");
}

function publishedCount(media) {
  return media.filter((item) => item.status === "published").length;
}

function localDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shortDayLabel(key) {
  const date = new Date(`${key}T12:00:00`);
  return date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3);
}

function formatMs(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function getDayBrightness() {
  return Number(localStorage.getItem(STORAGE.dayBrightness) || 100);
}

function setDayBrightness(value) {
  localStorage.setItem(STORAGE.dayBrightness, String(value));
  applyDayBrightness();
}

function applyDayBrightness() {
  const brightness = getDayBrightness();
  const dim = Math.min(0.52, Math.max(0, (100 - brightness) / 115));
  document.documentElement.style.setProperty("--day-dim", String(dim));
}

function setAdminSession(admin) {
  localStorage.setItem(STORAGE.adminSession, JSON.stringify({ admin, createdAt: Date.now() }));
}

function getAdminSession() {
  try {
    const session = JSON.parse(localStorage.getItem(STORAGE.adminSession) || "null");
    if (!session?.admin) return null;
    if (Date.now() - Number(session.createdAt) >= 1000 * 60 * 60 * 12) return null;
    return session.admin;
  } catch {
    return null;
  }
}

function isAdmin() {
  return Boolean(getAdminSession());
}

function isOwner() {
  return getAdminSession()?.role === "owner";
}

function ownerPayload(extra = {}) {
  return { ...extra, actorId: getAdminSession()?.id || "" };
}

async function getAdminBootstrap() {
  return apiJson("/api/admins/bootstrap");
}

async function createOwnerAdmin(name, passcode) {
  return apiJson("/api/admins/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, passcode })
  });
}

async function loginAdmin(name, passcode) {
  return apiJson("/api/admins/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, passcode })
  });
}

async function recoverOwnerPasscode(name, recoveryCode, passcode) {
  return apiJson("/api/admins/recover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, recoveryCode, passcode })
  });
}

async function getAdminUsers() {
  return apiJson("/api/admins");
}

async function createAdminUser(name, passcode) {
  return apiJson("/api/admins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ownerPayload({ name, passcode }))
  });
}

async function resetAdminPasscode(id, passcode) {
  return apiJson(`/api/admins/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ownerPayload({ passcode }))
  });
}

async function removeAdminUser(id) {
  return apiJson(`/api/admins/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ownerPayload())
  });
}

async function apiJson(url, options = {}) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      showToast(await response.text());
      return null;
    }
    return response.json();
  } catch {
    showToast("Admin server is unavailable.");
    return null;
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        const store = db.createObjectStore(MEDIA_STORE, { keyPath: "id" });
        store.createIndex("duration", "duration");
        store.createIndex("status", "status");
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, mode);
    const store = tx.objectStore(MEDIA_STORE);
    const result = callback(store);
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
  });
}

async function getServerMedia() {
  if (IS_STATIC_PREVIEW) return null;
  try {
    const response = await fetch(MEDIA_API, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data.media) ? data.media : [];
  } catch {
    return null;
  }
}

async function saveMediaToServer(item) {
  if (IS_STATIC_PREVIEW) return null;
  if (!item?.blob) return null;
  try {
    const form = new FormData();
    form.append("file", item.blob, item.fileName || "audio");
    form.append("title", item.title || "");
    form.append("duration", String(item.duration || 15));
    form.append("source", item.source || "");
    form.append("permission", item.permission || "private-test");
    form.append("status", item.status || "draft");

    const response = await fetch(MEDIA_API, { method: "POST", body: form });
    if (!response.ok) {
      const error = await response.text();
      showToast(error || "Server upload failed. Check the local preview server.");
      return null;
    }
    const data = await response.json();
    return data.media || null;
  } catch {
    return null;
  }
}

async function updateMediaStatus(id, status) {
  if (BUNDLED_MEDIA_ITEMS.some((item) => item.id === id)) {
    showToast("Bundled recordings stay published. Add a separate upload if you need draft control.");
    return null;
  }
  const updatedOnServer = await patchMediaOnServer(id, { status });
  if (updatedOnServer) return updatedOnServer;
  const item = await getMedia(id);
  if (!item) return null;
  item.status = status;
  item.updatedAt = new Date().toISOString();
  await withStore("readwrite", (store) => store.put(item));
  return item;
}

async function patchMediaOnServer(id, fields) {
  if (IS_STATIC_PREVIEW) return null;
  try {
    const response = await fetch(`${MEDIA_API}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields)
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.media || null;
  } catch {
    return null;
  }
}

async function deleteMediaFromServer(id) {
  if (IS_STATIC_PREVIEW) return false;
  try {
    const response = await fetch(`${MEDIA_API}/${encodeURIComponent(id)}`, { method: "DELETE" });
    return response.ok;
  } catch {
    return false;
  }
}

function mediaUrlForItem(item) {
  if (!item) return "";
  if (item.url) return item.url;
  if (item.blob) return URL.createObjectURL(item.blob);
  return "";
}

async function migrateLocalMediaToServer() {
  if (IS_STATIC_PREVIEW) return;
  const serverMedia = await getServerMedia();
  if (!serverMedia) return;

  let localMedia = [];
  try {
    localMedia = await getAllLocalMedia();
  } catch {
    return;
  }

  const existingKeys = new Set(serverMedia.map(mediaIdentityKey));
  const localUploads = localMedia.filter((item) => item?.blob && !existingKeys.has(mediaIdentityKey(item)));
  if (!localUploads.length) return;

  let migratedCount = 0;
  for (const item of localUploads) {
    const migrated = await saveMediaToServer(item);
    if (migrated) {
      migratedCount += 1;
      existingKeys.add(mediaIdentityKey(migrated));
    }
  }

  if (migratedCount) {
    showToast(`${migratedCount} uploaded recording${migratedCount === 1 ? "" : "s"} moved to shared media.`);
    if (["home", "admin-media", "session"].includes(routeName())) {
      await renderRoute();
    }
  }
}

function mediaIdentityKey(item) {
  return `${item?.title || ""}|${item?.fileName || ""}|${item?.size || 0}`;
}

async function putMedia(item) {
  const serverItem = await saveMediaToServer(item);
  if (serverItem) return serverItem;
  return withStore("readwrite", (store) => store.put(item));
}

async function getMedia(id) {
  const bundledItem = BUNDLED_MEDIA_ITEMS.find((item) => item.id === id);
  if (bundledItem) return bundledItem;
  const serverMedia = await getServerMedia();
  const serverItem = serverMedia?.find((item) => item.id === id);
  if (serverItem) return serverItem;
  return withStore("readonly", (store) => store.get(id));
}

async function deleteMedia(id) {
  if (BUNDLED_MEDIA_ITEMS.some((item) => item.id === id)) {
    showToast("Bundled recordings cannot be deleted from Admin. Remove the asset from the app if needed.");
    return false;
  }
  const deletedOnServer = await deleteMediaFromServer(id);
  if (deletedOnServer) return true;
  return withStore("readwrite", (store) => store.delete(id));
}

async function getAllMedia() {
  const serverMedia = await getServerMedia();
  if (serverMedia) return mergeBundledMedia(serverMedia);
  let localMedia = [];
  try {
    localMedia = await getAllLocalMedia();
  } catch {
    localMedia = [];
  }
  return mergeBundledMedia(localMedia);
}

function mergeBundledMedia(media = []) {
  const byId = new Map();
  BUNDLED_MEDIA_ITEMS.forEach((item) => byId.set(item.id, item));
  media.forEach((item) => byId.set(item.id, item));
  return Array.from(byId.values());
}

async function getAllLocalMedia() {
  return withStore("readonly", (store) => store.getAll());
}

async function getAllMediaSafe() {
  try {
    return await withTimeout(getAllMedia(), MEDIA_LOAD_TIMEOUT_MS, BUNDLED_MEDIA_ITEMS);
  } catch (error) {
    showToast("Media storage is unavailable in this browser.");
    return BUNDLED_MEDIA_ITEMS;
  }
}

function withTimeout(promise, ms, fallbackValue) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => resolve(fallbackValue), ms);
    Promise.resolve(promise).then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function getSelectableMedia(duration) {
  const bundledForDuration = bundledMediaForDuration(duration);
  if (bundledForDuration.length) return bundledForDuration;

  const media = await getAllMediaSafe();
  return media
    .filter((item) =>
      Number(item.duration) === Number(duration) &&
      mediaUrlForItem(item) &&
      (item.status === "published" || isAdmin())
    )
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function bundledMediaForDuration(duration) {
  return BUNDLED_MEDIA_ITEMS
    .filter((item) => Number(item.duration) === Number(duration))
    .sort((a, b) => trackNumber(a.title) - trackNumber(b.title));
}

function trackNumber(title) {
  const match = String(title || "").match(/track\s+(\d+)/i);
  return match ? Number(match[1]) : 999;
}

function selectedTrackFromUrl(media) {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("track");
  if (requested && media.some((item) => item.id === requested)) return requested;
  return media[0]?.id || "";
}

async function findMediaForSession(duration, mediaId = "") {
  const media = await getSelectableMedia(duration);
  if (!media.length) return null;
  if (mediaId) {
    const chosen = media.find((item) => item.id === mediaId);
    if (chosen) return chosen;
  }
  return media[0] || null;
}

function downloadBlob(fileName, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadText(fileName, text, type) {
  downloadBlob(fileName, new Blob([text], { type }));
}

function showToast(message) {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function playBell() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 432;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 1.1);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 1.15);
  } catch {
    // Bell is optional; the sitting still works without it.
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uniqueId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function slugify(value) {
  return String(value || "audio")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "audio";
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!["http:", "https:"].includes(window.location.protocol)) return;

  if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    window.addEventListener("load", async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith("screen-to-inner-time")).map((key) => caches.delete(key)));
      }
    });
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(appUrl("/sw.js"), { scope: appUrl("/") }).catch(() => undefined);
  });
}
