/* ────────────────────────────────────────────────────────────────
   Hypocampus · Review Page
   ──────────────────────────────────────────────────────────────── */

let allQuestions = [];

// ── STATE ────────────────────────────────────────────────────────
const state = {
  view: "timeline",       // "timeline" | "subject"
  filterStatus: "all",    // "all" | "new" | "exported"
  filterAnswer: "all",    // "all" | "wrong" | "partial" | "unknown"
  filterFormat: "all",    // "all" | "QI" | "DP" | "KFP"
  filterMedia: "all",     // "all" | "with-image" | "no-image"
  filterSubject: null,    // null = all, or subject string
  sort: "newest",         // "newest" | "oldest" | "subject"
  search: ""
};

const FORMAT_ORDER = ["DP", "KFP", "DP_or_KFP", "QI"];

// ── THEME ────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("hypocampus-theme", theme);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
}
applyTheme(localStorage.getItem("hypocampus-theme") || "light");
document.getElementById("themeToggle")?.addEventListener("click", () => {
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
});

// ── LOAD & RENDER ────────────────────────────────────────────────

async function loadQuestions() {
  const { questions = [] } = await chrome.storage.local.get("questions");
  allQuestions = questions.slice();
  updateStats();
  populateSubjectList();
  refreshChapterControls();
  renderAll();
}

function listChapters() {
  return Array.from(new Set(
    allQuestions.map(q => (q.chapter || "").trim()).filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, "fr"));
}

function refreshChapterControls() {
  const chapters = listChapters();
  const sel = document.getElementById("chapterFilter");
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = "";
    sel.appendChild(el("option", { value: "", textContent: "Tous les chapitres" }));
    for (const ch of chapters) sel.appendChild(el("option", { value: ch, textContent: ch }));
    if (chapters.includes(cur)) sel.value = cur;
  }
  const dl = document.getElementById("chapterDatalist");
  if (dl) {
    dl.innerHTML = "";
    for (const ch of chapters) dl.appendChild(el("option", { value: ch }));
  }
}

function updateStats() {
  const total = allQuestions.length;
  const newCount = allQuestions.filter(q => !q.exportedAt).length;
  const subjects = new Set(allQuestions.map(q => getSubjectLabel(q))).size;

  document.getElementById("statTotal").textContent = String(total);
  document.getElementById("statNew").textContent = String(newCount);
  document.getElementById("statSubjects").textContent = String(subjects);

  const exportNewBtn = document.getElementById("exportNewBtn");
  exportNewBtn.disabled = newCount === 0;
  exportNewBtn.textContent = `↓ Nouvelles (${newCount})`;
}

