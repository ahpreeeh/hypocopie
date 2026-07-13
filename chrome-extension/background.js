const LOCAL_SERVER = "http://127.0.0.1:8765";
const PUSH_TIMEOUT_MS = 30000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(result => sendResponse({ ok: true, result }))
    .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));

  return true;
});

async function handleMessage(message) {
  if (!message || typeof message.type !== "string") return null;

  if (message.type === "SAVE_QUESTION") {
    return saveQuestion(message.payload);
  }

  if (message.type === "GET_COUNT") {
    const { questions = [] } = await chrome.storage.local.get("questions");
    const newCount = questions.filter(q => !q.exportedAt).length;
    const pendingCount = questions.filter(q => q.needsSync).length;
    return { count: questions.length, newCount, pendingCount };
  }

  if (message.type === "GET_QUESTIONS") {
    const { questions = [] } = await chrome.storage.local.get("questions");
    return { questions };
  }

  if (message.type === "MARK_EXPORTED") {
    return markExported(message.payload?.ids || []);
  }

  if (message.type === "ADD_VISIBLE_SCREENSHOT") {
    return addVisibleScreenshot(message.payload);
  }

  if (message.type === "PING_SERVER") {
    return pingServer();
  }

  if (message.type === "FLUSH_QUEUE") {
    return flushQueue();
  }

  if (message.type === "MIGRATE_ALL") {
    return migrateAll();
  }

  if (message.type === "DELETE_IMAGE") {
    return deleteImage(message.payload);
  }

  if (message.type === "PATCH_QUESTION") {
    return patchQuestion(message.payload);
  }

  if (message.type === "DELETE_QUESTION") {
    return deleteQuestionLocal(message.payload);
  }

  if (message.type === "ADD_IMAGE_TO_QUESTION") {
    return addImageToQuestion(message.payload);
  }

  return null;
}

async function patchQuestion(payload) {
  const id = payload?.id;
  const fields = payload?.fields || {};
  if (!id) return { patched: false, reason: "id requis" };

  const editable = ["customTitle", "chapter"];
  const { questions = [] } = await chrome.storage.local.get("questions");
  const target = questions.find(q => q.id === id);
  if (!target) return { patched: false, reason: "Question introuvable" };

  for (const key of editable) {
    if (!(key in fields)) continue;
    const v = fields[key];
    if (v === null || v === "" || typeof v !== "string") {
      delete target[key];
    } else {
      target[key] = v.trim().slice(0, 300) || undefined;
      if (!target[key]) delete target[key];
    }
  }

  const pushResult = await pushToServer(stripSyncFlag(target));
  if (!pushResult.ok) target.needsSync = true;
  else delete target.needsSync;

  await chrome.storage.local.set({ questions });
  return { patched: true, id };
}

