import { PROFILES } from "./profiles.js";
import { adminEmails, firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js";

const STATUSES = [
  { id: "suggested", label: "Suggested" },
  { id: "queued", label: "Queued" },
  { id: "printing", label: "Printing" },
  { id: "done", label: "Done" },
];

const FILTERS = [{ id: "all", label: "All" }, ...STATUSES];

const state = {
  suggestions: [],
  photos: {},
  listReady: false,
  listError: "",
  photoListError: "",
  user: null,
  admin: false,
  routeKey: "",
  filter: "all",
  pendingDelete: "",
  cardError: "",
  photoBusy: false,
  photoMessage: "",
  previewMemory: {},
  requestPhotos: {},
};

let auth;
let db;
let storage;

const appRoot = document.getElementById("app");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function profileById(id) {
  return PROFILES.find((profile) => profile.id === id) || null;
}

function parseRoute() {
  const raw = decodeURIComponent((location.hash || "").replace(/^#\/?/, "")).trim();
  if (!raw) return { kind: "home" };
  if (raw === "all") return { kind: "all" };
  const profile = profileById(raw);
  if (profile) return { kind: "profile", profile };
  return { kind: "missing" };
}

function millis(item) {
  if (item.createdAt && typeof item.createdAt.toMillis === "function") return item.createdAt.toMillis();
  return Date.now() + 1;
}

function formatDate(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") return "Just now";
  return timestamp.toDate().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeUrl(value) {
  let trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) trimmed = `https://${trimmed}`;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname.includes(".")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "the model page";
  }
}

function safePhotoUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return "";
    if (parsed.hostname !== "firebasestorage.googleapis.com") return "";
    return url;
  } catch {
    return "";
  }
}

