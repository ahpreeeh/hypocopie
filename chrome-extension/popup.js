async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("Aucun onglet actif.");
  return tab;
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

async function refreshCount() {
  const response = await chrome.runtime.sendMessage({ type: "GET_COUNT" });
  const count = response?.result?.count ?? 0;
  const newCount = response?.result?.newCount ?? 0;
  const pendingCount = response?.result?.pendingCount ?? 0;

  document.getElementById("count").textContent = String(count);
  const newBadge = document.getElementById("newCount");
  newBadge.textContent = newCount > 0 ? `${newCount} nouvelle${newCount > 1 ? "s" : ""}` : "";
  newBadge.style.display = newCount > 0 ? "inline" : "none";

  const pendingBadge = document.getElementById("pendingCount");
  if (pendingBadge) {
    pendingBadge.textContent = pendingCount > 0 ? `${pendingCount} en attente sync` : "";
    pendingBadge.style.display = pendingCount > 0 ? "inline" : "none";
  }
}

async function refreshServerStatus() {
  const dot = document.getElementById("serverDot");
  const label = document.getElementById("serverLabel");
  if (!dot || !label) return;

  label.textContent = "Serveur local : test...";
  dot.className = "server-dot server-dot-unknown";

  const response = await chrome.runtime.sendMessage({ type: "PING_SERVER" });
  const result = response?.result;

  if (result?.connected) {
    dot.className = "server-dot server-dot-up";
    const captures = result.captures ?? "?";
    label.textContent = `Serveur local : connecté (${captures} sur disque)`;
    chrome.runtime.sendMessage({ type: "FLUSH_QUEUE" })
      .then(() => refreshCount())
      .catch(() => {});
  } else {
    dot.className = "server-dot server-dot-down";
    label.textContent = "Serveur local : déconnecté (lance start-server.bat)";
  }
}

function openLocalSite() {
  chrome.tabs.create({ url: "http://127.0.0.1:8765" });
}

async function runMigration() {
  const ok = confirm("Migrer toutes les questions de Chrome vers le disque local ?\nLe serveur doit être lancé. Les questions transférées avec succès seront retirées de Chrome.");
  if (!ok) return;

  setStatus("Migration en cours...");
  const response = await chrome.runtime.sendMessage({ type: "MIGRATE_ALL" });
  const result = response?.result;

  if (!result) {
    setStatus("Migration échouée (réponse vide).");
    return;
  }

  await refreshCount();
  await refreshServerStatus();

  const regenSuffix = result.regenerated ? ` | ${result.regenerated} ID régénéré(s)` : "";

  if (result.failed > 0) {
    const summary = (result.failures || [])
      .slice(0, 5)
      .map(f => `${f.id?.slice(0, 8) || "?"} (${f.sizeKB || "?"}KB) : ${f.reason || "?"}`)
      .join("\n");
    setStatus(`Migré : ${result.migrated} | Échecs : ${result.failed}${regenSuffix}`);
    console.warn("[Hypocampus] Détail des échecs migration :", result.failures);
    if (summary) alert(`Échecs migration (${result.failed}) :\n\n${summary}\n\n(détail complet dans la console DevTools du popup)`);
  } else {
    setStatus(`Migration OK : ${result.migrated} question(s) sur disque, Chrome vidé.${regenSuffix}`);
  }
}

async function injectExtractor(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["extractor.js"]
  });
}

async function captureCurrentPage() {
  try {
    const tab = await getActiveTab();

    await injectExtractor(tab.id);

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => window.HypocampusExtractor.capture()
    });

    const response = await chrome.runtime.sendMessage({
      type: "SAVE_QUESTION",
      payload: result
    });

    await refreshCount();

    if (response?.result?.saved) {
      setStatus(buildSavedStatus(response.result.imageSummary));
    } else {
      setStatus(response?.result?.reason || "Question corrigée non détectée.");
    }
  } catch (error) {
    setStatus(`Erreur : ${error.message || error}`);
  }
}

function buildSavedStatus(imageSummary) {
  if (!imageSummary?.total) return "Question enregistrée.";
  if (!imageSummary.missing) {
    return `Question enregistrée. ${imageSummary.embedded}/${imageSummary.total} image(s) intégrée(s).`;
  }

  return `Question enregistrée, mais ${imageSummary.missing}/${imageSummary.total} image(s) non intégrée(s). Affiche l'image entière pour une capture écran.`;
}

async function captureVisibleScreenshot() {
  try {
    const tab = await getActiveTab();
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const size = await getImageSize(dataUrl);

    const response = await chrome.runtime.sendMessage({
      type: "ADD_VISIBLE_SCREENSHOT",
      payload: {
        dataUrl,
        title: "Capture écran visible",
        width: size.width,
        height: size.height
      }
    });

    if (response?.result?.attached) {
      await refreshCount();
      setStatus("Capture écran attachée à la dernière question.");
    } else {
      setStatus(response?.result?.reason || "Impossible d'attacher la capture écran.");
    }
  } catch (error) {
    setStatus(`Erreur capture écran : ${error.message || error}`);
  }
}