function populateSubjectList() {
  const container = document.getElementById("subjectList");
  container.innerHTML = "";

  const counts = new Map();
  for (const q of allQuestions) {
    const subj = getSubjectLabel(q);
    counts.set(subj, (counts.get(subj) || 0) + 1);
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  document.getElementById("subjectCount").textContent = `(${sorted.length})`;

  // "All" button
  const allBtn = document.createElement("button");
  allBtn.className = "subject-item" + (state.filterSubject === null ? " active" : "");
  allBtn.innerHTML = `<span class="subject-name">Toutes les matières</span><span class="subject-badge">${allQuestions.length}</span>`;
  allBtn.addEventListener("click", () => {
    state.filterSubject = null;
    highlightSubjectItem(container, null);
    renderAll();
  });
  container.appendChild(allBtn);

  for (const [subject, count] of sorted) {
    const btn = document.createElement("button");
    btn.className = "subject-item" + (state.filterSubject === subject ? " active" : "");
    btn.dataset.subject = subject;
    btn.innerHTML = `<span class="subject-name">${escapeHtml(subject)}</span><span class="subject-badge">${count}</span>`;
    btn.addEventListener("click", () => {
      state.filterSubject = subject;
      highlightSubjectItem(container, subject);
      renderAll();
    });
    container.appendChild(btn);
  }
}

function highlightSubjectItem(container, subject) {
  container.querySelectorAll(".subject-item").forEach(btn => {
    const isMatch = subject === null
      ? !btn.dataset.subject
      : btn.dataset.subject === subject;
    btn.classList.toggle("active", isMatch);
  });
}

// ── FILTERING ────────────────────────────────────────────────────

function getFiltered() {
  const chapter = document.getElementById("chapterFilter")?.value || "";
  return allQuestions.filter(q => {
    // Status filter
    if (state.filterStatus === "new" && q.exportedAt) return false;
    if (state.filterStatus === "exported" && !q.exportedAt) return false;

    // Answer filter
    if (state.filterAnswer !== "all" && q.status !== state.filterAnswer) return false;

    // Format filter
    if (state.filterFormat !== "all") {
      const qFormat = normalizedFormat(q);
      if (state.filterFormat === "DP" && qFormat !== "DP" && qFormat !== "DP_or_KFP") return false;
      if (state.filterFormat === "KFP" && qFormat !== "KFP" && qFormat !== "DP_or_KFP") return false;
      if (state.filterFormat === "QI" && qFormat !== "QI") return false;
    }

    // Media filter
    if (state.filterMedia !== "all") {
      const hasImage = Array.isArray(q.images) && q.images.length > 0;
      if (state.filterMedia === "with-image" && !hasImage) return false;
      if (state.filterMedia === "no-image" && hasImage) return false;
    }

    // Chapter filter
    if (chapter && (q.chapter || "").trim() !== chapter) return false;

    // Subject filter
    if (state.filterSubject && getSubjectLabel(q) !== state.filterSubject) return false;

    // Search
    if (state.search && !buildHaystack(q).includes(state.search)) return false;

    return true;
  });
}

function buildHaystack(q) {
  const free = (q.freeAnswers || []).flatMap(a => [a.userAnswer, a.expectedAnswer]).filter(Boolean).join(" ");
  const opts = (q.options || []).flatMap(o => [o.text, o.explanation, o.label]).filter(Boolean).join(" ");
  const imgText = (q.images || []).flatMap(i => [i.alt, i.title]).filter(Boolean).join(" ");
  return [
    q.customTitle, q.chapter, q.subject, q.seriesTitle, q.seriesId, q.format,
    q.vignette, q.questionText, q.contextLabel, q.pageTitle, q.correctionText,
    (q.selectedAnswers || []).join(" "), (q.correctAnswers || []).join(" "),
    opts, free, imgText
  ].filter(Boolean).join(" ").toLowerCase();
}

function sortQuestions(questions) {
  const sorted = questions.slice();
  switch (state.sort) {
    case "newest":
      sorted.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
      break;
    case "oldest":
      sorted.sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
      break;
    case "subject":
      sorted.sort((a, b) => getSubjectLabel(a).localeCompare(getSubjectLabel(b), "fr") || new Date(b.capturedAt) - new Date(a.capturedAt));
      break;
  }
  return sorted;
}

// ── RENDER ────────────────────────────────────────────────────────

function renderAll() {
  const list = document.getElementById("questionList");
  const emptyState = document.getElementById("emptyState");

  // Clear previous render
  list.querySelectorAll(".card, .series-card, .subject-group-header").forEach(el => el.remove());

  const filtered = getFiltered();
  const sorted = sortQuestions(filtered);

  // Results summary
  const summary = document.getElementById("resultsSummary");
  if (filtered.length === allQuestions.length) {
    summary.textContent = `${filtered.length} question${filtered.length !== 1 ? "s" : ""}`;
  } else {
    summary.textContent = `${filtered.length} / ${allQuestions.length} question${allQuestions.length !== 1 ? "s" : ""}`;
  }

  if (sorted.length === 0) {
    emptyState.style.display = "block";
    emptyState.textContent = allQuestions.length === 0
      ? "Aucune question capturée pour l'instant."
      : "Aucun résultat pour ces filtres.";
    return;
  }

  emptyState.style.display = "none";
  const frag = document.createDocumentFragment();

  if (state.view === "subject") {
    renderSubjectView(sorted, frag);
  } else {
    renderTimelineView(sorted, frag);
  }

  list.appendChild(frag);
}

function renderTimelineView(sorted, frag) {
  const items = groupReviewItems(sorted);
  for (const item of items) {
    frag.appendChild(item.type === "series"
      ? buildSeriesCard(item.questions)
      : buildCard(item.question)
    );
  }
}

function renderSubjectView(sorted, frag) {
  const groups = new Map();
  for (const q of sorted) {
    const subj = getSubjectLabel(q);
    if (!groups.has(subj)) groups.set(subj, []);
    groups.get(subj).push(q);
  }

  const sortedGroups = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], "fr"));

  for (const [subject, questions] of sortedGroups) {
    // Group header
    const header = el("div", { className: "subject-group-header" });
    header.appendChild(el("span", { className: "subject-group-title", textContent: subject }));
    header.appendChild(el("span", {
      className: "subject-group-count",
      textContent: `${questions.length} question${questions.length > 1 ? "s" : ""}`
    }));
    frag.appendChild(header);

    // Questions
    const items = groupReviewItems(questions);
    for (const item of items) {
      frag.appendChild(item.type === "series"
        ? buildSeriesCard(item.questions)
        : buildCard(item.question)
      );
    }
  }
}