function withVersion(url, updatedAt) {
  const version = updatedAt && typeof updatedAt.toMillis === "function" ? updatedAt.toMillis() : "";
  if (!version) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${version}`;
}

function photoFor(id) {
  const photo = state.photos[id];
  if (!photo) return "";
  const safe = safePhotoUrl(photo.url);
  return safe ? withVersion(safe, photo.updatedAt) : "";
}

function countFor(id) {
  if (!state.listReady || state.listError) return null;
  return state.suggestions.filter((item) => item.profileId === id).length;
}

function scopedItems(route) {
  if (route.kind === "profile") return state.suggestions.filter((item) => item.profileId === route.profile.id);
  return state.suggestions;
}

function visibleItems(route) {
  const items = scopedItems(route);
  if (state.filter === "all") return items;
  return items.filter((item) => item.status === state.filter);
}

function friendlyAuthError(error) {
  const code = error?.code || "";
  if (code === "auth/unauthorized-domain") {
    return "This website isn't allowed to sign in yet. Add rons2438.github.io under Firebase Authentication → Settings → Authorized domains.";
  }
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found" || code === "auth/invalid-email") {
    return "That email and password don't match.";
  }
  if (code === "auth/popup-blocked" || code === "auth/operation-not-supported" || code === "auth/web-storage-unsupported") {
    return "Google sign-in didn't open. On an iPhone, use email and password instead.";
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
  if (code === "auth/network-request-failed") return "No connection. Try again in a moment.";
  return "Sign-in didn't work. Try again.";
}

function friendlyRulesError(error) {
  const code = error?.code || "";
  if (code === "storage/unauthorized") {
    return "Photos aren't allowed yet. Ronald still needs to publish the Storage rules for Sellers Family Print Queue. The README lists the steps.";
  }
  if (code === "permission-denied") {
    return "That isn't allowed yet. Ronald still needs to publish the database rules. The README lists the steps. The church app is unchanged.";
  }
  if (code === "storage/canceled") return "Upload canceled.";
  return "That didn't save. Check the connection and try again.";
}

function showInstallHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  let hidden = false;
  try { hidden = localStorage.getItem("print-queue-hide-install") === "1"; } catch { hidden = false; }
  return ios && !standalone && !hidden;
}

const APP_NAME = "Sellers Family Print Queue";

function brandHtml(compact) {
  return `
    <a class="brand${compact ? " compact" : ""}" href="#/">
      <img src="images/p1s-ams2-pro.webp" width="664" height="900" alt="Bambu Lab P1S with the AMS 2 Pro on top" />
      ${compact ? `<span class="brand-name">${APP_NAME}</span>` : ""}
    </a>`;
}

function homeHtml() {
  const hint = showInstallHint()
    ? `<div class="hint" id="install-hint">
        <p>On an iPhone, tap Share, then <strong>Add to Home Screen</strong>.</p>
        <button type="button" data-action="dismiss-hint">OK</button>
      </div>`
    : "";
  return `
    ${brandHtml(false)}
    <header class="intro">
      <h1 class="app-title">Sellers Family Print Queue</h1>
      <p class="lede">Tap your name. Send Ronald a model, and keep an eye on your own requests.</p>
    </header>
    ${hint}
    <p id="banner" class="banner" role="status" hidden></p>
    <div id="profile-grid" class="grid"></div>
    <p class="subnav"><a href="#/all">See the whole queue</a></p>
    <div id="admin-slot"></div>
    <footer class="credit">Printer photo: Bambu Lab, P1S AMS 2 Pro Combo.</footer>`;
}

function profileHtml(profile) {
  return `
    ${brandHtml(true)}
    <p class="back"><a href="#/">All profiles</a></p>
    <p id="banner" class="banner" role="status" hidden></p>
    <section class="who">
      <div id="avatar" class="avatar" style="--tile:${profile.color}"></div>
      <h1>${escapeHtml(profile.name)}</h1>
      <div class="photo-actions">
        <button type="button" id="photo-btn" data-action="pick-photo">Add your photo</button>
        <button type="button" id="emoji-btn" data-action="use-emoji" hidden>Use the emoji</button>
        <input id="photo-input" class="file-input" type="file" accept="image/*" />
      </div>
      <p id="photo-msg" class="fine" role="status"></p>
    </section>
    <form id="add-form">
      <h2>Suggest a print</h2>
      <p class="as">Adding this as <strong>${escapeHtml(profile.name)}</strong>.</p>
      <label for="title">What is it?</label>
      <input id="title" name="title" required maxlength="140" autocomplete="off" placeholder="Articulated dragon" />
      <label for="url">Model link</label>
      <input id="url" name="url" type="text" inputmode="url" required maxlength="2000" placeholder="https://www.printables.com/…" autocapitalize="off" autocorrect="off" spellcheck="false" />
      <label for="notes">Notes <span class="optional">(optional — color, size, who it's for)</span></label>
      <textarea id="notes" name="notes" maxlength="1000" rows="3" placeholder="Red, about 4 inches, for Willow"></textarea>
      <button type="button" class="ghost" data-action="pick-shot">Add a picture of it (optional)</button>
      <input id="shot-input" class="file-input" type="file" accept="image/*" />
      <p id="shot-name" class="fine"></p>
      <p class="form-error error" role="alert"></p>
      <p class="form-ok ok" role="status"></p>
      <button type="submit">Add to the queue</button>
    </form>
    <h2>Requests</h2>
    <div id="filters"></div>
    <p id="card-error" class="error" role="alert"></p>
    <div id="cards" class="cards"></div>
    <div id="admin-slot"></div>
    <footer class="credit">Printer photo: Bambu Lab, P1S AMS 2 Pro Combo.</footer>`;
}

function allHtml() {
  return `
    ${brandHtml(true)}
    <p class="back"><a href="#/">All profiles</a></p>
    <header class="intro">
      <h1>Whole queue</h1>
      <p class="lede">Newest first. Open a person to add a request.</p>
    </header>
    <p id="banner" class="banner" role="status" hidden></p>
    <div id="filters"></div>
    <p id="card-error" class="error" role="alert"></p>
    <div id="cards" class="cards"></div>
    <div id="admin-slot"></div>
    <footer class="credit">Printer photo: Bambu Lab, P1S AMS 2 Pro Combo.</footer>`;
}

function missingHtml() {
  return `
    ${brandHtml(true)}
    <header class="intro">
      <h1>Nobody by that name</h1>
      <p class="lede">That profile isn't on the list.</p>
    </header>
    <p class="subnav"><a href="#/">Back to profiles</a></p>`;
}

function stageProgress(status) {
  if (status === "queued") return 0.25;
  if (status === "printing") return 0.5;
  if (status === "done") return 1;
  return null;
}

function cycleProgress(profileId) {
  const stages = state.suggestions
    .filter((item) => item.profileId === profileId)
    .map((item) => stageProgress(item.status))
    .filter((value) => value !== null);
  if (stages.length === 0) return null;
  return stages.reduce((sum, value) => sum + value, 0) / stages.length;
}

function progressMarkup(progress) {
  if (progress === null) return "";
  const percent = Math.round(progress * 100);
  return `<span class="progress" style="--p:${progress}" role="img" aria-label="${percent}% of the current prints are finished"><span class="progress-shade"></span><span class="progress-ring"></span></span>`;
}

function avatarInner(profile, photoUrl, className, withProgress = false) {
  const face = photoUrl
    ? `<img src="${escapeHtml(photoUrl)}" alt="" />`
    : `<span class="${className || "emoji"}" aria-hidden="true">${profile ? profile.emoji : "🙂"}</span>`;
  const progress = withProgress && profile ? progressMarkup(cycleProgress(profile.id)) : "";
  return `<span class="avatar-clip">${face}${progress}</span>`;
}

function gridHtml() {
  return PROFILES.map((profile) => {
    const count = countFor(profile.id);
    const photoUrl = photoFor(profile.id);
    const requests = count === null ? "" : count === 1 ? ", 1 request" : `, ${count} requests`;
    const progress = cycleProgress(profile.id);
    const progressLabel = progress === null ? "" : `, ${Math.round(progress * 100)} percent finished`;
    const badge = count === null ? "" : `<span class="count">${count}</span>`;
    return `
      <a class="tile" href="#/${profile.id}" style="--tile:${profile.color}" aria-label="${escapeHtml(profile.name + requests + progressLabel)}">
        <span class="avatar${photoUrl ? " has-photo" : ""}">
          ${avatarInner(profile, photoUrl, "emoji", true)}
          ${badge}
        </span>
        <span class="tile-name">${escapeHtml(profile.name)}</span>
      </a>`;
  }).join("");
}

function filtersHtml(items) {
  return FILTERS.map((filter) => {
    const count = filter.id === "all" ? items.length : items.filter((item) => item.status === filter.id).length;
    const on = state.filter === filter.id;
    return `<button type="button" class="chip${on ? " on" : ""}" data-action="filter" data-filter="${filter.id}" aria-pressed="${on}">${filter.label} <span>${count}</span></button>`;
  }).join("");
}

function personLink(item) {
  const profile = profileById(item.profileId);
  const name = profile ? profile.name : item.name || "Someone";
  const photoUrl = profile ? photoFor(profile.id) : "";
  const inner = profile
    ? avatarInner(profile, photoUrl, "emoji")
    : `<span aria-hidden="true">🙂</span>`;
  const href = profile ? `#/${profile.id}` : "#/";
  const style = profile ? ` style="--tile:${profile.color}"` : "";
  return `<a class="who-link" href="${href}"><span class="mini"${style}>${inner}</span>${escapeHtml(name)}</a>`;
}

function adminControls(item) {
  if (state.pendingDelete === item.id) {
    return `
      <div class="confirm">
        <p>Delete this request?</p>
        <button type="button" data-action="cancel-delete">Keep</button>
        <button type="button" class="danger" data-action="confirm-delete" data-id="${escapeHtml(item.id)}">Delete</button>
      </div>`;
  }
  const options = STATUSES.map((status) => {
    const selected = status.id === item.status ? " selected" : "";
    return `<option value="${status.id}"${selected}>${status.label}</option>`;
  }).join("");
  return `
    <div class="admin-row">
      <label>Status
        <select data-action="status" data-id="${escapeHtml(item.id)}">${options}</select>
      </label>
      <button type="button" class="danger" data-action="ask-delete" data-id="${escapeHtml(item.id)}">Delete</button>
    </div>`;
}

function rememberedPreview(item) {
  return state.previewMemory[item.id] || null;
}

function rememberedPhoto(item) {
  return state.requestPhotos[item.id] || item.photoUrl || "";
}

function previewCardHtml(item, href) {
  if (!href) return "";
  const memory = rememberedPreview(item);
  const photo = safeImageUrl(rememberedPhoto(item));
  const unfurled = safeImageUrl(memory?.image || item.previewImageUrl || "");
  const image = photo || unfurled;
  const caption = (photo ? item.title : (memory?.title || item.previewTitle || item.title)) || hostLabel(href);
  const domain = hostLabel(href);
  const shown = image ? displayImage(image) : "";
  const media = shown
    ? `<img src="${escapeHtml(shown)}" alt="" data-raw="${escapeHtml(image)}" data-fallback="${escapeHtml(domain)}" />`
    : `<span class="preview-fallback">${escapeHtml(domain)}</span>`;
  return `
    <a class="preview" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
      <span class="preview-media">${media}${progressMarkup(stageProgress(item.status))}</span>
      <span class="preview-caption">${escapeHtml(caption)}</span>
    </a>`;
}

function requestPhotoControl(item) {
  const hasPhoto = Boolean(rememberedPhoto(item));
  return `
    <label class="ghost file-label">
      ${hasPhoto ? "Replace the picture" : "Add a picture"}
      <input type="file" accept="image/*" data-action="request-photo" data-id="${escapeHtml(item.id)}" />
    </label>`;
}

function cardHtml(item, showPerson) {
  const status = STATUSES.find((entry) => entry.id === item.status) || STATUSES[0];
  const href = normalizeUrl(item.url);
  const title = escapeHtml(item.title || "Untitled");
  const heading = href
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${title}</a>`
    : title;
  return `
    <article class="card">
      <div class="card-top">
        <h3>${heading}</h3>
        <span class="badge badge-${status.id}">${status.label}</span>
      </div>
      <p class="meta">${showPerson ? `${personLink(item)} · ` : ""}${escapeHtml(formatDate(item.createdAt))}</p>
      ${item.notes ? `<p class="notes">${escapeHtml(item.notes)}</p>` : ""}
      ${previewCardHtml(item, href)}
      ${href ? `<a class="model-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">View on ${escapeHtml(hostLabel(href))}</a>` : ""}
      ${requestPhotoControl(item)}
      ${state.admin ? adminControls(item) : ""}
    </article>`;
}

function cardsHtml(route) {
  if (!state.listReady) return `<p class="empty">Loading requests…</p>`;
  if (state.listError && state.suggestions.length === 0) {
    return `<p class="empty">Requests will show up here once the shared list is open.</p>`;
  }
  const items = visibleItems(route);
  if (items.length === 0) {
    const note = state.filter === "all" ? "No requests yet." : "Nothing with that status.";
    return `<p class="empty">${note}</p>`;
  }
  return items.map((item) => cardHtml(item, route.kind === "all")).join("");
}

function adminHtml() {
  if (state.user && state.admin) {
    return `
      <section class="admin-box signed-in">
        <p>Signed in as <strong>${escapeHtml(state.user.email || "Ronald")}</strong>. You can change status and delete requests.</p>
        <button type="button" data-action="sign-out">Sign out</button>
      </section>`;
  }
  if (state.user) {
    return `
      <section class="admin-box">
        <p>Signed in as <strong>${escapeHtml(state.user.email || "this account")}</strong>, but this account can't edit the queue. Use the church admin account, or add the email to the allowlist described in the README.</p>
        <button type="button" data-action="sign-out">Sign out</button>
      </section>`;
  }
  return `
    <details class="admin-box">
      <summary>Ronald's sign-in</summary>
      <p>Everyone else can ignore this. Sign in with the same account as the church app to change a status or delete a request.</p>
      <form id="admin-form">
        <label for="admin-email">Email</label>
        <input id="admin-email" name="email" type="email" autocomplete="username" required />
        <label for="admin-password">Password</label>
        <input id="admin-password" name="password" type="password" autocomplete="current-password" required />
        <p class="form-error error" role="alert"></p>
        <p class="form-ok ok" role="status"></p>
        <button type="submit">Sign in</button>
      </form>
      <div class="admin-alt">
        <button type="button" data-action="google">Sign in with Google</button>
        <button type="button" data-action="reset">Email me a password link</button>
      </div>
      <p class="fine">On an iPhone added to the Home Screen, email and password works best. Google sign-in works best in Safari.</p>
    </details>`;
}

function paintPage(route) {
  if (route.kind === "home") {
    document.title = APP_NAME;
    appRoot.innerHTML = homeHtml();
  } else if (route.kind === "profile") {
    document.title = `${route.profile.name} · ${APP_NAME}`;
    appRoot.innerHTML = profileHtml(route.profile);
  } else if (route.kind === "all") {
    document.title = `Whole queue · ${APP_NAME}`;
    appRoot.innerHTML = allHtml();
  } else {
    document.title = APP_NAME;
    appRoot.innerHTML = missingHtml();
  }
  window.scrollTo(0, 0);
}

function paintDynamic(route) {
  const banner = document.getElementById("banner");
  if (banner) {
    banner.hidden = !state.listError;
    banner.textContent = state.listError;
  }

  const grid = document.getElementById("profile-grid");
  if (grid) grid.innerHTML = gridHtml();

  if (route.kind === "profile") {
    const avatar = document.getElementById("avatar");
    const photoUrl = photoFor(route.profile.id);
    if (avatar) {
      avatar.classList.toggle("has-photo", Boolean(photoUrl));
      avatar.innerHTML = avatarInner(route.profile, photoUrl, "emoji", true);
    }
    const photoBtn = document.getElementById("photo-btn");
    const emojiBtn = document.getElementById("emoji-btn");
    if (photoBtn) {
      photoBtn.textContent = photoUrl ? "Change photo" : "Add your photo";
      photoBtn.disabled = state.photoBusy;
    }
    if (emojiBtn) {
      emojiBtn.hidden = !photoUrl;
      emojiBtn.disabled = state.photoBusy;
    }
    const photoMsg = document.getElementById("photo-msg");
    if (photoMsg) {
      photoMsg.textContent = state.photoMessage || (state.photoListError ? "Photos aren't syncing yet. Ronald may still need to publish the rules." : "This picture shows on everyone's phone.");
    }
  }

  const filters = document.getElementById("filters");
  if (filters) {
    filters.className = "filters";
    filters.setAttribute("role", "group");
    filters.setAttribute("aria-label", "Filter by status");
    filters.innerHTML = filtersHtml(scopedItems(route));
  }

  const cardError = document.getElementById("card-error");
  if (cardError) cardError.textContent = state.cardError;

  const cards = document.getElementById("cards");
  if (cards) {
    cards.innerHTML = cardsHtml(route);
    schedulePreviews(visibleItems(route));
  }

  const slot = document.getElementById("admin-slot");
  if (slot) {
    const key = state.user ? `${state.user.uid}:${state.admin}` : "signed-out";
    if (slot.dataset.key !== key) {
      slot.dataset.key = key;
      slot.innerHTML = adminHtml();
    }
  }
}

function render() {
  const route = parseRoute();
  const key = `${route.kind}:${route.profile ? route.profile.id : ""}`;
  if (key !== state.routeKey) {
    state.routeKey = key;
    state.filter = "all";
    state.pendingDelete = "";
    state.cardError = "";
    state.photoMessage = "";
    state.photoBusy = false;
    paintPage(route);
  }
  paintDynamic(route);
}

function toSuggestion(snapshot) {
  const data = snapshot.data() || {};
  return {
    id: snapshot.id,
    profileId: typeof data.profileId === "string" ? data.profileId : "",
    name: typeof data.name === "string" ? data.name : "",
    title: typeof data.title === "string" ? data.title : "",
    url: typeof data.url === "string" ? data.url : "",
    notes: typeof data.notes === "string" ? data.notes : "",
    status: STATUSES.some((status) => status.id === data.status) ? data.status : "suggested",
    createdAt: data.createdAt || null,
    photoUrl: typeof data.photoUrl === "string" ? data.photoUrl : "",
    previewImageUrl: typeof data.previewImageUrl === "string" ? data.previewImageUrl : "",
    previewTitle: typeof data.previewTitle === "string" ? data.previewTitle : "",
    previewFetched: data.previewFetched === true,
  };
}

async function refreshAdmin(user) {
  state.user = user || null;
  if (!user) {
    state.admin = false;
    render();
    return;
  }
  const email = (user.email || "").trim().toLowerCase();
  const listed = adminEmails.some((entry) => String(entry).trim().toLowerCase() === email);
  if (listed) {
    state.admin = true;
    render();
    return;
  }
  try {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    const data = snapshot.exists() ? snapshot.data() : null;
    state.admin = Boolean(data && (data.role === "admin" || data.owner === true));
  } catch {
    state.admin = false;
  }
  render();
}

async function submitSuggestion(form) {
  const route = parseRoute();
  if (route.kind !== "profile") return;
  const errorEl = form.querySelector(".form-error");
  const okEl = form.querySelector(".form-ok");
  const button = form.querySelector("button[type=submit]");
  const title = form.title.value.trim();
  const url = normalizeUrl(form.url.value);
  const notes = form.notes.value.trim();
  const shot = document.getElementById("shot-input")?.files?.[0] || null;
  const showError = (message) => {
    errorEl.textContent = message;
    okEl.textContent = "";
  };
  if (!title) return showError("Say what the print is.");
  if (title.length > 140) return showError("That title is too long.");
  if (!url) return showError("Add the full model link, starting with https://");
  if (notes.length > 1000) return showError("Those notes are too long.");
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Sending…";
  try {
    const created = await addDoc(collection(db, "printSuggestions"), {
      profileId: route.profile.id,
      name: route.profile.name,
      title,
      url,
      notes,
      status: "suggested",
      createdAt: serverTimestamp(),
    });
    if (shot) await attachRequestPhoto(created.id, shot);
    form.title.value = "";
    form.url.value = "";
    form.notes.value = "";
    const shotInput = document.getElementById("shot-input");
    if (shotInput) shotInput.value = "";
    const shotName = document.getElementById("shot-name");
    if (shotName) shotName.textContent = "";
    errorEl.textContent = "";
    okEl.textContent = "Sent. It shows here for everyone.";
  } catch (error) {
    showError(friendlyRulesError(error));
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function updateStatus(id, status) {
  if (!STATUSES.some((entry) => entry.id === status)) return;
  try {
    await updateDoc(doc(db, "printSuggestions", id), { status });
    state.cardError = "";
  } catch (error) {
    state.cardError = friendlyRulesError(error);
    render();
  }
}

async function deleteSuggestion(id) {
  try {
    await deleteDoc(doc(db, "printSuggestions", id));
    state.pendingDelete = "";
    state.cardError = "";
    render();
  } catch (error) {
    state.cardError = friendlyRulesError(error);
    state.pendingDelete = "";
    render();
  }
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function safeImageUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return url;
  } catch {
    return "";
  }
}

async function microlink(url, query) {
  const response = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}${query}`, {
    signal: timeoutSignal(20000),
  });
  if (!response.ok) return null;
  const body = await response.json();
  if (body.status !== "success") return null;
  return body.data || null;
}

