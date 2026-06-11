import { createContext, useContext, useEffect, useState, useCallback } from 'react';

// ── Types alignés sur ce qu'attendent les pages Gemini ─────────────

export type Format = 'QI' | 'DP' | 'KFP';
export type Status = 'wrong' | 'partial' | 'unknown' | 'correct';

export interface Option {
  id: string;
  text: string;
  isCorrect: boolean;
  isChecked: boolean;
}

export interface FreeAnswer {
  userText: string;
  expectedText: string;
}

export interface Image {
  id: string;
  url: string | null;
  lite?: boolean;
}

export interface SeenAgainEntry {
  at: string;                           // date ISO de la revue
  url: string | null;                   // URL de la session où la question est revenue
  status: Status | null;                // statut de la réponse cette fois-ci
  selectedAnswers: string[];            // ce que l'utilisateur a coché cette fois
  seriesId?: string | null;
  seriesPosition?: number | null;
}

export interface Question {
  id: string;
  format: Format;
  subject: string;
  chapter: string | null;
  customTitle: string | null;
  seriesId: string | null;
  seriesPosition: number | null;
  seriesTotal: number | null;
  vignette: string | null;       // dans une série : vignette de BASE (Q1)
  addedVignette: string | null;  // dans une série : ajout incrémental de cette Q
  questionText: string;
  options: Option[] | null;
  freeAnswers: FreeAnswer[] | null;
  correctionText: string;
  images: Image[];
  status: Status;
  capturedAt: string;
  selectedAnswers: string[];
  seenAgain: SeenAgainEntry[];
}