// ── SERIES GROUPING ──────────────────────────────────────────────

function groupReviewItems(questions) {
  const groups = new Map();
  const emitted = new Set();
  const items = [];

  for (const question of questions) {
    if (!isSeriesQuestion(question)) continue;
    if (!groups.has(question.seriesId)) groups.set(question.seriesId, []);
    groups.get(question.seriesId).push(question);
  }

  for (const question of questions) {
    if (!isSeriesQuestion(question)) {
      items.push({ type: "single", question });
      continue;
    }

    if (emitted.has(question.seriesId)) continue;
    emitted.add(question.seriesId);
    items.push({
      type: "series",
      questions: groups.get(question.seriesId).slice().sort(sortBySeriesPosition)
    });
  }

  return items;
}

function isSeriesQuestion(question) {
  return Boolean(question.seriesId && question.format && question.format !== "QI");
}

function sortBySeriesPosition(a, b) {
  return (a.seriesPosition || 0) - (b.seriesPosition || 0) ||
    new Date(a.capturedAt) - new Date(b.capturedAt);
}

// ── CARD BUILDER ─────────────────────────────────────────────────

function buildSeriesCard(questions) {
  const first = questions[0] || {};
  const article = el("article", { className: "series-card" + (questions.every(q => q.exportedAt) ? " is-exported" : "") });
  const details = document.createElement("details");
  details.className = "series-details";
  const header = el("summary", { className: "series-header" });

  header.appendChild(badge(first.format || "Série", "badge-series"));
  header.appendChild(el("strong", {
    className: "series-title",
    textContent: first.customTitle || first.seriesTitle || `Dossier ${first.seriesId || ""}`.trim()
  }));
  if (first.chapter) header.appendChild(badge(`📚 ${first.chapter}`, "badge-chapter"));
  header.appendChild(el("span", {
    className: "series-count",
    textContent: `${questions.length}/${first.seriesTotal || questions.length} question(s)`
  }));
  header.appendChild(buildSeriesActions(questions));
  details.appendChild(header);

  // DP progressif : la vignette évolue au fil des questions. On affiche la vignette
  // de base en haut, puis devant chaque question suivante un encadré "ajout" avec
  // uniquement les nouvelles lignes apportées par rapport à la vignette précédente.
  const { baseVignette, items } = buildSeriesAdditions(questions);
  if (baseVignette) details.appendChild(buildVignette(baseVignette));

  const listEl = el("div", { className: "series-question-list" });
  for (const item of items) {
    if (item.addition) {
      listEl.appendChild(buildVignetteAddition(item.addition, item.question.seriesPosition));
    }
    listEl.appendChild(buildCard(item.question, "series-child"));
  }

  details.appendChild(listEl);
  article.appendChild(details);
  return article;
}

function buildSeriesAdditions(questions) {
  const sorted = [...questions].sort((a, b) =>
    (a.seriesPosition || 0) - (b.seriesPosition || 0) ||
    new Date(a.capturedAt) - new Date(b.capturedAt)
  );

  let baseVignette = null;
  let prevNonEmpty = null;
  const items = [];

  for (const q of sorted) {
    const v = (q.vignette || "").trim();
    if (!v) {
      items.push({ question: q, addition: null });
      continue;
    }
    if (baseVignette === null) {
      baseVignette = v;
      prevNonEmpty = v;
      items.push({ question: q, addition: null });
      continue;
    }
    let addition;
    if (v.startsWith(prevNonEmpty)) {
      addition = v.slice(prevNonEmpty.length).trim();
    } else {
      const normPrev = prevNonEmpty.replace(/\s+/g, " ").trim();
      const normCurr = v.replace(/\s+/g, " ").trim();
      if (normCurr.startsWith(normPrev)) {
        addition = normCurr.slice(normPrev.length).trim();
      } else {
        addition = v;
      }
    }
    items.push({ question: q, addition: addition || null });
    prevNonEmpty = v;
  }

  return { baseVignette, items };
}

function buildVignetteAddition(text, position) {
  const wrap = el("div", { className: "vignette-addition" });
  wrap.appendChild(el("span", {
    className: "vignette-addition-label",
    textContent: position ? `+ Ajout avant question ${position}` : "+ Ajout"
  }));
  wrap.appendChild(el("p", { className: "vignette-addition-text", textContent: text }));
  return wrap;
}