function microlinkImage(data) {
  const image = data?.image;
  const url = typeof image === "string" ? image : image?.url;
  return safeImageUrl(url || "");
}

function displayImage(url) {
  const safe = safeImageUrl(url);
  if (!safe || safe.startsWith("data:")) return safe;
  const bare = safe.replace(/^https?:\/\//, "");
  return `https://images.weserv.nl/?url=${encodeURIComponent(bare)}&w=900&h=560&fit=cover&we`;
}

function canonicalModelUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return "";
  const parsed = new URL(normalized);
  parsed.hash = "";
  ["appSharePlatform", "utm_source", "utm_medium", "utm_campaign", "utm_content", "from"].forEach((key) => {
    parsed.searchParams.delete(key);
  });
  return parsed.toString();
}

async function printablesPreview(url) {
  const match = String(url).match(/printables\.com\/(?:model|print)\/(\d+)/i);
  if (!match) return null;
  const query = `query { print(id: "${match[1]}") { name image { filePath } } }`;
  const endpoint = `https://api.printables.com/graphql?query=${encodeURIComponent(query)}`;
  // The GraphQL API blocks browser calls. allorigins fetches it and adds CORS.
  const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(endpoint)}`, {
    signal: timeoutSignal(15000),
  });
  if (!response.ok) return null;
  const wrapped = await response.json();
  const body = JSON.parse(wrapped.contents || "{}");
  const print = body?.data?.print;
  const filePath = typeof print?.image?.filePath === "string" ? print.image.filePath.replace(/^\/+/, "") : "";
  return {
    image: filePath ? safeImageUrl(`https://media.printables.com/${filePath}`) : "",
    title: typeof print?.name === "string" ? print.name.slice(0, 180) : "",
  };
}