async function deleteQuestionLocal(payload) {
  const id = payload?.id;
  if (!id) return { deleted: false, reason: "id requis" };

  const { questions = [] } = await chrome.storage.local.get("questions");
  const before = questions.length;
  const filtered = questions.filter(q => q.id !== id);
  if (filtered.length === before) return { deleted: false, reason: "Question introuvable" };

  await chrome.storage.local.set({ questions: filtered });

  // Best-effort : suppression aussi côté serveur
  try {
    await fetch(`${LOCAL_SERVER}/api/captures/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS)
    });
  } catch (_) {}

  return { deleted: true, id };
}

async function addImageToQuestion(payload) {
  const questionId = payload?.questionId;
  const dataUrl = safeDataUrl(payload?.dataUrl);
  if (!questionId || !dataUrl) return { added: false, reason: "questionId et dataUrl requis" };

  const { questions = [] } = await chrome.storage.local.get("questions");
  const target = questions.find(q => q.id === questionId);
  if (!target) return { added: false, reason: "Question introuvable" };

  const screenshots = Array.isArray(target.screenshots) ? target.screenshots : [];
  const sid = `manual_${screenshots.length + 1}`;
  const entry = {
    id: sid,
    dataUrl,
    dataUrlStatus: "manual",
    alt: safeString(payload?.alt, 500) || "Image ajoutee manuellement",
    title: safeString(payload?.title, 500),
    width: safeNumber(payload?.width),
    height: safeNumber(payload?.height),
    section: "screenshot",
    capturedAt: new Date().toISOString()
  };

  target.screenshots = [...screenshots, entry];
  target.images = [...(Array.isArray(target.images) ? target.images : []), entry];

  const pushResult = await pushToServer(stripSyncFlag(target));
  if (!pushResult.ok) target.needsSync = true;
  else delete target.needsSync;

  await chrome.storage.local.set({ questions });
  return { added: true, imageId: sid, screenshotCount: target.screenshots.length };
}

async function deleteImage(payload) {
  const questionId = payload?.questionId;
  const imageId = payload?.imageId;
  if (!questionId || !imageId) return { deleted: false, reason: "questionId et imageId requis" };

  const { questions = [] } = await chrome.storage.local.get("questions");
  const target = questions.find(q => q.id === questionId);
  if (!target) return { deleted: false, reason: "Question introuvable" };

  const beforeImgs = Array.isArray(target.images) ? target.images.length : 0;
  const beforeShots = Array.isArray(target.screenshots) ? target.screenshots.length : 0;

  if (Array.isArray(target.images)) target.images = target.images.filter(i => i?.id !== imageId);
  if (Array.isArray(target.screenshots)) target.screenshots = target.screenshots.filter(i => i?.id !== imageId);

  const removed = (beforeImgs - (target.images?.length || 0)) + (beforeShots - (target.screenshots?.length || 0));
  if (removed === 0) return { deleted: false, reason: `Image '${imageId}' non trouvée` };

  // Re-pousse au serveur localhost si dispo (pour synchro), sinon flag needsSync
  const pushResult = await pushToServer(stripSyncFlag(target));
  if (!pushResult.ok) {
    target.needsSync = true;
  } else {
    delete target.needsSync;
  }

  await chrome.storage.local.set({ questions });
  return { deleted: true, imageId, removed };
}

async function pingServer() {
  try {
    const response = await fetch(`${LOCAL_SERVER}/api/health`, {
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS)
    });
    if (!response.ok) return { connected: false, error: `HTTP ${response.status}` };
    const data = await response.json();
    return { connected: true, captures: data?.captures ?? null };
  } catch (error) {
    return { connected: false, error: String(error?.message || error) };
  }
}

async function pushToServer(question) {
  try {
    const body = JSON.stringify(question);
    const response = await fetch(`${LOCAL_SERVER}/api/captures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS)
    });
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.text()).slice(0, 200); } catch (_) {}
      console.warn(`[Hypocampus] push failed id=${question?.id} HTTP ${response.status} size=${body.length}B detail=${detail}`);
      return { ok: false, reason: `HTTP ${response.status}: ${detail || "(vide)"}` };
    }
    return { ok: true };
  } catch (error) {
    const reason = String(error?.name === "TimeoutError" ? `timeout >${PUSH_TIMEOUT_MS}ms` : error?.message || error);
    console.warn(`[Hypocampus] push exception id=${question?.id} reason=${reason}`);
    return { ok: false, reason };
  }
}

async function flushQueue() {
  const { questions = [] } = await chrome.storage.local.get("questions");
  const pending = questions.filter(q => q.needsSync);
  if (!pending.length) return { flushed: 0, remaining: 0, failures: [] };

  // Regenere les IDs invalides avant push
  let regenerated = 0;
  for (const question of pending) {
    if (!isValidId(question.id)) {
      question.id = generateId();
      regenerated++;
    }
  }
  if (regenerated > 0) {
    await chrome.storage.local.set({ questions });
  }

  let flushed = 0;
  const remaining = [];
  const failures = [];

  for (const question of questions) {
    if (!question.needsSync) {
      remaining.push(question);
      continue;
    }
    const result = await pushToServer(stripSyncFlag(question));
    if (result.ok) {
      flushed++;
    } else {
      remaining.push(question);
      failures.push({ id: question.id, reason: result.reason, sizeKB: estimateSizeKB(question) });
    }
  }

  await chrome.storage.local.set({ questions: remaining });
  return { flushed, remaining: remaining.filter(q => q.needsSync).length, failures };
}

async function migrateAll() {
  const { questions = [] } = await chrome.storage.local.get("questions");
  if (!questions.length) return { migrated: 0, failed: 0, failures: [] };

  // Regenere les IDs manquants/invalides (questions legacy)
  let regenerated = 0;
  for (const question of questions) {
    if (!isValidId(question.id)) {
      question.id = generateId();
      regenerated++;
    }
  }
  if (regenerated > 0) {
    await chrome.storage.local.set({ questions });
    console.log(`[Hypocampus] ${regenerated} ID regenere(s) pour questions legacy`);
  }

  let migrated = 0;
  const stillFailed = [];
  const failures = [];

  for (const question of questions) {
    const result = await pushToServer(stripSyncFlag(question));
    if (result.ok) {
      migrated++;
    } else {
      const flagged = { ...question, needsSync: true };
      stillFailed.push(flagged);
      failures.push({ id: question.id, reason: result.reason, sizeKB: estimateSizeKB(question) });
    }
  }

  await chrome.storage.local.set({ questions: stillFailed });
  if (failures.length) {
    console.warn(`[Hypocampus] ${failures.length} echec(s) migration :`, failures);
  }
  return { migrated, failed: stillFailed.length, failures, regenerated };
}