function buildCard(q, extraClass = "") {
  const article = el("article", {
    className: ["card", extraClass, q.exportedAt ? "is-exported" : ""].filter(Boolean).join(" ")
  });

  // Top bar
  const top = el("div", { className: "card-top" });
  top.appendChild(buildStatusBadge(q.status));
  if (q.format && q.format !== "QI") {
    top.appendChild(badge(formatLabel(q), "badge-format"));
  }
  top.appendChild(q.exportedAt
    ? badge("Exportée", "badge-exported")
    : badge("Nouvelle", "badge-new")
  );

  const imgBadge = buildImagesBadge(q.images);
  if (imgBadge) top.appendChild(imgBadge);

  // Chapter badge (only when not inside a series — la série l'affiche au header)
  if (q.chapter && extraClass !== "series-child") {
    top.appendChild(badge(`📚 ${q.chapter}`, "badge-chapter"));
  }

  // Subject tag (only in timeline view, not inside series)
  if (!extraClass && state.view === "timeline") {
    const subjectLabel = getSubjectLabel(q);
    if (subjectLabel !== "Matière inconnue") {
      top.appendChild(el("span", { className: "card-subject-tag", textContent: subjectLabel }));
    }
  }

  top.appendChild(el("span", { className: "card-date", textContent: formatDate(q.capturedAt) }));
  top.appendChild(buildCardActions(q));
  article.appendChild(top);

  // Body
  const body = el("div", { className: "card-body" });

  if (q.customTitle) body.appendChild(el("p", { className: "card-custom-title", textContent: q.customTitle }));

  const ctx = q.contextLabel || q.pageTitle;
  if (ctx) body.appendChild(el("p", { className: "card-context", textContent: ctx }));
  if (!extraClass && q.vignette) body.appendChild(buildVignette(q.vignette));

  body.appendChild(el("div", { className: "card-question", textContent: q.questionText || "—" }));

  if (q.images && q.images.length > 0) body.appendChild(buildImagesRow(q.images, q.id));
  if (q.options && q.options.length > 0) body.appendChild(buildOptionsList(q.options));
  if (q.freeAnswers && q.freeAnswers.length > 0) body.appendChild(buildFreeAnswers(q.freeAnswers));
  if (q.correctionText) body.appendChild(buildCorrection(q.correctionText));

  article.appendChild(body);
  return article;
}

function formatLabel(q) {
  const position = q.seriesPosition && q.seriesTotal
    ? ` ${q.seriesPosition}/${q.seriesTotal}`
    : "";
  return `${q.format}${position}`;
}

function buildStatusBadge(status) {
  const map = {
    wrong: ["Incorrecte", "badge-wrong"],
    partial: ["Partielle", "badge-partial"],
    unknown: ["Indéterminée", "badge-unknown"],
    correct: ["Correcte", "badge-correct"],
    unanswered: ["Non répondue", "badge-unknown"]
  };
  const [label, cls] = map[status] || ["?", "badge-unknown"];
  return badge(label, cls);
}

function badge(text, cls) {
  return el("span", { className: `badge ${cls}`, textContent: text });
}

function buildImagesBadge(images) {
  if (!images || images.length === 0) return null;
  const captured = images.filter(i => i.dataUrl).length;
  const total = images.length;
  const cls = captured === total
    ? "badge-img-ok"
    : captured === 0
    ? "badge-img-none"
    : "badge-img-partial";
  return badge(`🖼 ${captured}/${total}`, cls);
}

function buildVignette(text) {
  const details = document.createElement("details");
  details.className = "vignette";
  details.appendChild(el("summary", { textContent: "Vignette clinique" }));
  details.appendChild(el("p", { className: "vignette-text", textContent: text }));
  return details;
}