async function unfurl(url) {
  const target = canonicalModelUrl(url);
  if (!target) return null;
  if (/printables\.com/i.test(target)) {
    try {
      const direct = await printablesPreview(target);
      if (direct?.image) return direct;
    } catch {
      // Try the general lookup below.
    }
  }
  const meta = await microlink(target, "");
  const title = typeof meta?.title === "string" ? meta.title.slice(0, 180) : "";
  const image = microlinkImage(meta);
  if (image) return { image, title };
  if (!meta) {
    const retry = await microlink(target, "&force=true");
    const retryTitle = typeof retry?.title === "string" ? retry.title.slice(0, 180) : "";
    const retryImage = microlinkImage(retry);
    if (retryImage || retryTitle) return { image: retryImage, title: retryTitle };
  }
  return title ? { image: "", title } : null;
}

const previewQueued = new Set();
let previewRunning = 0;
const previewWait = [];

function schedulePreviews(items) {
  for (const item of items) {
    const memory = state.previewMemory[item.id];
    const savedImage = safeImageUrl(memory?.image || item.previewImageUrl || "");
    if (rememberedPhoto(item) || savedImage || (memory?.attempts || 0) >= 2 || previewQueued.has(item.id)) continue;
    if (!normalizeUrl(item.url)) continue;
    previewQueued.add(item.id);
    previewWait.push(item);
  }
  pumpPreviews();
}