function isValidId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_\-]{1,80}$/.test(id);
}

function estimateSizeKB(question) {
  try {
    return Math.round(JSON.stringify(question).length / 1024);
  } catch (_) {
    return null;
  }
}

function stripSyncFlag(question) {
  const { needsSync, ...rest } = question;
  return rest;
}

async function saveQuestion(capture) {
  const cleaned = await cleanQuestion(capture);
  if (!cleaned) return { saved: false, reason: "Question ou correction non détectée." };

  const { questions = [] } = await chrome.storage.local.get("questions");
  const signature = buildSignature(cleaned);
  const alreadyExists = questions.some(existing => buildSignature(existing) === signature);

  if (alreadyExists) {
    return { saved: false, reason: "Doublon ignoré.", count: questions.length };
  }

  cleaned.id = generateId();

  const pushResult = await pushToServer(cleaned);
  const stored = pushResult.ok ? cleaned : { ...cleaned, needsSync: true };

  questions.push(stored);
  await chrome.storage.local.set({ questions, lastQuestionId: cleaned.id });

  // Best-effort : si serveur up, on tente aussi de flusher d'anciennes en attente.
  if (pushResult.ok) {
    flushQueue().catch(() => {});
  }

  return {
    saved: true,
    count: questions.length,
    questionId: cleaned.id,
    imageSummary: summarizeImages(cleaned.images),
    pushed: pushResult.ok,
    pushReason: pushResult.reason || null
  };
}

async function addVisibleScreenshot(payload) {
  const dataUrl = safeDataUrl(payload?.dataUrl);
  if (!dataUrl) return { attached: false, reason: "Capture ecran non valide." };

  const { questions = [], lastQuestionId = null } = await chrome.storage.local.get([
    "questions",
    "lastQuestionId"
  ]);

  if (!questions.length) {
    return { attached: false, reason: "Aucune question locale a completer." };
  }

  let index = questions.findIndex(question => question.id === lastQuestionId);
  if (index < 0) index = questions.length - 1;

  const target = questions[index];
  const screenshots = Array.isArray(target.screenshots) ? target.screenshots : [];
  const id = `screenshot_${screenshots.length + 1}`;

  const screenshot = {
    id,
    dataUrl,
    dataUrlStatus: "screenshot",
    alt: "Capture ecran visible",
    title: safeString(payload?.title, 500),
    width: safeNumber(payload?.width),
    height: safeNumber(payload?.height),
    section: "screenshot",
    capturedAt: new Date().toISOString()
  };

  target.screenshots = [...screenshots, screenshot];
  target.images = [...(Array.isArray(target.images) ? target.images : []), screenshot];
  delete target.exportedAt;

  // Re-pousse la question modifiee au serveur ; si echec, marque needsSync.
  const pushResult = await pushToServer(stripSyncFlag(target));
  if (!pushResult.ok) {
    target.needsSync = true;
  } else {
    delete target.needsSync;
  }

  await chrome.storage.local.set({ questions });

  return {
    attached: true,
    questionId: target.id,
    screenshotCount: target.screenshots.length,
    pushed: pushResult.ok,
    pushReason: pushResult.reason || null
  };
}

