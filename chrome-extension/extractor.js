(() => {
  if (window.HypocampusExtractor) return;

  window.HypocampusExtractor = {
    capture: captureVisibleQuestion
  };

  window.StudyPerfExtractor = window.HypocampusExtractor;

  async function captureVisibleQuestion() {
    const root = document.querySelector("#currentQuestion") || document.body;
    const vignetteEl = root.querySelector(".cortexio-questiongroup-text");
    const questionEl = root.querySelector(".cortexio-question-text");
    const correctionRoot = root.querySelector(".cortexio-question-answer");
    const correctionContent = correctionRoot?.querySelector(".v-html-content") || correctionRoot;

    const vignette = textFrom(vignetteEl);
    const series = extractSeriesInfo(vignette);
    const questionText = textFrom(questionEl);
    const correctionText = textFrom(correctionContent);
    const subjectInfo = extractSubject(root, {
      vignette,
      questionText,
      correctionText,
      seriesTitle: series.seriesTitle
    });
    const options = extractOptions(root);
    const freeAnswers = extractFreeAnswers(root);
    const images = await extractImages(root);
    const selectedOptions = options.filter(option => option.selected);
    const correctOptions = options.filter(option => option.correct);
    const score = extractScore(root);
    const status = inferStatus({ options, selectedOptions, correctOptions, freeAnswers, correctionText, score });

    return {
      source: "hypocampus-visible-question",
      url: location.href,
      pageTitle: document.title || null,
      contextLabel: extractContextLabel(),
      subject: subjectInfo.label,
      subjectSource: subjectInfo.source,
      capturedAt: new Date().toISOString(),
      format: series.format,
      formatConfidence: series.formatConfidence,
      seriesId: series.seriesId,
      seriesTitle: series.seriesTitle,
      seriesPosition: series.seriesPosition,
      seriesTotal: series.seriesTotal,
      absoluteQuestionPosition: series.absoluteQuestionPosition,
      vignette,
      questionText,
      correctionText,
      images,
      options,
      freeAnswers,
      selectedAnswers: selectedOptions.map(option => option.text),
      correctAnswers: correctOptions.map(option => option.text),
      score,
      status,
      hasCorrection: Boolean(correctionText || correctOptions.length || freeAnswers.length),
      confidence: estimateConfidence(questionText, correctionText, options)
    };
  }

  function extractOptions(root) {
    return Array.from(root.querySelectorAll("label[for^='answer_'], label[for^='mcq_answer_']"))
      .map((label, index) => {
        const answerTextEl = label.querySelector(".v-html-content.break-words, .v-html-content.ml-2, .v-html-content");
        const text = textFrom(answerTextEl);
        if (!text) return null;

        const className = String(label.className || "");
        const selectedIcon = label.querySelector("[data-icon='circle-check'], [data-icon='circle-xmark']");
        const input = label.querySelector("input");
        const explanation = textFrom(label.querySelector("[showexplanation='true'] .v-html-content, [answeriscorrect] .v-html-content"));

        return {
          id: label.getAttribute("for") || input?.id || `answer_${index + 1}`,
          label: String.fromCharCode(65 + index),
          text,
          selected: Boolean(selectedIcon || input?.checked || className.includes("border-border-primary")),
          correct: /\bborder-correct\b/.test(className),
          incorrect: /\bborder-incorrect\b/.test(className),
          explanation
        };
      })
      .filter(Boolean);
  }

  function extractFreeAnswers(root) {
    return Array.from(root.querySelectorAll(".border-correct, .border-incorrect"))
      .filter(element => !element.matches("label") && !element.closest("label"))
      .map((element, index) => {
        const className = String(element.className || "");
        const userAnswer = textFrom(element.querySelector(".v-html-content.ml-2, .v-html-content"));
        if (!userAnswer) return null;

        const expectedElement = findExpectedFreeAnswerElement(element);
        const expectedAnswer = textFrom(expectedElement);

        return {
          id: `free_answer_${index + 1}`,
          userAnswer,
          expectedAnswer,
          correct: /\bborder-correct\b/.test(className),
          incorrect: /\bborder-incorrect\b/.test(className)
        };
      })
      .filter(Boolean);
  }

  function findExpectedFreeAnswerElement(answerElement) {
    let sibling = answerElement.nextElementSibling;

    while (sibling) {
      if (sibling.matches?.(".v-html-content")) return sibling;
      const nested = sibling.querySelector?.(".v-html-content");
      if (nested) return nested;
      sibling = sibling.nextElementSibling;
    }

    return null;
  }

  function extractSeriesInfo(vignette) {
    if (!vignette) {
      return {
        format: "QI",
        formatConfidence: "high",
        seriesId: null,
        seriesTitle: null,
        seriesPosition: null,
        seriesTotal: null,
        absoluteQuestionPosition: null
      };
    }

    const buttons = Array.from(document.querySelectorAll(".js-menu-question-link[data-question-position]"));
    const entries = buttons.map(button => {
      const text = textFrom(button) || "";
      const questionMatch = text.match(/question\s+(\d+)/i);
      const className = String(button.className || "");

      return {
        element: button,
        questionNumber: questionMatch ? Number(questionMatch[1]) : null,
        absolutePosition: Number(button.getAttribute("data-question-position")),
        active: className.includes("bg-blue-600/20")
      };
    });

    const active = entries.find(entry => entry.active) || null;
    const questionNumbers = entries.map(entry => entry.questionNumber).filter(Number.isFinite);
    const absolutePositions = entries.map(entry => entry.absolutePosition).filter(Number.isFinite);
    const seriesTotal = questionNumbers.length ? Math.max(...questionNumbers) : null;
    const seriesPosition = active?.questionNumber || null;
    const absoluteQuestionPosition = active?.absolutePosition ?? null;
    const seriesTitle = extractSeriesTitle(buttons);
    const formatInfo = inferFormat({ vignette, seriesTitle, seriesTotal });
    const hasStableSeriesSignal = Boolean(seriesTitle || absolutePositions.length);
    const seed = [
      seriesTitle,
      absolutePositions.length ? `${Math.min(...absolutePositions)}-${Math.max(...absolutePositions)}` : null,
      seriesTotal,
      hasStableSeriesSignal ? null : canonicalizeUrl(location.href),
      hasStableSeriesSignal ? null : normalizeForId(vignette).slice(0, 180)
    ].filter(Boolean).join("|");

    return {
      format: formatInfo.format,
      formatConfidence: formatInfo.confidence,
      seriesId: `series_${hashString(seed)}`,
      seriesTitle,
      seriesPosition,
      seriesTotal,
      absoluteQuestionPosition
    };
  }

  function extractSeriesTitle(buttons) {
    const firstButton = buttons[0];
    if (!firstButton) return null;

    const list = firstButton.closest(".border-b") || firstButton.parentElement?.parentElement;
    const candidate = list?.nextElementSibling;
    const text = textFrom(candidate);
    if (!text) return null;

    return text.split("\n")[0].trim() || null;
  }

  function inferFormat({ vignette, seriesTitle, seriesTotal }) {
    const text = normalizeForId([seriesTitle, vignette, document.title, location.href].filter(Boolean).join(" "));

    if (/\bkfp\b|probleme a element cle|element cle/.test(text)) {
      return { format: "KFP", confidence: "medium" };
    }

    if (/\bdp\b|dossier progressif|\bmdp\b/.test(text)) {
      return { format: "DP", confidence: "medium" };
    }

    if (seriesTotal >= 5) return { format: "DP", confidence: "low" };
    if (seriesTotal && seriesTotal <= 4) return { format: "KFP", confidence: "low" };

    return { format: "DP_or_KFP", confidence: "low" };
  }

  async function extractImages(root) {
    const imageElements = Array.from(root.querySelectorAll("img"))
      .filter(isUsefulImage)
      .slice(0, 20);

    const images = [];

    for (let index = 0; index < imageElements.length; index += 1) {
      const image = imageElements[index];
      const src = image.currentSrc || image.src || image.getAttribute("src") || null;
      if (!src) continue;

      const embedded = await imageToDataUrl(src, image);

      images.push({
        id: `image_${index + 1}`,
        dataUrl: embedded.dataUrl,
        dataUrlStatus: embedded.status,
        alt: normalizeText(image.alt || ""),
        title: normalizeText(image.title || ""),
        width: image.naturalWidth || image.width || null,
        height: image.naturalHeight || image.height || null,
        section: inferImageSection(image, root)
      });
    }

    return images;
  }

  async function imageToDataUrl(src, image) {
    if (src.startsWith("data:")) return { dataUrl: src, status: "embedded" };
    return imageToCanvasDataUrl(image);
  }

  function imageToCanvasDataUrl(image) {
    try {
      const canvas = document.createElement("canvas");
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;

      if (!width || !height) return { dataUrl: null, status: "canvas-empty" };

      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(image, 0, 0);

      return {
        dataUrl: canvas.toDataURL("image/png"),
        status: "embedded"
      };
    } catch (error) {
      return { dataUrl: null, status: "canvas-blocked" };
    }
  }

  function isUsefulImage(image) {
    const src = image.currentSrc || image.src || image.getAttribute("src") || "";
    if (!src) return false;

    const lowerSrc = src.toLowerCase();
    if (lowerSrc.includes("favicon")) return false;
    if (lowerSrc.includes("avatar")) return false;
    if (lowerSrc.endsWith(".svg")) return false;

    const rect = image.getBoundingClientRect();
    const width = image.naturalWidth || image.width || rect.width;
    const height = image.naturalHeight || image.height || rect.height;

    return width >= 40 && height >= 40;
  }

  function inferImageSection(image, root) {
    const correction = image.closest(".cortexio-question-answer");
    if (correction) return "correction";

    const option = image.closest("label[for^='answer_'], label[for^='mcq_answer_']");
    if (option) return "option";

    const vignette = image.closest(".cortexio-questiongroup-text");
    if (vignette) return "vignette";

    const question = image.closest(".cortexio-question-text");
    if (question || root.contains(image)) return "question";

    return "unknown";
  }

  function extractScore(root) {
    const scorePattern = /(\d+(?:[,.]\d+)?)\s*\/\s*(\d+(?:[,.]\d+)?)(?:\s*points?)?/i;
    const candidates = Array.from(root.querySelectorAll("div,span,p"))
      .map(element => normalizeText(element.innerText || element.textContent || ""))
      .filter(Boolean)
      .map(text => {
        const exact = text.match(new RegExp(`^\\s*${scorePattern.source}\\s*$`, "i"));
        if (exact) return { raw: exact[0], match: exact, weight: 0 };

        const embedded = text.match(scorePattern);
        if (!embedded) return null;
        if (text.length > 80) return null;
        return { raw: embedded[0], match: embedded, weight: text.length };
      })
      .filter(Boolean)
      .sort((a, b) => a.weight - b.weight);

    const candidate = candidates[0] || null;
    const raw = candidate?.raw || null;
    if (!raw) return null;
    const match = candidate.match || raw.match(scorePattern);
    if (!match) return { raw };

    return {
      raw,
      value: Number(match[1].replace(",", ".")),
      max: Number(match[2].replace(",", "."))
    };
  }

  function inferStatus({ options, selectedOptions, correctOptions, freeAnswers, correctionText, score }) {
    if (score && Number.isFinite(score.value) && Number.isFinite(score.max)) {
      if (score.max > 0 && score.value >= score.max) return "correct";
      if (score.value > 0) return "partial";
      return "wrong";
    }

    if (freeAnswers.some(answer => answer.incorrect)) return "wrong";
    if (freeAnswers.length && freeAnswers.every(answer => answer.correct)) return "correct";

    if (options.some(option => option.incorrect && option.selected)) return "wrong";

    if (correctionText && correctOptions.length) {
      const selectedIds = selectedOptions.map(option => option.id).sort().join("|");
      const correctIds = correctOptions.map(option => option.id).sort().join("|");
      return selectedIds === correctIds ? "correct" : "wrong";
    }

    return correctionText ? "unknown" : "unanswered";
  }

  function extractContextLabel() {
    const mobileCurrent = normalizeText(document.querySelector(".capitalize")?.innerText || "");
    const title = normalizeText(document.title || "");
    return mobileCurrent || title || null;
  }

  function extractSubject(root, content) {
    const explicit = extractExplicitSubject(root);
    if (explicit) return { label: explicit, source: "dom" };

    const context = extractContextLabel();
    if (context && !isGenericContextLabel(context)) {
      return { label: normalizeSubjectName(context), source: "context" };
    }

    const inferred = inferSubjectFromText([
      content.seriesTitle,
      content.vignette,
      content.questionText,
      content.correctionText,
      document.title,
      location.href
    ].filter(Boolean).join(" "));

    return inferred
      ? { label: inferred, source: "keyword" }
      : { label: null, source: "unknown" };
  }

  function extractExplicitSubject(root) {
    const selectors = [
      "[data-subject]",
      "[data-matiere]",
      "[data-specialty]",
      "[data-specialite]"
    ].join(",");

    const scope = root?.ownerDocument || document;
    const elements = Array.from(scope.querySelectorAll(selectors));

    for (const element of elements) {
      const value = [
        element.getAttribute("data-subject"),
        element.getAttribute("data-matiere"),
        element.getAttribute("data-specialty"),
        element.getAttribute("data-specialite"),
        textFrom(element)
      ].find(Boolean);

      if (value && !isGenericContextLabel(value)) {
        return normalizeSubjectName(value);
      }
    }

    return null;
  }

  function inferSubjectFromText(text) {
    const normalized = normalizeForId(text);
    const rules = [
      ["Cardiologie", /\b(cardio|cardiaque|coeur|ecg|electrocardiogramme|infarctus|coronar|angor|mitral|aortique|segment st|insuffisance cardiaque|hta|hypertension arterielle|dyslipidemie)\b/],
      ["Pneumologie", /\b(pneumo|dyspnee|asthme|bpco|pneumopathie|embolie pulmonaire|pleur|bronch|respiratoire)\b/],
      ["Neurologie", /\b(neuro|avc|accident vasculaire cerebral|epilepsie|cephalee|migraine|parkinson|sclerose en plaques|meningite|coma)\b/],
      ["Gastro-enterologie", /\b(gastro|hepat|cirrhose|pancreat|diarrhee|vomissement|rectorragie|melena|colite|crohn|rchu|appendicite)\b/],
      ["Endocrinologie", /\b(endocrino|diabete|thyroide|hyperthyroidie|hypothyroidie|surrenale|cushing|addison|hypercholesterolemie)\b/],
      ["Nephrologie", /\b(nephro|renal|rein|creatinine|proteinurie|hematurie|dialyse|glomerul|insuffisance renale)\b/],
      ["Infectiologie", /\b(infectio|infection|sepsis|antibiotique|fievre|vih|tuberculose|paludisme|meningite infectieuse)\b/],
      ["Hematologie", /\b(hemato|anemie|leucemie|lymphome|myelome|thrombopenie|coagulation|hemophilie)\b/],
      ["Oncologie", /\b(onco|cancer|tumeur|metastase|chimiotherapie|radiotherapie|carcinome|sarcome)\b/],
      ["Rhumatologie", /\b(rhumato|arthrite|polyarthrite|lupus|spondylarthrite|goutte|osteoporose|myosite)\b/],
      ["Dermatologie", /\b(dermato|eruption|eczema|psoriasis|melanome|urticaire|pemphigus|purpura)\b/],
      ["Gynecologie", /\b(gyneco|grossesse|enceinte|uterus|ovaire|endometriose|contraception|menopause)\b/],
      ["Pediatrie", /\b(pediatr|nourrisson|enfant|neonat|puberte|vaccination)\b/],
      ["Psychiatrie", /\b(psychiatr|depression|bipolaire|schizophrenie|anxieux|suicide|addiction|alcool)\b/],
      ["Ophtalmologie", /\b(ophtalmo|oeil|retine|glaucome|cataracte|uveite|diplopie)\b/],
      ["ORL", /\b(orl|otite|surdit|vertige|sinusite|larynx|pharynx|amygdale)\b/],
      ["Urologie", /\b(urologie|prostate|testicule|hematurie|colique nephretique|infection urinaire|retention urinaire)\b/],
      ["Reanimation", /\b(reanimation|choc|detresse vitale|ventilation|intubation|soins intensifs)\b/],
      ["Urgences", /\b(urgence|smur|samu|douleur thoracique|traumatisme|polytraumatisme)\b/],
      ["Sante publique", /\b(sante publique|epidemiologie|prevention|depistage|statistique|essai clinique)\b/]
    ];

    const match = rules.find(([, pattern]) => pattern.test(normalized));
    return match ? match[0] : null;
  }

  function isGenericContextLabel(text) {
    const normalized = normalizeForId(text);
    return !normalized ||
      normalized === "hypocampus" ||
      /^session\b/.test(normalized) ||
      /^question\s+\d+$/.test(normalized) ||
      /^rang\s+[abc]$/.test(normalized) ||
      /^qi\s+\d+/.test(normalized) ||
      /^m?dp\d*/.test(normalized) ||
      /^kfp\d*/.test(normalized);
  }

  function normalizeSubjectName(text) {
    return normalizeText(String(text || "").replace(/^matiere\s*:\s*/i, "")) || null;
  }

  function estimateConfidence(questionText, correctionText, options) {
    if (questionText && correctionText && options.some(option => option.correct)) return "high";
    if (questionText && (correctionText || options.length)) return "medium";
    return "low";
  }

  function textFrom(element) {
    if (!element) return null;
    return normalizeText(element.innerText || element.textContent || "");
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || null;
  }

  function normalizeForId(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function canonicalizeUrl(value) {
    try {
      const url = new URL(value);
      ["position", "pos", "question", "questionPosition", "currentQuestion"].forEach(key => {
        url.searchParams.delete(key);
      });
      url.hash = url.hash.replace(/(position|pos|question|questionPosition|currentQuestion)=\d+/gi, "$1=");
      return url.href;
    } catch {
      return String(value || "");
    }
  }

  function hashString(value) {
    let hash = 2166136261;
    const text = String(value || "");

    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
  }
})();