function pumpPreviews() {
  while (previewRunning < 2 && previewWait.length) {
    const item = previewWait.shift();
    previewRunning += 1;
    savePreview(item).finally(() => {
      previewRunning -= 1;
      previewQueued.delete(item.id);
      pumpPreviews();
    });
  }
}

async function savePreview(item) {
  let result = null;
  try {
    result = await unfurl(item.url);
  } catch {
    result = null;
  }
  const attempts = (state.previewMemory[item.id]?.attempts || 0) + 1;
  if (!result?.image) {
    state.previewMemory[item.id] = { image: "", title: result?.title || "", fetched: false, attempts };
    return;
  }
  state.previewMemory[item.id] = { image: result.image, title: result.title, fetched: true, attempts };
  render();
  try {
    await updateDoc(doc(db, "printSuggestions", item.id), {
      previewImageUrl: result.image,
      previewTitle: result.title,
      previewFetched: true,
    });
  } catch {
    // The picture still shows from memory until the database rules allow this save.
  }
}

async function attachRequestPhoto(id, file) {
  if (!file || !file.type.startsWith("image/")) return;
  let blob;
  try {
    blob = await resizeToJpeg(file, 960);
  } catch {
    state.cardError = "Couldn't read that picture. Try a JPEG or PNG.";
    render();
    return;
  }
  const localUrl = URL.createObjectURL(blob);
  state.requestPhotos[id] = localUrl;
  render();
  try {
    const storageRef = ref(storage, `print-queue/requests/${id}.jpg`);
    await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
    const url = await getDownloadURL(storageRef);
    state.requestPhotos[id] = url;
    await updateDoc(doc(db, "printSuggestions", id), { photoUrl: url });
  } catch (error) {
    state.cardError = error?.code === "storage/unauthorized" || error?.code === "permission-denied"
      ? "The picture shows on this phone. Ronald still needs to publish the updated print rules so everyone else keeps it."
      : friendlyRulesError(error);
  }
  render();
}