async function markExported(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { marked: 0 };

  const { questions = [] } = await chrome.storage.local.get("questions");
  const idSet = new Set(ids);
  const now = new Date().toISOString();
  let marked = 0;

  for (const q of questions) {
    if (idSet.has(q.id) && !q.exportedAt) {
      q.exportedAt = now;
      marked++;
    }
  }

  await chrome.storage.local.set({ questions });
  return { marked };
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function buildSignature(question) {
  return [
    question.format || "",
    question.subject || "",
    question.seriesId || "",
    question.seriesPosition ?? "",
    question.url || "",
    question.vignette || "",
    question.questionText || "",
    question.correctionText || "",
    (question.correctAnswers || []).join("||"),
    (question.selectedAnswers || []).join("||"),
    (question.freeAnswers || []).map(answer => `${answer.userAnswer || ""}->${answer.expectedAnswer || ""}`).join("||")
  ].join("|");
}

async function cleanQuestion(capture) {
  if (!capture || typeof capture !== "object") return null;
  if (!capture.questionText || !capture.hasCorrection) return null;
  if (capture.status === "correct") return null;

  return {
    source: "hypocampus-visible-question",
    capturedAt: safeString(capture.capturedAt, 40) || new Date().toISOString(),
    url: safeString(capture.url, 500),
    pageTitle: safeString(capture.pageTitle, 160),
    contextLabel: safeString(capture.contextLabel, 160),
    subject: safeString(capture.subject, 120),
    subjectSource: safeString(capture.subjectSource, 30),
    format: safeFormat(capture.format),
    formatConfidence: safeString(capture.formatConfidence, 20),
    seriesId: safeString(capture.seriesId, 120),
    seriesTitle: safeString(capture.seriesTitle, 160),
    seriesPosition: safeNumber(capture.seriesPosition),
    seriesTotal: safeNumber(capture.seriesTotal),
    absoluteQuestionPosition: safeNumber(capture.absoluteQuestionPosition),
    vignette: safeString(capture.vignette, 10000),
    questionText: safeString(capture.questionText, 6000),
    correctionText: safeString(capture.correctionText, 10000),
    images: await safeImages(capture.images),
    freeAnswers: safeFreeAnswers(capture.freeAnswers),
    selectedAnswers: safeStringArray(capture.selectedAnswers, 1500),
    correctAnswers: safeStringArray(capture.correctAnswers, 1500),
    options: safeOptions(capture.options),
    score: safeScore(capture.score),
    status: safeStatus(capture.status),
    confidence: safeString(capture.confidence, 20)
  };
}

async function safeImages(images) {
  if (!Array.isArray(images)) return [];

  const cleaned = [];

  for (const image of images.slice(0, 30)) {
    const dataUrl = safeDataUrl(image?.dataUrl);
    const status = dataUrl ? "embedded" : safeString(image?.dataUrlStatus, 80) || "not-embedded";

    cleaned.push({
      id: safeString(image?.id, 40),
      dataUrl: dataUrl || null,
      dataUrlStatus: status,
      alt: safeString(image?.alt, 500),
      title: safeString(image?.title, 500),
      width: safeNumber(image?.width),
      height: safeNumber(image?.height),
      section: ["vignette", "question", "option", "correction", "screenshot", "unknown"].includes(image?.section)
        ? image.section
        : "unknown"
    });
  }

  return cleaned;
}

function summarizeImages(images) {
  if (!Array.isArray(images)) return { total: 0, embedded: 0, missing: 0 };

  const total = images.length;
  const embedded = images.filter(image => image.dataUrl).length;

  return {
    total,
    embedded,
    missing: total - embedded
  };
}

function safeOptions(options) {
  if (!Array.isArray(options)) return [];

  return options.slice(0, 30).map(option => ({
    id: safeString(option?.id, 80),
    label: safeString(option?.label, 10),
    text: safeString(option?.text, 3000),
    selected: Boolean(option?.selected),
    correct: Boolean(option?.correct),
    incorrect: Boolean(option?.incorrect),
    explanation: safeString(option?.explanation, 4000)
  })).filter(option => option.text);
}

function safeFreeAnswers(answers) {
  if (!Array.isArray(answers)) return [];

  return answers.slice(0, 20).map(answer => ({
    id: safeString(answer?.id, 80),
    userAnswer: safeString(answer?.userAnswer, 3000),
    expectedAnswer: safeString(answer?.expectedAnswer, 3000),
    correct: Boolean(answer?.correct),
    incorrect: Boolean(answer?.incorrect)
  })).filter(answer => answer.userAnswer || answer.expectedAnswer);
}

function safeScore(score) {
  if (!score || typeof score !== "object") return null;

  return {
    raw: safeString(score.raw, 30),
    value: safeNumber(score.value),
    max: safeNumber(score.max)
  };
}

function safeStringArray(value, maxItemLength) {
  if (!Array.isArray(value)) return [];
  return value.map(item => safeString(item, maxItemLength)).filter(Boolean);
}

function safeStatus(status) {
  return ["wrong", "partial", "correct", "unknown", "unanswered"].includes(status) ? status : "unknown";
}

function safeFormat(format) {
  return ["QI", "KFP", "DP", "DP_or_KFP"].includes(format) ? format : "QI";
}

function safeString(value, maxLength) {
  if (typeof value !== "string") return null;
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength) || null;
}

function safeDataUrl(value) {
  if (typeof value !== "string") return null;
  if (!value.startsWith("data:image/")) return null;
  return value;
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