interface DataContextType {
  questions: Question[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateQuestion: (id: string, updates: Partial<Question>) => Promise<void>;
  deleteQuestion: (id: string) => Promise<void>;
  deleteImage: (questionId: string, imageId: string) => Promise<void>;
  loadFullImages: (questionId: string) => Promise<void>;
}

export const DataContext = createContext<DataContextType | null>(null);

// ── Mapping serveur → format Gemini ────────────────────────────────

function mapServerToGemini(s: any): Question {
  const raw = s.format;
  const format: Format =
    raw === 'QI' || raw === 'DP' || raw === 'KFP'
      ? raw
      : raw === 'DP_or_KFP'
      ? 'DP'
      : 'QI';

  const options: Option[] | null =
    Array.isArray(s.options) && s.options.length > 0
      ? s.options.map((o: any, i: number) => ({
          id: o.id || `opt_${i}`,
          text: o.text || '',
          isCorrect: !!o.correct,
          isChecked: !!o.selected,
        }))
      : null;

  const freeAnswers: FreeAnswer[] | null =
    Array.isArray(s.freeAnswers) && s.freeAnswers.length > 0
      ? s.freeAnswers.map((a: any) => ({
          userText: a.userAnswer || '',
          expectedText: a.expectedAnswer || '',
        }))
      : null;

  const images: Image[] = Array.isArray(s.images)
    ? s.images.map((img: any) => ({
        id: img.id,
        url: img.dataUrl || null,
        lite: !img.dataUrl && (img.lite || img.hasData),
      }))
    : [];

  const status: Status = ['wrong', 'partial', 'unknown', 'correct'].includes(s.status)
    ? s.status
    : 'unknown';

  const seenAgain: SeenAgainEntry[] = Array.isArray(s.seenAgain)
    ? s.seenAgain
        .filter((e: any) => e && typeof e === 'object')
        .map((e: any): SeenAgainEntry => ({
          at: e.at || '',
          url: e.url || null,
          status: ['wrong', 'partial', 'unknown', 'correct'].includes(e.status) ? e.status : null,
          selectedAnswers: Array.isArray(e.selectedAnswers) ? e.selectedAnswers : [],
          seriesId: e.seriesId || null,
          seriesPosition: e.seriesPosition ?? null,
        }))
    : [];

  return {
    id: s.id,
    format,
    subject: s.subject || 'Matière inconnue',
    chapter: s.chapter || null,
    customTitle: s.customTitle || null,
    seriesId: s.seriesId || null,
    seriesPosition: s.seriesPosition ?? null,
    seriesTotal: s.seriesTotal ?? null,
    vignette: s.vignette || null,
    addedVignette: null, // calculé après par computeAddedVignettes
    questionText: s.questionText || '',
    options,
    freeAnswers,
    correctionText: s.correctionText || '',
    images,
    status,
    capturedAt: s.capturedAt || new Date().toISOString(),
    selectedAnswers: Array.isArray(s.selectedAnswers) ? s.selectedAnswers : [],
    seenAgain,
  };
}

// ── DP progressif : calcul incrémental des vignettes ──────────────
//
// Côté serveur, la vignette stockée pour chaque question inclut TOUT
// ce qui a été ajouté jusque-là (Q3.vignette ⊇ Q2.vignette ⊇ Q1.vignette).
// Côté UI Gemini, on veut :
//   - q.vignette       = la base (= vignette de Q1)
//   - q.addedVignette  = uniquement ce qui a été ajouté à cette question
//                        par rapport à la précédente

function computeAddedVignettes(qs: Question[]): Question[] {
  // Regroupe par seriesId
  const groups = new Map<string, Question[]>();
  for (const q of qs) {
    if (!q.seriesId) continue;
    if (!groups.has(q.seriesId)) groups.set(q.seriesId, []);
    groups.get(q.seriesId)!.push(q);
  }

  // Pour chaque série : tri + calcul des diffs + vignette de base partagée
  const baseBySeriesId = new Map<string, string | null>();
  const additionsByQId = new Map<string, string>();

  for (const sQs of groups.values()) {
    const sorted = [...sQs].sort(
      (a, b) => (a.seriesPosition || 0) - (b.seriesPosition || 0)
    );
    let baseVignette: string | null = null;
    let prevCumulative: string | null = null;

    for (const q of sorted) {
      const v = (q.vignette || '').trim();
      if (!v) continue;

      if (baseVignette === null) {
        baseVignette = v;
        prevCumulative = v;
        // addition de Q1 = null (c'est la base)
        continue;
      }

      // Calcul du diff par rapport à la cumulative précédente
      let addition = '';
      if (v.startsWith(prevCumulative!)) {
        addition = v.slice(prevCumulative!.length).trim();
      } else {
        const normPrev = prevCumulative!.replace(/\s+/g, ' ').trim();
        const normCurr = v.replace(/\s+/g, ' ').trim();
        addition = normCurr.startsWith(normPrev)
          ? normCurr.slice(normPrev.length).trim()
          : v; // fallback : vignette complète
      }

      if (addition) additionsByQId.set(q.id, addition);
      prevCumulative = v;
    }

    if (sorted[0]?.seriesId && baseVignette !== null) {
      baseBySeriesId.set(sorted[0].seriesId, baseVignette);
    }
  }

  // Reconstruire : vignette = base de la série / addedVignette = diff calculé
  return qs.map(q => {
    if (q.seriesId && baseBySeriesId.has(q.seriesId)) {
      return {
        ...q,
        vignette: baseBySeriesId.get(q.seriesId) || q.vignette,
        addedVignette: additionsByQId.get(q.id) || null,
      };
    }
    // QI : vignette inchangée, pas d'addedVignette
    return q;
  });
}

// ── Helpers réseau ─────────────────────────────────────────────────

async function fetchJSON(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} ${txt.slice(0, 200)}`);
  }
  return r.json();
}

function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fetch(blobUrl)
      .then(r => r.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error('lecture echouee'));
        reader.readAsDataURL(blob);
      })
      .catch(reject);
  });
}

// ── DataProvider ───────────────────────────────────────────────────

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJSON('/api/captures');
      const mapped = (Array.isArray(data) ? data : []).map(mapServerToGemini);
      setQuestions(computeAddedVignettes(mapped));
      setError(null);
    } catch (e: any) {
      console.error('[Hypocampus] refresh failed:', e);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Charger les images complètes (dataUrl) d'une question (lite → full)
  const loadFullImages = useCallback(async (questionId: string) => {
    try {
      const full = await fetchJSON(`/api/captures/${encodeURIComponent(questionId)}`);
      const mapped = mapServerToGemini(full);
      setQuestions(prev => {
        const next = prev.map(q => (q.id === questionId ? { ...q, images: mapped.images } : q));
        return computeAddedVignettes(next);
      });
    } catch (e) {
      console.error('[Hypocampus] loadFullImages failed:', e);
    }
  }, []);

  // Mise à jour : customTitle et chapter via PATCH ; images blob: → upload screenshot
  const updateQuestion = useCallback(async (id: string, updates: Partial<Question>) => {
    // Optimistic update
    setQuestions(prev => computeAddedVignettes(prev.map(q => (q.id === id ? { ...q, ...updates } : q))));

    const patchFields: Record<string, string> = {};
    if ('customTitle' in updates) patchFields.customTitle = updates.customTitle ?? '';
    if ('chapter' in updates) patchFields.chapter = updates.chapter ?? '';

    if (Object.keys(patchFields).length > 0) {
      try {
        await fetchJSON(`/api/captures/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchFields),
        });
      } catch (e) {
        console.error('[Hypocampus] PATCH failed:', e);
        await refresh();
        return;
      }
    }

    // Upload des nouvelles images (blob:// URLs ou data:// URLs nouvellement ajoutées)
    if (updates.images) {
      const prevQuestion = questions.find(q => q.id === id);
      const prevImageIds = new Set((prevQuestion?.images || []).map(img => img.id));
      const newImages = updates.images.filter(img => !prevImageIds.has(img.id) && img.url);

      let uploaded = false;
      for (const newImg of newImages) {
        if (!newImg.url) continue;
        try {
          const dataUrl = newImg.url.startsWith('blob:')
            ? await blobUrlToDataUrl(newImg.url)
            : newImg.url;
          await fetchJSON(`/api/captures/${encodeURIComponent(id)}/screenshots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dataUrl,
              alt: 'Image ajoutée',
            }),
          });
          uploaded = true;
        } catch (e) {
          console.error('[Hypocampus] Image upload failed:', e);
        }
      }

      if (uploaded) await refresh();
    }
  }, [questions, refresh]);

  const deleteQuestion = useCallback(async (id: string) => {
    // Optimistic
    setQuestions(prev => computeAddedVignettes(prev.filter(q => q.id !== id)));
    try {
      await fetchJSON(`/api/captures/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
      console.error('[Hypocampus] DELETE failed:', e);
      await refresh();
    }
  }, [refresh]);

  const deleteImage = useCallback(async (questionId: string, imageId: string) => {
    setQuestions(prev =>
      computeAddedVignettes(
        prev.map(q =>
          q.id === questionId
            ? { ...q, images: q.images.filter(img => img.id !== imageId) }
            : q
        )
      )
    );
    try {
      await fetchJSON(
        `/api/captures/${encodeURIComponent(questionId)}/images/${encodeURIComponent(imageId)}`,
        { method: 'DELETE' }
      );
    } catch (e) {
      console.error('[Hypocampus] DELETE image failed:', e);
      await refresh();
    }
  }, [refresh]);

  return (
    <DataContext.Provider
      value={{
        questions,
        loading,
        error,
        refresh,
        updateQuestion,
        deleteQuestion,
        deleteImage,
        loadFullImages,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (!context) throw new Error('useData must be used within DataProvider');
  return context;
}