async function resizeToJpeg(file, maxEdge) {
  const loaded = await loadBitmap(file);
  try {
    const source = loaded.source;
    const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(source, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("unreadable"))), "image/jpeg", 0.82);
    });
    return blob;
  } finally {
    if (typeof loaded.source.close === "function") loaded.source.close();
    if (loaded.revoke) loaded.revoke();
  }
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, revoke: null };
    } catch {
      // Fall through to an Image element for older iPhones.
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("unreadable"));
      element.src = objectUrl;
    });
    return { source: image, revoke: () => URL.revokeObjectURL(objectUrl) };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function uploadPhoto(file) {
  const route = parseRoute();
  if (route.kind !== "profile" || !file) return;
  if (!file.type.startsWith("image/")) {
    state.photoMessage = "Choose a picture.";
    render();
    return;
  }
  state.photoBusy = true;
  state.photoMessage = "Shrinking the photo…";
  render();
  try {
    const blob = await resizeToJpeg(file, 256);
    state.photoMessage = "Saving…";
    render();
    const storageRef = ref(storage, `print-queue/profiles/${route.profile.id}.jpg`);
    await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
    const url = await getDownloadURL(storageRef);
    await setDoc(doc(db, "printProfiles", route.profile.id), {
      photoUrl: url,
      updatedAt: serverTimestamp(),
    });
    state.photoMessage = "Photo updated. Everyone can see it.";
  } catch (error) {
    state.photoMessage = error?.message === "unreadable"
      ? "Couldn't read that picture. Try a JPEG or PNG."
      : friendlyRulesError(error);
  } finally {
    state.photoBusy = false;
    const input = document.getElementById("photo-input");
    if (input) input.value = "";
    render();
  }
}