function buildImagesRow(images, questionId) {
  const row = el("div", { className: "images-row" });
  for (const img of images) {
    const displaySrc = img.dataUrl || null;
    if (displaySrc) {
      const wrap = el("div", { className: "img-thumb-wrap" });
      const thumb = el("img", {
        className: "img-thumb",
        src: displaySrc,
        alt: img.alt || "Image",
        title: [img.section, img.width && img.height ? `${img.width}×${img.height}` : "", "embarquée"].filter(Boolean).join(" · ")
      });
      thumb.addEventListener("click", () => openLightbox(displaySrc, img.alt));
      wrap.appendChild(thumb);
      if (questionId && img.id) {
        const xBtn = el("button", {
          className: "img-delete-btn",
          type: "button",
          title: "Supprimer cette image",
          textContent: "✕"
        });
        xBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!confirm("Supprimer cette image de la question ?\n\nL'action est définitive.")) return;
          try {
            const { questions = [] } = await chrome.storage.local.get("questions");
            const target = questions.find(qq => qq.id === questionId);
            if (!target) throw new Error("Question introuvable");

            if (Array.isArray(target.images)) target.images = target.images.filter(i => i?.id !== img.id);
            if (Array.isArray(target.screenshots)) target.screenshots = target.screenshots.filter(i => i?.id !== img.id);

            await chrome.storage.local.set({ questions });

            // Best-effort push vers serveur localhost
            const ok = await pushQuestionToServer(target);
            if (ok) delete target.needsSync;
            else target.needsSync = true;
            await chrome.storage.local.set({ questions });

            await loadQuestions();
          } catch (err) {
            alert(`Échec suppression image : ${err.message || err}`);
          }
        });
        wrap.appendChild(xBtn);
      }
      row.appendChild(wrap);
    } else {
      const blocked = el("div", { className: "img-blocked", title: img.dataUrlStatus || "Bloquée" });
      blocked.innerHTML = `<span>⛔</span><small>Bloquée</small>`;
      row.appendChild(blocked);
    }
  }
  return row;
}

function buildOptionsList(options) {
  const ul = el("ul", { className: "options-list" });
  for (const opt of options) {
    const cls = opt.correct ? "opt-correct" : (opt.incorrect ? "opt-incorrect" : "");
    const li = el("li", { className: `option-item ${cls}` });

    li.appendChild(el("span", { className: "opt-label", textContent: opt.label || "?" }));
    li.appendChild(el("span", { className: "opt-text", textContent: truncate(opt.text, 300) }));

    if (opt.selected && !opt.correct && !opt.incorrect) {
      li.appendChild(el("span", { className: "opt-selected-dot", textContent: "●", title: "Votre réponse" }));
    }

    const mark = opt.correct ? "✓" : (opt.incorrect && opt.selected ? "✗" : "");
    if (mark) {
      li.appendChild(el("span", { className: "opt-mark", textContent: mark }));
    }

    ul.appendChild(li);
  }
  return ul;
}

function buildFreeAnswers(answers) {
  const box = el("div", { className: "free-answers" });
  for (const answer of answers) {
    const item = el("div", {
      className: `free-answer ${answer.correct ? "free-correct" : answer.incorrect ? "free-incorrect" : ""}`
    });
    item.appendChild(el("p", { className: "free-label", textContent: "Réponse saisie" }));
    item.appendChild(el("p", { className: "free-user", textContent: answer.userAnswer || "—" }));
    if (answer.expectedAnswer) {
      item.appendChild(el("p", { className: "free-label", textContent: "Réponse attendue" }));
      item.appendChild(el("p", { className: "free-expected", textContent: answer.expectedAnswer }));
    }
    box.appendChild(item);
  }
  return box;
}

function buildCorrection(text) {
  const details = document.createElement("details");
  details.className = "correction";
  details.appendChild(el("summary", { textContent: "Correction" }));
  details.appendChild(el("p", { className: "correction-text", textContent: text }));
  return details;
}

// ── ACTIONS (rename / chapter / add image / delete) ─────────────

function buildCardActions(q) {
  const w = el("div", { className: "card-actions" });
  if (!q.id) return w;
  const btns = [
    ["✏️", "btn-rename", "Renommer", e => { e.stopPropagation(); renameQuestion(q); }],
    ["📚", "btn-chapter", "Chapitre", e => { e.stopPropagation(); setChapterForQuestion(q); }],
    ["📷", "btn-add-image", "Ajouter image", e => { e.stopPropagation(); triggerAddImage(q); }],
    ["🗑", "btn-delete", "Supprimer", e => { e.stopPropagation(); deleteQuestion(q); }]
  ];
  for (const [icon, cls, title, handler] of btns) {
    const b = el("button", { className: `btn-icon ${cls}`, type: "button", title, textContent: icon });
    b.addEventListener("click", handler);
    w.appendChild(b);
  }
  return w;
}

function buildSeriesActions(questions) {
  const w = el("div", { className: "card-actions series-actions" });
  const first = questions[0]; if (!first) return w;
  const btns = [
    ["✏️", "btn-rename", "Renommer série", e => { e.stopPropagation(); e.preventDefault(); renameSeries(questions); }],
    ["📚", "btn-chapter", "Chapitre série", e => { e.stopPropagation(); e.preventDefault(); setChapterForSeries(questions); }]
  ];
  for (const [icon, cls, title, handler] of btns) {
    const b = el("button", { className: `btn-icon ${cls}`, type: "button", title, textContent: icon });
    b.addEventListener("click", handler);
    w.appendChild(b);
  }
  return w;
}

