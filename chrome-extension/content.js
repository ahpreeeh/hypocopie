(() => {
  window.__hypocampusCaptureInjected = true;
  window.__hypocampusCaptureSessionActive = true;

  if (window.__hypocampusCaptureObserver) {
    window.__hypocampusCaptureIfRelevant?.();
    return;
  }

  window.__hypocampusCaptureLastSignature ||= "";

  const captureIfRelevant = debounce(async () => {
    if (!window.__hypocampusCaptureSessionActive) return;
    if (!window.HypocampusExtractor) return;
    if (!isExtensionContextValid()) {
      teardown();
      return;
    }

    const capture = await window.HypocampusExtractor.capture();
    if (!looksLikeCorrectedQuestion(capture)) return;

    const signature = [
      capture.url || "",
      capture.pageTitle || "",
      capture.questionText || "",
      capture.correctionText || "",
      (capture.correctAnswers || []).join("||"),
      (capture.selectedAnswers || []).join("||")
    ].join("|");

    if (signature === window.__hypocampusCaptureLastSignature) return;
    window.__hypocampusCaptureLastSignature = signature;

    try {
      await chrome.runtime.sendMessage({
        type: "SAVE_QUESTION",
        payload: capture
      });
    } catch (err) {
      if (!isExtensionContextValid()) {
        teardown();
        return;
      }
      console.warn("[Hypocampus] sendMessage failed:", err);
    }
  }, 1200);

  window.__hypocampusCaptureIfRelevant = captureIfRelevant;
  window.__hypocampusCaptureObserver = new MutationObserver(captureIfRelevant);
  window.__hypocampusCaptureObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  captureIfRelevant();

  function isExtensionContextValid() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch (_) {
      return false;
    }
  }

  function teardown() {
    window.__hypocampusCaptureSessionActive = false;
    try { window.__hypocampusCaptureObserver?.disconnect(); } catch (_) {}
    window.__hypocampusCaptureObserver = null;
  }

  function looksLikeCorrectedQuestion(capture) {
    if (!capture) return false;

    return Boolean(
      capture.questionText &&
      capture.hasCorrection &&
      (capture.status === "wrong" || capture.status === "partial" || capture.status === "unknown")
    );
  }

  function debounce(fn, delay) {
    let timeout = null;

    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        Promise.resolve()
          .then(() => fn(...args))
          .catch(err => {
            const msg = String(err?.message || err || "");
            if (msg.includes("Extension context invalidated") || !isExtensionContextValid()) {
              teardown();
              return;
            }
            console.warn("[Hypocampus] capture error:", err);
          });
      }, delay);
    };
  }
})();