async function useEmoji() {
  const route = parseRoute();
  if (route.kind !== "profile") return;
  state.photoBusy = true;
  state.photoMessage = "Removing the photo…";
  render();
  try {
    await deleteObject(ref(storage, `print-queue/profiles/${route.profile.id}.jpg`)).catch((error) => {
      if (error?.code !== "storage/object-not-found") throw error;
    });
    await deleteDoc(doc(db, "printProfiles", route.profile.id));
    state.photoMessage = "Back to the emoji.";
  } catch (error) {
    state.photoMessage = friendlyRulesError(error);
  } finally {
    state.photoBusy = false;
    render();
  }
}

async function signInWithPassword(form) {
  const errorEl = form.querySelector(".form-error");
  const okEl = form.querySelector(".form-ok");
  const button = form.querySelector("button[type=submit]");
  errorEl.textContent = "";
  okEl.textContent = "";
  button.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, form.email.value.trim(), form.password.value);
  } catch (error) {
    errorEl.textContent = friendlyAuthError(error);
  } finally {
    button.disabled = false;
  }
}

async function signInWithGoogle() {
  const errorEl = document.querySelector("#admin-form .form-error");
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    const message = friendlyAuthError(error);
    if (errorEl && message) errorEl.textContent = message;
  }
}

async function emailPasswordLink() {
  const form = document.getElementById("admin-form");
  if (!form) return;
  const errorEl = form.querySelector(".form-error");
  const okEl = form.querySelector(".form-ok");
  const email = form.email.value.trim();
  if (!email.includes("@")) {
    errorEl.textContent = "Type your email first, then tap the password link.";
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    errorEl.textContent = "";
    okEl.textContent = "Check your email for a link to set a password, then sign in here.";
  } catch (error) {
    const code = error?.code || "";
    okEl.textContent = "";
    errorEl.textContent = code === "auth/user-not-found"
      ? "No account uses that email yet. Sign in with Google in Safari once, then set a password."
      : friendlyAuthError(error);
  }
}

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === "add-form") {
    event.preventDefault();
    submitSuggestion(form);
  } else if (form.id === "admin-form") {
    event.preventDefault();
    signInWithPassword(form);
  }
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "filter") {
    state.filter = button.dataset.filter || "all";
    state.pendingDelete = "";
    render();
  } else if (action === "ask-delete") {
    state.pendingDelete = button.dataset.id || "";
    render();
  } else if (action === "cancel-delete") {
    state.pendingDelete = "";
    render();
  } else if (action === "confirm-delete") {
    deleteSuggestion(button.dataset.id);
  } else if (action === "pick-photo") {
    document.getElementById("photo-input")?.click();
  } else if (action === "pick-shot") {
    document.getElementById("shot-input")?.click();
  } else if (action === "use-emoji") {
    useEmoji();
  } else if (action === "google") {
    signInWithGoogle();
  } else if (action === "reset") {
    emailPasswordLink();
  } else if (action === "sign-out") {
    signOut(auth);
  } else if (action === "dismiss-hint") {
    try { localStorage.setItem("print-queue-hide-install", "1"); } catch { /* ignore */ }
    document.getElementById("install-hint")?.remove();
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.action === "status") {
    updateStatus(target.dataset.id, target.value);
  } else if (target.id === "photo-input" && target instanceof HTMLInputElement) {
    uploadPhoto(target.files && target.files[0]);
  } else if (target.id === "shot-input" && target instanceof HTMLInputElement) {
    const name = document.getElementById("shot-name");
    const file = target.files && target.files[0];
    if (name) name.textContent = file ? `Picture ready: ${file.name}` : "";
  } else if (target.dataset.action === "request-photo" && target instanceof HTMLInputElement) {
    const file = target.files && target.files[0];
    if (file && target.dataset.id) attachRequestPhoto(target.dataset.id, file);
  }
});