// Helpers locaux : écriture directe dans chrome.storage (sans chrome.runtime.sendMessage)
// Push best-effort vers le serveur localhost après chaque modif.
const LOCAL_SERVER_URL = "http://127.0.0.1:8765";

async function pushQuestionToServer(question) {
  try {
    const { needsSync, ...clean } = question;
    const r = await fetch(`${LOCAL_SERVER_URL}/api/captures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clean),
      signal: AbortSignal.timeout(30000)
    });
    return r.ok;
  } catch (_) {
    return false;
  }
}

async function deleteQuestionFromServer(id) {
  try {
    await fetch(`${LOCAL_SERVER_URL}/api/captures/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(30000)
    });
  } catch (_) {}
}

function applyEditableFields(target, fields) {
  const editable = ["customTitle", "chapter"];
  for (const key of editable) {
    if (!(key in fields)) continue;
    const v = fields[key];
    if (typeof v !== "string" || v.trim() === "") {
      delete target[key];
    } else {
      target[key] = v.trim().slice(0, 300);
    }
  }
}

async function patchQuestionsLocal(ids, fields) {
  const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
  const { questions = [] } = await chrome.storage.local.get("questions");
  const targets = questions.filter(q => idSet.has(q.id));
  if (!targets.length) throw new Error("Aucune question correspondante");

  for (const target of targets) {
    applyEditableFields(target, fields);
  }

  await chrome.storage.local.set({ questions });

  // Push best-effort en parallèle
  const results = await Promise.all(targets.map(pushQuestionToServer));
  for (let i = 0; i < targets.length; i++) {
    if (results[i]) delete targets[i].needsSync;
    else targets[i].needsSync = true;
  }
  await chrome.storage.local.set({ questions });
}

async function renameQuestion(q) {
  const v = prompt("Nouveau nom :\n(vide pour retirer)", q.customTitle || "");
  if (v === null) return;
  try { await patchQuestionsLocal(q.id, { customTitle: v }); await loadQuestions(); }
  catch (e) { alert(`Échec : ${e.message || e}`); }
}

async function renameSeries(questions) {
  const first = questions[0];
  const v = prompt(`Nom pour la série (${questions.length} question(s)) :`, first.customTitle || first.seriesTitle || "");
  if (v === null) return;
  try { await patchQuestionsLocal(questions.map(q => q.id), { customTitle: v }); await loadQuestions(); }
  catch (e) { alert(`Échec : ${e.message || e}`); }
}

async function setChapterForQuestion(q) {
  const chs = listChapters();
  const hint = chs.length ? `\n\nExistants : ${chs.slice(0, 8).join(", ")}` : "";
  const v = prompt(`Chapitre :${hint}\n(vide pour retirer)`, q.chapter || "");
  if (v === null) return;
  try { await patchQuestionsLocal(q.id, { chapter: v }); await loadQuestions(); }
  catch (e) { alert(`Échec : ${e.message || e}`); }
}

async function setChapterForSeries(questions) {
  const chs = listChapters();
  const hint = chs.length ? `\n\nExistants : ${chs.slice(0, 8).join(", ")}` : "";
  const v = prompt(`Chapitre pour la série (${questions.length}) :${hint}`, questions[0].chapter || "");
  if (v === null) return;
  try { await patchQuestionsLocal(questions.map(q => q.id), { chapter: v }); await loadQuestions(); }
  catch (e) { alert(`Échec : ${e.message || e}`); }
}

async function deleteQuestion(q) {
  const p = (q.questionText || "").slice(0, 80);
  if (!confirm(`Supprimer ?\n\n"${p}${p.length >= 80 ? "..." : ""}"`)) return;
  try {
    const { questions = [] } = await chrome.storage.local.get("questions");
    const filtered = questions.filter(qq => qq.id !== q.id);
    if (filtered.length === questions.length) throw new Error("Question introuvable");
    await chrome.storage.local.set({ questions: filtered });
    await deleteQuestionFromServer(q.id);
    await loadQuestions();
  } catch (e) { alert(`Échec : ${e.message || e}`); }
}

function triggerAddImage(q) {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*"; input.style.display = "none";
  input.addEventListener("change", async () => {
    const f = input.files?.[0]; document.body.removeChild(input); if (!f) return;
    await uploadImageForQuestion(q, f);
  });
  document.body.appendChild(input); input.click();
}