function getImageSize(dataUrl) {
  return new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: null, height: null });
    image.src = dataUrl;
  });
}

async function startSession() {
  try {
    const tab = await getActiveTab();

    await injectExtractor(tab.id);

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });

    setStatus("Session active sur cet onglet.");
  } catch (error) {
    setStatus(`Erreur : ${error.message || error}`);
  }
}

async function stopSession() {
  try {
    const tab = await getActiveTab();

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        window.__hypocampusCaptureSessionActive = false;

        if (window.__hypocampusCaptureObserver) {
          window.__hypocampusCaptureObserver.disconnect();
          window.__hypocampusCaptureObserver = null;
        }
      }
    });

    setStatus("Session désactivée.");
  } catch (error) {
    setStatus(`Erreur : ${error.message || error}`);
  }
}

async function exportAll() {
  const response = await chrome.runtime.sendMessage({ type: "GET_QUESTIONS" });
  const questions = response?.result?.questions || [];

  if (!questions.length) {
    setStatus("Aucune question à exporter.");
    return;
  }

  await downloadTextFile(
    JSON.stringify(questions, null, 2),
    "hypocampus-tout.json",
    "application/json"
  );

  const ids = questions.map(q => q.id).filter(Boolean);
  await chrome.runtime.sendMessage({ type: "MARK_EXPORTED", payload: { ids } });
  await refreshCount();
  setStatus(`Export : ${questions.length} question(s).`);
}

async function exportNew() {
  const response = await chrome.runtime.sendMessage({ type: "GET_QUESTIONS" });
  const questions = response?.result?.questions || [];
  const newOnes = questions.filter(q => !q.exportedAt);

  if (!newOnes.length) {
    setStatus("Aucune nouvelle question à exporter.");
    return;
  }

  await downloadTextFile(
    JSON.stringify(newOnes, null, 2),
    "hypocampus-nouvelles.json",
    "application/json"
  );

  const ids = newOnes.map(q => q.id).filter(Boolean);
  await chrome.runtime.sendMessage({ type: "MARK_EXPORTED", payload: { ids } });
  await refreshCount();
  setStatus(`✓ ${newOnes.length} nouvelle(s) exportée(s).`);
}

async function exportCsv() {
  const response = await chrome.runtime.sendMessage({ type: "GET_QUESTIONS" });
  const questions = response?.result?.questions || [];

  if (!questions.length) {
    setStatus("Aucune question à exporter.");
    return;
  }

  await downloadTextFile(toCsv(questions), "hypocampus-questions.csv", "text/csv");

  const ids = questions.map(q => q.id).filter(Boolean);
  await chrome.runtime.sendMessage({ type: "MARK_EXPORTED", payload: { ids } });
  await refreshCount();
  setStatus("Export CSV lancé.");
}

async function clearQuestions() {
  const ok = confirm("Effacer toutes les questions locales ?");
  if (!ok) return;

  await chrome.storage.local.set({ questions: [] });
  await refreshCount();
  setStatus("Questions effacées.");
}

function openReview() {
  chrome.tabs.create({ url: chrome.runtime.getURL("review.html") });
}

async function downloadTextFile(content, filename, mimeType) {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));

  await chrome.downloads.download({
    url,
    filename,
    saveAs: true
  });

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toCsv(rows) {
  const headers = [
    "source", "capturedAt", "url", "pageTitle", "contextLabel", "subject", "subjectSource",
    "format", "seriesId", "seriesPosition", "seriesTotal", "vignette",
    "status", "score", "questionText", "selectedAnswers",
    "correctAnswers", "freeAnswers", "correctionText", "images", "options", "confidence"
  ];

  const escape = value => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    return `"${str.replaceAll('"', '""')}"`;
  };

  return [
    headers.join(","),
    ...rows.map(row => headers.map(header => {
      if (header === "score") return escape(row.score?.raw || "");
      if (["selectedAnswers", "correctAnswers", "freeAnswers", "images", "options"].includes(header)) {
        return escape(JSON.stringify(row[header] || []));
      }
      return escape(row[header]);
    }).join(","))
  ].join("\n");
}

document.getElementById("capture").addEventListener("click", captureCurrentPage);
document.getElementById("screenshot").addEventListener("click", captureVisibleScreenshot);
document.getElementById("start").addEventListener("click", startSession);
document.getElementById("stop").addEventListener("click", stopSession);
document.getElementById("exportNew").addEventListener("click", exportNew);
document.getElementById("exportAll").addEventListener("click", exportAll);
document.getElementById("exportCsv").addEventListener("click", exportCsv);
document.getElementById("clear").addEventListener("click", clearQuestions);
document.getElementById("review").addEventListener("click", openReview);
document.getElementById("openSite").addEventListener("click", openLocalSite);
document.getElementById("migrate").addEventListener("click", runMigration);

refreshCount();
refreshServerStatus();