document.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.dataset.fallback) return;
  if (image.dataset.raw && image.getAttribute("src") !== image.dataset.raw) {
    const raw = image.dataset.raw;
    delete image.dataset.raw;
    image.src = raw;
    return;
  }
  const media = image.parentElement;
  const fallback = document.createElement("span");
  fallback.className = "preview-fallback";
  fallback.textContent = image.dataset.fallback;
  image.replaceWith(fallback);
  if (media) media.dataset.broken = "true";
}, true);

window.addEventListener("hashchange", () => render());

async function start() {
  let firebaseApp;
  try {
    firebaseApp = initializeApp(firebaseConfig);
    auth = getAuth(firebaseApp);
    db = getFirestore(firebaseApp);
    storage = getStorage(firebaseApp);
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    appRoot.innerHTML = `<p class="banner">The app couldn't reach Firebase. Check firebase-config.js.</p>`;
    return;
  }

  render();

  onAuthStateChanged(auth, (user) => {
    refreshAdmin(user);
  });

  onSnapshot(collection(db, "printSuggestions"), (snapshot) => {
    state.suggestions = snapshot.docs.map(toSuggestion).sort((a, b) => millis(b) - millis(a));
    state.listReady = true;
    state.listError = "";
    render();
  }, (error) => {
    state.listReady = true;
    state.listError = error?.code === "permission-denied"
      ? "The shared list isn't open yet. Ronald still needs to publish the Sellers Family Print Queue database rules (see the README). You can look around, but new requests won't save until then."
      : "Couldn't load the list. Check the connection and try again.";
    render();
  });

  onSnapshot(collection(db, "printProfiles"), (snapshot) => {
    const photos = {};
    snapshot.forEach((entry) => {
      const data = entry.data() || {};
      if (typeof data.photoUrl === "string") {
        photos[entry.id] = { url: data.photoUrl, updatedAt: data.updatedAt || null };
      }
    });
    state.photos = photos;
    state.photoListError = "";
    render();
  }, () => {
    state.photoListError = "photos-blocked";
    render();
  });

  if ("serviceWorker" in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

start();