async function uploadImageForQuestion(q, file) {
  try {
    const dataUrl = await readFileAsDataUrl(file);
    const size = await getImageSize(dataUrl);

    // Écriture directe dans chrome.storage (bypass sendMessage qui plafonne sur gros payloads)
    const { questions = [] } = await chrome.storage.local.get("questions");
    const target = questions.find(qq => qq.id === q.id);
    if (!target) throw new Error("Question introuvable");

    const screenshots = Array.isArray(target.screenshots) ? target.screenshots : [];
    const sid = `manual_${screenshots.length + 1}`;
    const entry = {
      id: sid,
      dataUrl,
      dataUrlStatus: "manual",
      alt: file.name || "Image ajoutée",
      title: file.name || "",
      width: size.width,
      height: size.height,
      section: "screenshot",
      capturedAt: new Date().toISOString()
    };

    target.screenshots = [...screenshots, entry];
    target.images = [...(Array.isArray(target.images) ? target.images : []), entry];

    await chrome.storage.local.set({ questions });

    // Best-effort : pousse aussi vers le serveur localhost si dispo (sync disque)
    try {
      await fetch("http://127.0.0.1:8765/api/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
        signal: AbortSignal.timeout(30000)
      });
      delete target.needsSync;
    } catch (_) {
      target.needsSync = true;
    }
    await chrome.storage.local.set({ questions });

    await loadQuestions();
  } catch (e) {
    alert(`Échec ajout image : ${e.message || e}`);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error("lecture echouee"));
    r.readAsDataURL(file);
  });
}

function getImageSize(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: null, height: null });
    img.src = dataUrl;
  });
}

// ── LIGHTBOX ─────────────────────────────────────────────────────

function openLightbox(src, alt) {
  const lb = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  img.src = src;
  img.alt = alt || "Image";
  lb.classList.add("open");
}

document.getElementById("lightbox").addEventListener("click", () => {
  document.getElementById("lightbox").classList.remove("open");
});

// ── EXPORT ───────────────────────────────────────────────────────

async function doExport(questions, filename) {
  if (!questions.length) {
    alert("Aucune question à exporter.");
    return;
  }

  const blob = new Blob([JSON.stringify(questions, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  const ids = questions.map(q => q.id).filter(Boolean);
  if (ids.length) {
    await chrome.runtime.sendMessage({ type: "MARK_EXPORTED", payload: { ids } });
    await loadQuestions();
  }
}

document.getElementById("exportNewBtn").addEventListener("click", () => {
  const newOnes = allQuestions.filter(q => !q.exportedAt);
  doExport(newOnes, `hypocampus-nouvelles-${dateStamp()}.json`);
});

document.getElementById("exportAllBtn").addEventListener("click", () => {
  doExport(allQuestions, `hypocampus-tout-${dateStamp()}.json`);
});

// ── EVENT WIRING ─────────────────────────────────────────────────

// View mode buttons
document.querySelectorAll(".view-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".view-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.view = btn.dataset.view;
    renderAll();
  });
});

// Filter: status
document.querySelectorAll("#filterStatus .filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    setActiveInGroup("filterStatus", btn);
    state.filterStatus = btn.dataset.filterStatus;
    renderAll();
  });
});

// Filter: answer
document.querySelectorAll("#filterAnswer .filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    setActiveInGroup("filterAnswer", btn);
    state.filterAnswer = btn.dataset.filterAnswer;
    renderAll();
  });
});

// Filter: format
document.querySelectorAll("#filterFormat .filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    setActiveInGroup("filterFormat", btn);
    state.filterFormat = btn.dataset.filterFormat;
    renderAll();
  });
});

// Filter: media
document.querySelectorAll("#filterMedia .filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    setActiveInGroup("filterMedia", btn);
    state.filterMedia = btn.dataset.filterMedia;
    renderAll();
  });
});

// Filter: chapter (dropdown)
document.getElementById("chapterFilter")?.addEventListener("change", renderAll);

function setActiveInGroup(groupId, activeBtn) {
  document.querySelectorAll(`#${groupId} .filter-btn`).forEach(b => b.classList.remove("active"));
  activeBtn.classList.add("active");
}

// Sort
document.getElementById("sortSelect").addEventListener("change", (e) => {
  state.sort = e.target.value;
  renderAll();
});

// Search
document.getElementById("searchInput").addEventListener("input", debounce(() => {
  state.search = document.getElementById("searchInput").value.toLowerCase().trim();
  renderAll();
}, 250));

// ── SUBJECT INFERENCE (kept from original) ──────────────────────

function getSubjectLabel(q) {
  return normalizeSubjectName(q.subject) ||
    inferSubjectFromStoredQuestion(q) ||
    "Matière inconnue";
}

function inferSubjectFromStoredQuestion(q) {
  const context = normalizeSubjectName(q.contextLabel);
  if (context && !isGenericSubjectCandidate(context)) return context;

  return inferSubjectFromText([
    q.seriesTitle, q.vignette, q.questionText, q.correctionText, q.pageTitle, q.url
  ].filter(Boolean).join(" "));
}

function inferSubjectFromText(text) {
  const normalized = normalizeForSearch(text);
  const rules = [
    ["Cardiologie", /\b(cardio|cardiaque|coeur|ecg|electrocardiogramme|infarctus|coronar|angor|mitral|aortique|segment st|insuffisance cardiaque|hta|hypertension arterielle|dyslipidemie)\b/],
    ["Pneumologie", /\b(pneumo|dyspnee|asthme|bpco|pneumopathie|embolie pulmonaire|pleur|bronch|respiratoire)\b/],
    ["Neurologie", /\b(neuro|avc|accident vasculaire cerebral|epilepsie|cephalee|migraine|parkinson|sclerose en plaques|meningite|coma)\b/],
    ["Gastro-entérologie", /\b(gastro|hepat|cirrhose|pancreat|diarrhee|vomissement|rectorragie|melena|colite|crohn|rchu|appendicite)\b/],
    ["Endocrinologie", /\b(endocrino|diabete|thyroide|hyperthyroidie|hypothyroidie|surrenale|cushing|addison|hypercholesterolemie)\b/],
    ["Néphrologie", /\b(nephro|renal|rein|creatinine|proteinurie|hematurie|dialyse|glomerul|insuffisance renale)\b/],
    ["Infectiologie", /\b(infectio|infection|sepsis|antibiotique|fievre|vih|tuberculose|paludisme|meningite infectieuse)\b/],
    ["Hématologie", /\b(hemato|anemie|leucemie|lymphome|myelome|thrombopenie|coagulation|hemophilie)\b/],
    ["Oncologie", /\b(onco|cancer|tumeur|metastase|chimiotherapie|radiotherapie|carcinome|sarcome)\b/],
    ["Rhumatologie", /\b(rhumato|arthrite|polyarthrite|lupus|spondylarthrite|goutte|osteoporose|myosite)\b/],
    ["Dermatologie", /\b(dermato|eruption|eczema|psoriasis|melanome|urticaire|pemphigus|purpura)\b/],
    ["Gynécologie", /\b(gyneco|grossesse|enceinte|uterus|ovaire|endometriose|contraception|menopause)\b/],
    ["Pédiatrie", /\b(pediatr|nourrisson|enfant|neonat|puberte|vaccination)\b/],
    ["Psychiatrie", /\b(psychiatr|depression|bipolaire|schizophrenie|anxieux|suicide|addiction|alcool)\b/],
    ["Ophtalmologie", /\b(ophtalmo|oeil|retine|glaucome|cataracte|uveite|diplopie)\b/],
    ["ORL", /\b(orl|otite|surdit|vertige|sinusite|larynx|pharynx|amygdale)\b/],
    ["Urologie", /\b(urologie|prostate|testicule|hematurie|colique nephretique|infection urinaire|retention urinaire)\b/],
    ["Réanimation", /\b(reanimation|choc|detresse vitale|ventilation|intubation|soins intensifs)\b/],
    ["Urgences", /\b(urgence|smur|samu|douleur thoracique|traumatisme|polytraumatisme)\b/],
    ["Santé publique", /\b(sante publique|epidemiologie|prevention|depistage|statistique|essai clinique)\b/]
  ];
  const match = rules.find(([, pattern]) => pattern.test(normalized));
  return match ? match[0] : null;
}

function normalizeSubjectName(value) {
  if (!value || typeof value !== "string") return null;
  return value.replace(/\s+/g, " ").trim() || null;
}

function normalizedFormat(q) {
  return ["QI", "KFP", "DP", "DP_or_KFP"].includes(q.format) ? q.format : "QI";
}

function isGenericSubjectCandidate(text) {
  const normalized = normalizeForSearch(text);
  return !normalized ||
    normalized === "hypocampus" ||
    /^session\b/.test(normalized) ||
    /^question\s+\d+$/.test(normalized) ||
    /^rang\s+[abc]$/.test(normalized) ||
    /^qi\s+\d+/.test(normalized) ||
    /^m?dp\d*/.test(normalized) ||
    /^kfp\d*/.test(normalized);
}

// ── UTILS ────────────────────────────────────────────────────────

function el(tag, props = {}) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  return e;
}

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function normalizeForSearch(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// ── INIT ─────────────────────────────────────────────────────────

loadQuestions();
