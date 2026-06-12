import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  GitMerge,
  Loader2,
  Pencil,
  Plus,
  Save,
  ScanText,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components/design-primitives';
import { SegmentedControl } from '../components/ui/segmented-control';

type ImportMode = 'local' | 'qroc' | 'autre';

type DraftSummary = {
  id: string;
  annaleId?: string;
  title: string;
  subject?: string;
  year?: number;
  session?: string;
  profile?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  publishLog?: { annaleId?: string; questions?: number; publishedAt?: string; draftId?: string };
  sourceBlocks: number;
  generatedQuestions: number;
};

type ImportMeta = {
  filename?: string;
  annaleId: string;
  subject: string;
  year: number;
  session: string;
  title: string;
  overwrite: boolean;
  idSuffix?: string;
};

type ImportResult = {
  imported: boolean;
  annale: {
    id: string;
    title: string;
    subject: string;
    year?: number;
    session?: string;
    questionsCount: number;
  };
  redirectTo: string;
  mode?: string;
  pages: number;
  textChars: number;
  warnings?: string[];
  autoRenamed?: boolean;
  originalAnnaleId?: string;
  report?: {
    profile: string;
    questionsDetected: number;
    qiCount: number;
    imagesAttached: number;
    imagesWritten?: number;
    series: Array<{ id: string; format: string; title: string; total: number }>;
    warnings?: string[];
  };
};

type WarningSeverity = 'error' | 'warning' | 'info';
type SourceWarning = { code: string; message: string; blocking?: boolean; accepted?: boolean; severity?: WarningSeverity };
type SourceImage = { id: string; filename: string; page: number; confidence?: string };
type SourceBlock = {
  id: string;
  title: string;
  pages: number[];
  rawText: string;
  cleanText: string;
  ignored?: boolean;
  warningsOverride?: 'accepted' | null;
  images?: SourceImage[];
  warnings?: SourceWarning[];
  stats?: { chars: number; questionMarkers: number; instructionMarkers?: number; answerLines: number };
};

type GeneratedOption = { id: string; text: string; correct: boolean };
type GeneratedQuestion = {
  id: string;
  questionType: 'QRU' | 'QRM' | 'QROC';
  answerSource?: 'source' | 'ai';
  text: string;
  image?: string | null;
  options?: GeneratedOption[];
  expectedAnswer?: string;
  correctionText?: string;
  seriesId?: string | null;
  seriesFormat?: 'DP' | 'KFP' | null;
  seriesPosition?: number | null;
  seriesTotal?: number | null;
  vignette?: string | null;
  customTitle?: string | null;
  sourceRefs?: string[];
  _sourceBlockId?: string;
  warnings?: string[];
};

type QrocDraft = {
  id: string;
  status: string;
  meta: { annaleId: string; title: string; subject: string; year: number; session?: string | null; filename?: string };
  sourceBlocks: SourceBlock[];
  generatedQuestions: GeneratedQuestion[];
  report?: { pages: number; textChars: number; sourceBlocksDetected: number; imagesExtracted: number; blockingWarnings: number };
  generationReport?: { warnings?: string[]; errors?: string[]; infos?: string[] };
};

// Helpers de severite pour les SourceWarnings
function warningSeverity(w: SourceWarning): WarningSeverity {
  if (w.severity) return w.severity;
  return w.blocking ? 'error' : 'warning';
}

type QrocJob = {
  id: string;
  draftId: string;
  status: string;
  progress?: {
    current: number;
    total: number;
    phase: string;
    currentBlockId?: string | null;
    activeBlockIds?: string[];
    blockStates?: Record<string, string>;
  };
  errors?: string[];
  warnings?: string[];
  usage?: unknown[];
  workerConfig?: { jobWorkers?: number; blockWorkers?: number; deepseekMaxConcurrentCalls?: number; skipQa?: boolean };
  createdAt?: string;
  updatedAt?: string;
};

type QrocBatchItem = {
  key: string;
  fileName: string;
  annaleId: string;
  title: string;
  subject: string;
  year: number | null;
  session: string;
  status: 'pending' | 'extracting' | 'blocked' | 'queued' | 'running' | 'done' | 'done-with-errors' | 'error' | 'cancelled' | 'interrupted';
  draftId?: string;
  jobId?: string;
  sourceBlocks?: number;
  generatedQuestions?: number;
  error?: string;
  job?: QrocJob;
};

const inputClass =
  'w-full px-3 py-2 rounded-input border border-input bg-input-background text-sm text-foreground outline-none focus:ring-2 focus:ring-ring focus:border-transparent';

const textAreaClass =
  'w-full min-h-[120px] px-3 py-2 rounded-input border border-input bg-input-background text-sm text-foreground outline-none focus:ring-2 focus:ring-ring focus:border-transparent';

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function inferSession(filename: string): string {
  const lower = filename.toLowerCase();
  const match = lower.match(/\b(s\s*[12]|session[-_ ]?[12]|1ere session|1ère session|2eme session|2ème session)\b/i);
  if (!match) return '';
  const raw = match[0].replace(/[^0-9]/g, '');
  return raw ? `S${raw}` : match[0].toUpperCase();
}

function inferYear(filename: string): number | null {
  const match = filename.match(/\b(20\d{2}|19\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function fileBaseName(file: File): string {
  return file.name.replace(/\.pdf$/i, '').trim();
}

function isTerminalJobStatus(status?: string): boolean {
  return ['done', 'done-with-errors', 'error', 'cancelled', 'interrupted'].includes(status || '');
}

function publishedDraftAnnaleId(draft: DraftSummary): string {
  return draft.publishLog?.annaleId || draft.annaleId || '';
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lecture du PDF impossible'));
    reader.onload = () => {
      const value = String(reader.result || '');
      resolve(value.includes(',') ? value.split(',', 2)[1] : value);
    };
    reader.readAsDataURL(file);
  });
}

function nextOptionId(options: GeneratedOption[] = []) {
  const ids = 'ABCDEFGHIJKLMNO'.split('');
  return ids.find((id) => !options.some((o) => o.id === id)) || `O${options.length + 1}`;
}

export function AnnaleImportPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<ImportMode>('local');
  const [file, setFile] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [subject, setSubject] = useState('');
  const [year, setYear] = useState('');
  const [session, setSession] = useState('');
  const [title, setTitle] = useState('');
  const [annaleId, setAnnaleId] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [idSuffix, setIdSuffix] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [workspaceKey, setWorkspaceKey] = useState(0);

  // Reset complet : prêt pour une nouvelle annale, formulaire totalement vierge.
  const resetForNewImport = () => {
    setFile(null);
    setFiles([]);
    setResult(null);
    setError(null);
    setOverwrite(false);
    setIdSuffix('');
    setSubject('');
    setYear('');
    setSession('');
    setTitle('');
    setAnnaleId('');
    // Force le remount du workspace QROC → reset interne (draft, job, etc.) + nettoie le localStorage QROC
    setWorkspaceKey((k) => k + 1);
    try { localStorage.removeItem('hypocampus_qroc_session'); } catch {}
    try { localStorage.removeItem('hypocampus_qroc_batch_session'); } catch {}
    try { localStorage.removeItem('hypocampus_autre_session'); } catch {}
  };

  useEffect(() => {
    const nextTitle = [subject, year, session].filter(Boolean).join(' ');
    setTitle((current) => current || nextTitle);
    setAnnaleId((current) => current || slugify(nextTitle || (file ? fileBaseName(file) : '') || 'annale'));
  }, [subject, year, session, file]);

  const fileLabel = useMemo(() => {
    if (files.length > 1) return `${files.length} PDFs selectionnes`;
    if (!file) return 'PDF';
    const mb = file.size / (1024 * 1024);
    return `${file.name} - ${mb.toFixed(1)} Mo`;
  }, [file, files]);

  const handleFiles = (nextFiles: File[]) => {
    setError(null);
    setResult(null);
    if (!nextFiles.length) return;
    const pdfs = nextFiles.filter((nextFile) => nextFile.type === 'application/pdf' || nextFile.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length !== nextFiles.length) {
      setError('Tous les fichiers doivent etre des PDF.');
      return;
    }
    const nextFile = pdfs[0];
    setFiles(pdfs);
    setFile(nextFile);
    const base = fileBaseName(nextFile);
    const guessedSession = inferSession(nextFile.name);
    const guessedYear = inferYear(nextFile.name);
    setSession((current) => current || guessedSession);
    setYear((current) => current || (guessedYear ? String(guessedYear) : ''));
    setAnnaleId((current) => current || slugify([subject, guessedYear || year, guessedSession || base].filter(Boolean).join(' ')));
    setTitle((current) => current || [subject, guessedYear || year, guessedSession].filter(Boolean).join(' '));
  };

  const basePayload = () => ({
    filename: file?.name,
    annaleId: annaleId.trim(),
    subject: subject.trim(),
    year: Number(year),
    session: session.trim(),
    title: title.trim(),
    overwrite,
    idSuffix: idSuffix.trim(),
  });

  const handleLocalSubmit = async () => {
    setError(null);
    setResult(null);
    if (!file) {
      setError('PDF manquant.');
      return;
    }
    if (!annaleId.trim() || !subject.trim() || !year.trim() || !title.trim()) {
      setError('Metadonnees incompletes.');
      return;
    }
    setLoading(true);
    try {
      const pdfBase64 = await readFileAsBase64(file);
      const response = await fetch('/api/annales/import/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...basePayload(), pdfBase64 }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      setResult(data as ImportResult);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-background">
      <PageHeader
        title="Importer une annale"
        description={mode === 'local'
          ? 'Faculté — parsing local déterministe du format UNESS.'
          : mode === 'qroc'
            ? 'QROC — conversion contrôlée des anciens sujets en QCM jouables.'
            : 'Autre — transcription fidèle de PDF variés, corrigé généré si absent.'}
        crumbs={[{ label: 'Tableau de bord', to: '/entrainement' }, { label: 'Importer' }]}
        actions={
          <SegmentedControl
            ariaLabel="Type d'import"
            value={mode}
            onChange={(next) => setMode(next)}
            options={[
              { value: 'local', label: 'Faculté', title: 'PDF UNESS officiel avec correction à cases cochées' },
              { value: 'qroc', label: 'QROC', title: 'Anciens sujets QROC convertis en QCM via DeepSeek' },
              { value: 'autre', label: 'Autre', title: 'Tout autre PDF — transcription fidèle, corrigé IA si absent' },
            ]}
          />
        }
      />

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-5">

        <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
          <section className="space-y-5">
            <PdfDropZone
              fileLabel={fileLabel}
              allowMultiple={mode === 'qroc'}
              isDragging={isDragging}
              setIsDragging={setIsDragging}
              handleFiles={handleFiles}
            />
            {mode === 'local' ? <LocalExplainer /> : mode === 'qroc' ? <QrocExplainer /> : <AutreExplainer />}
          </section>

          <section className="bg-card border border-border rounded-card p-5 space-y-4">
            <MetaFields
              subject={subject}
              setSubject={setSubject}
              year={year}
              setYear={setYear}
              session={session}
              setSession={setSession}
              title={title}
              setTitle={setTitle}
              annaleId={annaleId}
              setAnnaleId={setAnnaleId}
              overwrite={overwrite}
              setOverwrite={setOverwrite}
              idSuffix={idSuffix}
              setIdSuffix={setIdSuffix}
              showSuffix={mode === 'qroc' && files.length > 1}
            />
            {error && <ErrorBox message={error} />}
            {mode === 'local' && (
              <>
                {result && (
                  <ImportSuccess
                    result={result}
                    onOpen={() => navigate(result.redirectTo)}
                    onReset={resetForNewImport}
                    onRenamed={(newId) => setResult((r) => r ? {
                      ...r,
                      annale: { ...r.annale, id: newId },
                      redirectTo: `/entrainement/${newId}`,
                      autoRenamed: false,
                      originalAnnaleId: undefined,
                    } : r)}
                  />
                )}
                <button
                  onClick={handleLocalSubmit}
                  disabled={loading}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-input bg-brand-600 px-5 py-3 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:bg-brand-700 hover:shadow-lg active:scale-95 disabled:opacity-60 disabled:hover:bg-brand-600"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <ScanText size={18} />}
                  {loading ? 'Import en cours...' : 'Importer localement'}
                </button>
              </>
            )}
          </section>
        </div>

        {mode === 'qroc' && (
          <QrocConversionWorkspace
            key={workspaceKey}
            file={file}
            files={files}
            meta={basePayload()}
            setPageError={setError}
            onOpenPublished={(url) => navigate(url)}
            onResetAll={resetForNewImport}
          />
        )}

        {mode === 'autre' && (
          <AutreImportPanel
            key={workspaceKey}
            file={file}
            meta={basePayload()}
            setPageError={setError}
            onOpenPublished={(url) => navigate(url)}
            onResetAll={resetForNewImport}
          />
        )}
      </main>
    </div>
  );
}

type QrocPublishedInfo = {
  redirectTo: string;
  title: string;
  questionsCount: number;
  annaleId: string;
  originalAnnaleId?: string;
  autoRenamed?: boolean;
};

function QrocConversionWorkspace({
  file,
  files,
  meta,
  setPageError,
  onOpenPublished,
  onResetAll,
}: {
  file: File | null;
  files: File[];
  meta: ImportMeta;
  setPageError: (error: string | null) => void;
  onOpenPublished: (url: string) => void;
  onResetAll: () => void;
}) {
  const [draft, setDraft] = useState<QrocDraft | null>(null);
  const [job, setJob] = useState<QrocJob | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-v4-flash');
  const [mock, setMock] = useState(false);
  const [skipQa, setSkipQa] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [forcePublish, setForcePublish] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [published, setPublished] = useState<QrocPublishedInfo | null>(null);
  const [draftsList, setDraftsList] = useState<DraftSummary[] | null>(null);
  const [draftsListArchived, setDraftsListArchived] = useState(false);
  const [draftsListBusy, setDraftsListBusy] = useState(false);
  const [batchItems, setBatchItems] = useState<QrocBatchItem[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);

  // ── Regroupement rétroactif QI → DP (pré-publication, édite le draft local) ──
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set());
  const [regroupDialogOpen, setRegroupDialogOpen] = useState(false);
  const [regroupForm, setRegroupForm] = useState<{ title: string; vignette: string; format: 'DP' | 'KFP' }>(
    { title: '', vignette: '', format: 'DP' }
  );
  const [regroupError, setRegroupError] = useState<string | null>(null);

  // ── Persistance localStorage : draftId + jobId pour reprendre après reload ──
  const STORAGE_KEY = 'hypocampus_qroc_session';
  const BATCH_STORAGE_KEY = 'hypocampus_qroc_batch_session';

  // Charge clé API depuis localStorage si présente
  useEffect(() => {
    const savedKey = localStorage.getItem('hypocampus_deepseek_key');
    if (savedKey) setApiKey(savedKey);
  }, []);

  // Persiste apiKey à chaque modif
  useEffect(() => {
    if (apiKey) localStorage.setItem('hypocampus_deepseek_key', apiKey);
  }, [apiKey]);

  // Persiste draft.id + job.id
  useEffect(() => {
    if (!draft && !job) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      draftId: draft?.id || job?.draftId || null,
      jobId: job?.id || null,
    }));
  }, [draft, job]);

  // Au montage : tente de reprendre une session précédente
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        if (!saved.draftId) return;
        setResuming(true);
        // Récupère le draft
        const draftResponse = await fetch(`/api/annales/drafts/${saved.draftId}`);
        if (draftResponse.ok && !cancelled) {
          const draftData = await draftResponse.json();
          if (draftData.status === 'published') {
            localStorage.removeItem(STORAGE_KEY);
            return;
          }
          setDraft(draftData);
          if (draftData.sourceBlocks?.length) {
            setSelectedBlockId(draftData.sourceBlocks[0].id);
          }
        }
        // Récupère le job (peut être en cours, en done, ou interrompu)
        if (saved.jobId) {
          const jobResponse = await fetch(`/api/annales/convert-qroc/jobs/${saved.jobId}`);
          if (jobResponse.ok && !cancelled) {
            setJob(await jobResponse.json());
          }
        }
      } catch {}
      finally {
        if (!cancelled) setResuming(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!job || ['done', 'done-with-errors', 'error', 'cancelled', 'interrupted'].includes(job.status)) return;
    let tick = 0;
    const id = window.setInterval(async () => {
      tick += 1;
      const response = await fetch(`/api/annales/convert-qroc/jobs/${job.id}`);
      const nextJob = await response.json();
      setJob(nextJob);
      const isFinal = ['done', 'done-with-errors', 'error', 'cancelled', 'interrupted'].includes(nextJob.status);
      // Refresh le draft à la fin OU périodiquement pendant la génération (toutes les ~6s = tick%4)
      if (isFinal || tick % 4 === 0) {
        const draftResponse = await fetch(`/api/annales/drafts/${nextJob.draftId}`);
        if (draftResponse.ok) setDraft(await draftResponse.json());
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [job]);

  // Charger immédiatement le draft si on a un job done mais pas encore de draft
  useEffect(() => {
    if (!job || !job.draftId) return;
    if (draft && draft.id === job.draftId) return;
    if (!['done', 'done-with-errors'].includes(job.status)) return;
    (async () => {
      const draftResponse = await fetch(`/api/annales/drafts/${job.draftId}`);
      if (draftResponse.ok) setDraft(await draftResponse.json());
    })();
  }, [job, draft]);

  const selectedBlock = draft?.sourceBlocks.find((block) => block.id === selectedBlockId) || draft?.sourceBlocks[0] || null;
  const allSourceWarnings = (draft?.sourceBlocks || []).flatMap((block) => (block.warnings || []).map((warning) => ({ block, warning })));
  const blockingWarnings = allSourceWarnings.filter(({ warning }) => warning.blocking);
  const nonBlockingWarnings = allSourceWarnings.filter(({ warning }) => !warning.blocking);
  const generationErrors = draft?.generationReport?.errors || [];
  const failedNetworkBlockIds = Array.from(new Set(generationErrors
    .map((error) => {
      const match = String(error || '').match(/^([^:]+):\s+appel DeepSeek impossible/i);
      return match?.[1] || null;
    })
    .filter(Boolean) as string[]));
  const qrocFiles = files.length > 0 ? files : file ? [file] : [];

  const updateBatchItem = (key: string, patch: Partial<QrocBatchItem>) => {
    setBatchItems((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const buildBatchItem = (batchFile: File, index: number, usedIds: Set<string>): QrocBatchItem => {
    const base = fileBaseName(batchFile);
    const inferredYear = inferYear(batchFile.name);
    const parsedYear = inferredYear || (meta.year > 0 ? meta.year : null);
    const parsedSession = inferSession(batchFile.name) || meta.session || '';
    const parsedSubject = meta.subject || '';
    const suffix = slugify((meta as any).idSuffix || '');
    const baseTitle = [parsedSubject, parsedYear || '', parsedSession].filter(Boolean).join(' ').trim() || base;
    const rawId = [parsedSubject, parsedYear || '', parsedSession || base].filter(Boolean).join(' ') || base;
    let nextId = slugify(rawId || `annale-${index + 1}`);
    if (!nextId) nextId = `annale-${index + 1}`;
    // Suffix global applique a tous les IDs du batch (ex: "v2" → tous les IDs deviennent <id>-v2)
    if (suffix) {
      nextId = `${nextId}-${suffix}`.slice(0, 80);
    }
    if (usedIds.has(nextId)) {
      const withBase = slugify(`${nextId}-${base}`) || `${nextId}-${index + 1}`;
      nextId = usedIds.has(withBase) ? `${withBase}-${index + 1}`.slice(0, 80) : withBase;
    }
    usedIds.add(nextId);
    return {
      key: `${batchFile.name}-${batchFile.size}-${index}`,
      fileName: batchFile.name,
      annaleId: nextId,
      title: baseTitle,
      subject: parsedSubject,
      year: parsedYear,
      session: parsedSession,
      status: parsedSubject && parsedYear ? 'pending' : 'error',
      error: parsedSubject ? (parsedYear ? undefined : 'Année introuvable dans le nom du fichier et champ Année vide.') : 'Matière manquante.',
    };
  };

  useEffect(() => {
    let cancelled = false;
    const raw = localStorage.getItem(BATCH_STORAGE_KEY);
    if (!raw) return;
    (async () => {
      try {
        const saved = JSON.parse(raw);
        if (!Array.isArray(saved?.items) || saved.items.length === 0) return;
        const response = await fetch('/api/annales/drafts');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const activeDrafts = await response.json() as DraftSummary[];
        const activeIds = new Set(activeDrafts.map((item) => item.id));
        const filtered = saved.items.filter((item: QrocBatchItem) => !item.draftId || activeIds.has(item.draftId));
        if (!cancelled) setBatchItems(filtered);
      } catch {
        if (!cancelled) setBatchItems([]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (batchItems.length === 0) {
      localStorage.removeItem(BATCH_STORAGE_KEY);
      return;
    }
    localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify({
      items: batchItems.map(({ job, ...item }) => item),
    }));
  }, [batchItems]);

  useEffect(() => {
    const active = batchItems.filter((item) => item.jobId && !isTerminalJobStatus(item.status));
    if (active.length === 0) return;
    let cancelled = false;
    const refresh = async () => {
      const updates = await Promise.all(active.map(async (item) => {
        try {
          const jobResponse = await fetch(`/api/annales/convert-qroc/jobs/${item.jobId}`);
          if (!jobResponse.ok) throw new Error(`HTTP ${jobResponse.status}`);
          const nextJob = await jobResponse.json() as QrocJob;
          const update: Partial<QrocBatchItem> = { job: nextJob, status: nextJob.status as QrocBatchItem['status'] };
          if (isTerminalJobStatus(nextJob.status)) {
            const draftResponse = await fetch(`/api/annales/drafts/${nextJob.draftId}`);
            if (draftResponse.ok) {
              const nextDraft = await draftResponse.json() as QrocDraft;
              update.generatedQuestions = nextDraft.generatedQuestions?.length || 0;
              update.sourceBlocks = nextDraft.sourceBlocks?.length || item.sourceBlocks;
            }
          }
          return [item.key, update] as const;
        } catch (e: any) {
          return [item.key, { status: 'error' as const, error: e.message || String(e) }] as const;
        }
      }));
      if (cancelled) return;
      setBatchItems((items) => items.map((item) => {
        const found = updates.find(([key]) => key === item.key);
        return found ? { ...item, ...found[1] } : item;
      }));
    };
    refresh();
    const intervalId = window.setInterval(refresh, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [batchItems.map((item) => `${item.key}:${item.jobId || ''}:${item.status}`).join('|')]);

  const startBatch = async () => {
    setPageError(null);
    if (qrocFiles.length < 2) {
      setPageError('Selectionne au moins 2 PDFs pour lancer un batch.');
      return;
    }
    if (!mock && !apiKey.trim()) {
      setPageError('Cle API DeepSeek manquante.');
      return;
    }
    const usedIds = new Set<string>();
    const prepared = qrocFiles.map((batchFile, index) => buildBatchItem(batchFile, index, usedIds));
    setBatchItems(prepared);
    setBatchBusy(true);
    try {
      for (let index = 0; index < qrocFiles.length; index += 1) {
        const batchFile = qrocFiles[index];
        const item = prepared[index];
        if (item.status === 'error') continue;
        updateBatchItem(item.key, { status: 'extracting', error: undefined });
        try {
          const pdfBase64 = await readFileAsBase64(batchFile);
          const extractResponse = await fetch('/api/annales/convert-qroc/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: batchFile.name,
              annaleId: item.annaleId,
              subject: item.subject,
              year: item.year,
              session: item.session,
              title: item.title,
              overwrite: false,
              pdfBase64,
            }),
          });
          const extractData = await extractResponse.json().catch(() => null);
          if (!extractResponse.ok) throw new Error(extractData?.error || `HTTP ${extractResponse.status}`);
          const nextDraft = extractData.draft as QrocDraft;
          const blockingCount = nextDraft.report?.blockingWarnings ?? (nextDraft.sourceBlocks || []).reduce(
            (count, block) => count + ((block.warnings || []).some((warning) => warning.blocking) ? 1 : 0),
            0,
          );
          if (blockingCount > 0) {
            updateBatchItem(item.key, {
              status: 'blocked',
              draftId: nextDraft.id,
              sourceBlocks: nextDraft.sourceBlocks?.length || 0,
              generatedQuestions: 0,
              error: `${blockingCount} warning(s) bloquant(s) : ouvre le brouillon pour corriger le découpage.`,
            });
            continue;
          }
          const generateResponse = await fetch(`/api/annales/convert-qroc/drafts/${nextDraft.id}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, model, mock, skipQa }),
          });
          const generateData = await generateResponse.json().catch(() => null);
          if (!generateResponse.ok) throw new Error(generateData?.error || `HTTP ${generateResponse.status}`);
          updateBatchItem(item.key, {
            status: generateData.status || 'queued',
            draftId: nextDraft.id,
            jobId: generateData.jobId,
            sourceBlocks: nextDraft.sourceBlocks?.length || 0,
            generatedQuestions: 0,
            job: generateData as QrocJob,
          });
        } catch (e: any) {
          updateBatchItem(item.key, { status: 'error', error: e.message || String(e) });
        }
      }
    } finally {
      setBatchBusy(false);
    }
  };

  const clearBatch = () => {
    setBatchItems([]);
    localStorage.removeItem(BATCH_STORAGE_KEY);
  };

  // Applique le suffixe (meta.idSuffix) a tous les items du batch qui ont deja un draftId
  // → renomme leur annaleId cote serveur via PATCH /api/annales/drafts/<id>
  const applySuffixToExistingDrafts = async () => {
    const suffix = slugify((meta as any).idSuffix || '');
    if (!suffix) {
      setPageError('Saisis d\'abord un suffixe dans le formulaire de droite.');
      return;
    }
    const targets = batchItems.filter((item) => item.draftId && !item.annaleId.endsWith(`-${suffix}`));
    if (targets.length === 0) {
      setPageError('Aucun brouillon a renommer (suffixe deja applique ?).');
      return;
    }
    setPageError(null);
    setBatchBusy(true);
    try {
      const updates = await Promise.all(targets.map(async (item) => {
        const newId = `${item.annaleId}-${suffix}`.slice(0, 80);
        try {
          const response = await fetch(`/api/annales/drafts/${item.draftId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ meta: { annaleId: newId } }),
          });
          if (!response.ok) {
            const err = await response.json().catch(() => null);
            throw new Error((err && err.error) || `HTTP ${response.status}`);
          }
          return { key: item.key, annaleId: newId, ok: true as const };
        } catch (e: any) {
          return { key: item.key, annaleId: item.annaleId, ok: false as const, error: e.message || String(e) };
        }
      }));
      // Met a jour le state local
      setBatchItems((items) => items.map((item) => {
        const found = updates.find((u) => u.key === item.key);
        return found && found.ok ? { ...item, annaleId: found.annaleId } : item;
      }));
      const failed = updates.filter((u) => !u.ok);
      if (failed.length > 0) {
        setPageError(`${failed.length} renommage(s) echoue(s). ${failed[0].error || ''}`);
      }
    } finally {
      setBatchBusy(false);
    }
  };

  const openBatchDraft = async (item: QrocBatchItem) => {
    if (!item.draftId) return;
    setPageError(null);
    setBusy(true);
    try {
      const draftResponse = await fetch(`/api/annales/drafts/${item.draftId}`);
      const nextDraft = await draftResponse.json().catch(() => null);
      if (!draftResponse.ok) throw new Error(nextDraft?.error || `HTTP ${draftResponse.status}`);
      setDraft(nextDraft as QrocDraft);
      setSelectedBlockId(nextDraft.sourceBlocks?.[0]?.id || null);
      if (item.jobId) {
        const jobResponse = await fetch(`/api/annales/convert-qroc/jobs/${item.jobId}`);
        if (jobResponse.ok) setJob(await jobResponse.json());
      } else {
        setJob(null);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ draftId: item.draftId, jobId: item.jobId || null }));
    } catch (e: any) {
      setPageError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const jumpToFirstWarning = () => {
    const blockWithWarning = (draft?.sourceBlocks || []).find((block) => (block.warnings || []).length > 0);
    if (blockWithWarning) setSelectedBlockId(blockWithWarning.id);
  };

  const extract = async () => {
    setPageError(null);
    if (!file) {
      setPageError('PDF manquant.');
      return;
    }
    if (!meta.subject || !meta.title || !meta.annaleId || !meta.year) {
      setPageError('Metadonnees incompletes pour ce PDF.');
      return;
    }
    setBusy(true);
    try {
      const pdfBase64 = await readFileAsBase64(file);
      const response = await fetch('/api/annales/convert-qroc/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...meta, pdfBase64 }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      setDraft(data.draft);
      setSelectedBlockId(data.draft.sourceBlocks[0]?.id || null);
      setJob(null);
    } catch (e: any) {
      setPageError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const patchBlocks = async (blocks: SourceBlock[]) => {
    if (!draft) return null;
    const response = await fetch(`/api/annales/convert-qroc/drafts/${draft.id}/source-blocks`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceBlocks: blocks }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    setDraft(data);
    return data as QrocDraft;
  };

  const saveBlocks = async () => {
    if (!draft) return;
    setBusy(true);
    setPageError(null);
    try {
      await patchBlocks(draft.sourceBlocks);
    } catch (e: any) {
      setPageError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!draft) return;
    setBusy(true);
    setPageError(null);
    try {
      const saved = await patchBlocks(draft.sourceBlocks);
      if (!saved) return;
      if (!mock && !apiKey.trim()) throw new Error('Cle API DeepSeek manquante.');
      const response = await fetch(`/api/annales/convert-qroc/drafts/${saved.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, model, mock, skipQa }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      setJob({ ...data, id: data?.jobId ?? data?.id } as QrocJob);
    } catch (e: any) {
      setPageError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const retryNetworkBlocks = async () => {
    if (!draft || failedNetworkBlockIds.length === 0) return;
    setBusy(true);
    setPageError(null);
    try {
      if (!mock && !apiKey.trim()) throw new Error('Cle API DeepSeek manquante.');
      const response = await fetch(`/api/annales/convert-qroc/drafts/${draft.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, model, mock, skipQa, blockIds: failedNetworkBlockIds }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      setJob({ ...data, id: data?.jobId ?? data?.id } as QrocJob);
    } catch (e: any) {
      setPageError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancelJob = async () => {
    if (!job) return;
    const response = await fetch(`/api/annales/convert-qroc/jobs/${job.id}/cancel`, { method: 'POST' });
    const data = await response.json().catch(() => null);
    if (response.ok) setJob(data);
  };

  const persistDraft = async () => {
    if (!draft) return null;
    const response = await fetch(`/api/annales/drafts/${draft.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: draft.meta, generatedQuestions: draft.generatedQuestions }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    setDraft(data);
    return data as QrocDraft;
  };

  const saveDraft = async () => {
    setBusy(true);
    setPageError(null);
    try {
      await persistDraft();
    } catch (e: any) {
      setPageError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!draft) return;
    setBusy(true);
    setPageError(null);
    try {
      const saved = await persistDraft();
      if (!saved) return;
      const response = await fetch(`/api/annales/drafts/${saved.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwrite: meta.overwrite, force: forcePublish }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      // Pas de navigate auto : on affiche un panneau succès, l'utilisateur choisit.
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      setBatchItems((items) => items.filter((item) => item.draftId !== saved.id));
      setDraftsList((items) => items ? items.filter((item) => item.id !== saved.id) : items);
      setDraft(null);
      setJob(null);
      setSelectedBlockId(null);
      setPublished({
        redirectTo: data.redirectTo,
        title: (saved.meta as any)?.title || saved.id,
        questionsCount: (data.annale?.questionsCount as number | undefined) ?? (saved.generatedQuestions?.length || 0),
        annaleId: (data.annale?.id as string | undefined) || (saved.meta as any)?.annaleId || '',
        originalAnnaleId: data.originalAnnaleId,
        autoRenamed: !!data.autoRenamed,
      });
    } catch (e: any) {
      setPageError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const updateBlock = (id: string, patch: Partial<SourceBlock>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      sourceBlocks: draft.sourceBlocks.map((block) => (block.id === id ? { ...block, ...patch } : block)),
    });
  };

  const splitBlock = (id: string) => {
    if (!draft) return;
    const index = draft.sourceBlocks.findIndex((block) => block.id === id);
    const block = draft.sourceBlocks[index];
    if (!block) return;
    const text = block.cleanText || block.rawText || '';
    const midpoint = Math.floor(text.length / 2);
    const splitAt = text.indexOf('\n', midpoint) > 0 ? text.indexOf('\n', midpoint) : midpoint;
    const first = text.slice(0, splitAt).trim();
    const second = text.slice(splitAt).trim();
    if (!first || !second) return;
    const nextBlocks = [...draft.sourceBlocks];
    nextBlocks.splice(index, 1, { ...block, cleanText: first, rawText: first, title: `${block.title} A` }, {
      ...block,
      id: `${block.id}-b`,
      cleanText: second,
      rawText: second,
      title: `${block.title} B`,
      images: [],
    });
    setDraft({ ...draft, sourceBlocks: nextBlocks });
  };

  const mergeWithPrevious = (id: string) => {
    if (!draft) return;
    const index = draft.sourceBlocks.findIndex((block) => block.id === id);
    if (index <= 0) return;
    const previous = draft.sourceBlocks[index - 1];
    const current = draft.sourceBlocks[index];
    const merged: SourceBlock = {
      ...previous,
      title: previous.title,
      pages: Array.from(new Set([...(previous.pages || []), ...(current.pages || [])])).sort((a, b) => a - b),
      rawText: `${previous.rawText || previous.cleanText}\n\n${current.rawText || current.cleanText}`.trim(),
      cleanText: `${previous.cleanText || previous.rawText}\n\n${current.cleanText || current.rawText}`.trim(),
      images: [...(previous.images || []), ...(current.images || [])],
    };
    const nextBlocks = [...draft.sourceBlocks];
    nextBlocks.splice(index - 1, 2, merged);
    setDraft({ ...draft, sourceBlocks: nextBlocks });
    setSelectedBlockId(merged.id);
  };

  const updateQuestion = (index: number, patch: Partial<GeneratedQuestion>) => {
    if (!draft) return;
    const generatedQuestions = [...draft.generatedQuestions];
    generatedQuestions[index] = { ...generatedQuestions[index], ...patch };
    setDraft({ ...draft, generatedQuestions });
  };

  const deleteQuestion = (index: number) => {
    if (!draft) return;
    setDraft({ ...draft, generatedQuestions: draft.generatedQuestions.filter((_, i) => i !== index) });
  };

  const updateOption = (questionIndex: number, optionIndex: number, patch: Partial<GeneratedOption>) => {
    if (!draft) return;
    const question = draft.generatedQuestions[questionIndex];
    const options = [...(question.options || [])];
    options[optionIndex] = { ...options[optionIndex], ...patch };
    updateQuestion(questionIndex, { options });
  };

  const addOption = (questionIndex: number) => {
    if (!draft) return;
    const question = draft.generatedQuestions[questionIndex];
    const options = [...(question.options || [])];
    if (options.length >= 15) return;
    options.push({ id: nextOptionId(options), text: '', correct: false });
    updateQuestion(questionIndex, { options });
  };

  const deleteOption = (questionIndex: number, optionIndex: number) => {
    if (!draft) return;
    const question = draft.generatedQuestions[questionIndex];
    updateQuestion(questionIndex, { options: (question.options || []).filter((_, i) => i !== optionIndex) });
  };

  // ── Sélection multi-questions QI pour regroupement DP/KFP ──────────
  const toggleQuestionSelection = (questionId: string) => {
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  };

  const clearSelection = () => setSelectedQuestionIds(new Set());

  // Liste ordonnée (par ordre dans le draft) des questions QI sélectionnées
  const selectedOrderedQuestions = useMemo(() => {
    if (!draft) return [] as GeneratedQuestion[];
    return draft.generatedQuestions.filter((q) => selectedQuestionIds.has(q.id) && !q.seriesFormat);
  }, [draft, selectedQuestionIds]);

  const openRegroupDialog = () => {
    if (selectedOrderedQuestions.length < 2) return;
    // Pré-remplit vignette depuis la correction de la 1re question sélectionnée
    const firstCorrection = (selectedOrderedQuestions[0].correctionText || '').trim();
    setRegroupForm({
      title: '',
      vignette: firstCorrection,
      format: 'DP',
    });
    setRegroupError(null);
    setRegroupDialogOpen(true);
  };

  const closeRegroupDialog = () => {
    setRegroupDialogOpen(false);
    setRegroupError(null);
  };

  // Exécute le regroupement en local (draft pré-publication) : pas d'appel API,
  // on édite directement les générées. Sauvegarde via saveDraft pour persister.
  const applyRegroupLocal = async () => {
    if (!draft) return;
    const ordered = selectedOrderedQuestions;
    if (ordered.length < 2) {
      setRegroupError('Sélectionne au moins 2 questions QI.');
      return;
    }
    const title = regroupForm.title.trim();
    if (!title) {
      setRegroupError('Titre du dossier requis.');
      return;
    }
    const vignette = regroupForm.vignette;
    if ((vignette || '').trim().length < 20) {
      setRegroupError('Vignette trop courte (min 20 caractères).');
      return;
    }
    // Génère un seriesId local (le backend regénèrera le sien à la publication
    // via parse_local ; ce qui compte est qu'il soit unique dans le draft)
    const slug = slugify(title) || 'dossier';
    const suffix = Math.random().toString(36).slice(2, 8);
    const newSeriesId = `dp-${slug}-${suffix}`.slice(0, 60);
    const total = ordered.length;
    const idsInSeries = new Set(ordered.map((q) => q.id));
    const positionByQid = new Map<string, number>();
    ordered.forEach((q, i) => positionByQid.set(q.id, i + 1));
    const generatedQuestions = draft.generatedQuestions.map((q) => {
      if (!idsInSeries.has(q.id)) return q;
      const position = positionByQid.get(q.id)!;
      return {
        ...q,
        seriesId: newSeriesId,
        seriesFormat: regroupForm.format,
        seriesPosition: position,
        seriesTotal: total,
        customTitle: title,
        vignette: position === 1 ? vignette : null,
      };
    });
    setDraft({ ...draft, generatedQuestions });
    setRegroupDialogOpen(false);
    setRegroupError(null);
    setSelectedQuestionIds(new Set());
    toast.success(`${total} questions regroupées en ${regroupForm.format}`);
  };

  const resetSession = () => {
    if (draft || job) {
      const ok = window.confirm("Abandonner le brouillon en cours et repartir d'un PDF vide ? (le brouillon reste sauvegardé côté serveur)");
      if (!ok) return;
    }
    setDraft(null);
    setJob(null);
    setSelectedBlockId(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const openDraftsPicker = async (archived = false) => {
    setPageError(null);
    setDraftsListBusy(true);
    try {
      const response = await fetch(`/api/annales/drafts${archived ? '?archived=1' : ''}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error((data && data.error) || `HTTP ${response.status}`);
      setDraftsListArchived(archived);
      setDraftsList(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setPageError(e.message || String(e));
      setDraftsList([]);
    } finally {
      setDraftsListBusy(false);
    }
  };

  const closeDraftsPicker = () => setDraftsList(null);

  const resumeDraftById = async (id: string) => {
    const trimmed = (id || '').trim();
    if (!trimmed) return;
    setPageError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/annales/drafts/${trimmed}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error((data && data.error) || `Brouillon introuvable (${response.status})`);
      if (data?.status === 'published') {
        throw new Error("Ce brouillon est deja publie. Utilise Anciens brouillons pour ouvrir l'annale publiee.");
      }
      setDraft(data);
      if (data.sourceBlocks?.length) setSelectedBlockId(data.sourceBlocks[0].id);
      setJob(null);
      setDraftsList(null);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ draftId: trimmed, jobId: null }));
    } catch (e: any) {
      setPageError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (published) {
    return (
      <section className="space-y-4">
        <div className="rounded-card bg-success-50 dark:bg-success-950/30 border border-success-100 dark:border-success-700/50 text-success-950 dark:text-success-100 p-5 space-y-3">
          <div className="flex items-center gap-2 font-medium text-base">
            <CheckCircle2 size={20} />
            Annale publiée : {published.title}
          </div>
          <div className="text-sm text-success-700 dark:text-success-500">
            {published.questionsCount} questions ont été ajoutées dans <code>/entrainement</code>.
          </div>
          {published.autoRenamed && published.originalAnnaleId && (
            <AutoRenamedNotice
              currentId={published.annaleId}
              originalId={published.originalAnnaleId}
              onRenamed={(newId) => setPublished((p) => p ? { ...p, annaleId: newId, redirectTo: `/entrainement/${newId}`, autoRenamed: false, originalAnnaleId: undefined } : p)}
            />
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => onOpenPublished(published.redirectTo)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-input bg-success-700 hover:bg-success-500 text-white font-medium"
            >
              Ouvrir l'annale
            </button>
            <button
              onClick={onResetAll}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-input border border-success-100 dark:border-success-700/50 bg-card/60 text-success-700 dark:text-success-100 hover:bg-card font-medium"
            >
              Importer une autre annale
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      {resuming && (
        <div className="rounded-input bg-brand-50 dark:bg-brand-950/30 border border-brand-100 dark:border-brand-700/50 text-brand-700 dark:text-brand-100 p-3 text-sm flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Reprise du brouillon en cours…
        </div>
      )}
      {draft && !resuming && (
        <div className="rounded-input bg-muted/50 border border-border px-3 py-2 text-xs text-muted-foreground flex items-center justify-between gap-2">
          <span>Brouillon en cours : <code className="text-foreground">{draft.id}</code>{job ? ` · job ${job.id} · ${job.status}` : ''}</span>
          <button onClick={resetSession} className="text-danger-700 dark:text-danger-500 hover:underline font-medium">Nouveau brouillon</button>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={extract}
          disabled={busy || batchBusy}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-input bg-foreground text-background text-sm font-medium disabled:opacity-60"
        >
          {busy && !draft ? <Loader2 size={16} className="animate-spin" /> : <ScanText size={16} />}
          Extraire les QROC
        </button>
        <button
          onClick={startBatch}
          disabled={batchBusy || busy || qrocFiles.length < 2}
          title={qrocFiles.length < 2 ? 'Selectionne au moins 2 PDFs pour lancer un batch.' : undefined}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-input bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:hover:bg-brand-600 text-white text-sm font-medium"
        >
          {batchBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {qrocFiles.length < 2 ? 'Lancer batch' : `Lancer batch (${qrocFiles.length} PDFs)`}
        </button>
        {!draft && (
          <button onClick={() => openDraftsPicker(false)} disabled={busy || draftsListBusy} className="inline-flex items-center gap-2 px-4 py-2 rounded-input border border-border text-sm font-medium hover:bg-muted">
            {draftsListBusy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            Reprendre un brouillon
          </button>
        )}
        {!draft && (
          <button onClick={() => openDraftsPicker(true)} disabled={busy || draftsListBusy} className="inline-flex items-center gap-2 px-4 py-2 rounded-input border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            {draftsListBusy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            Anciens brouillons
          </button>
        )}
        {draft && (
          <button onClick={saveBlocks} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-input border border-border text-sm font-medium hover:bg-muted">
            <Save size={16} /> Sauvegarder decoupage
          </button>
        )}
      </div>
      {qrocFiles.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {qrocFiles.length === 1
            ? '1 PDF selectionne : utilise Extraire les QROC, ou selectionne plusieurs PDFs pour activer le batch.'
            : `${qrocFiles.length} PDFs selectionnes pour le batch.`}
        </div>
      )}

      {batchItems.length > 0 && (
        <QrocBatchPanel
          items={batchItems}
          busy={batchBusy}
          onOpenDraft={openBatchDraft}
          onClear={clearBatch}
          idSuffix={(meta as any).idSuffix || ''}
          onApplySuffix={applySuffixToExistingDrafts}
        />
      )}

      {draftsList && !draft && (
        <div className="bg-card border border-border rounded-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium text-foreground">
                {draftsListArchived ? 'Anciens brouillons' : 'Brouillons en cours'}
              </div>
              <div className="text-xs text-muted-foreground">
                {draftsList.length === 0
                  ? (draftsListArchived ? 'Aucun brouillon publie.' : 'Aucun brouillon actif sur disque.')
                  : draftsListArchived ? `${draftsList.length} brouillon(s) publie(s).` : `${draftsList.length} brouillon(s) actif(s). Clique pour reprendre.`}
              </div>
            </div>
            <button onClick={closeDraftsPicker} className="text-xs text-muted-foreground hover:text-foreground">
              Fermer
            </button>
          </div>
          {draftsList.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-2">
              {draftsList.map((d) => (
                <div
                  key={d.id}
                  className="text-left rounded-input border border-border p-3 transition-colors"
                >
                  <div className="font-medium text-sm text-foreground truncate">{d.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {[d.subject, d.year, d.session].filter(Boolean).join(' - ')}
                  </div>
                  <div className="text-xs mt-1 flex gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {d.sourceBlocks} bloc(s)
                    </span>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${
                      d.generatedQuestions > 0
                        ? 'bg-success-100 text-success-700 dark:bg-success-950/40 dark:text-success-500'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {d.generatedQuestions} question(s) generee(s)
                    </span>
                    {d.status && (
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${
                        d.status === 'published'
                          ? 'bg-success-100 text-success-700 dark:bg-success-950/40 dark:text-success-500'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {d.status}
                      </span>
                    )}
                  </div>
                  {d.publishedAt && <div className="text-[10px] text-muted-foreground mt-1">Publie le {new Date(d.publishedAt).toLocaleString('fr-FR')}</div>}
                  <div className="text-[10px] text-muted-foreground mt-1 font-mono">{d.id}</div>
                  <div className="mt-2">
                    {draftsListArchived ? (
                      <button
                        onClick={() => {
                          const annaleId = publishedDraftAnnaleId(d);
                          if (annaleId) onOpenPublished(`/entrainement/${annaleId}`);
                        }}
                        disabled={busy || !publishedDraftAnnaleId(d)}
                        className="text-xs font-medium text-success-700 dark:text-success-500 hover:underline disabled:opacity-50"
                      >
                        Ouvrir l'annale
                      </button>
                    ) : (
                      <button
                        onClick={() => resumeDraftById(d.id)}
                        disabled={busy}
                        className="text-xs font-medium text-brand-700 dark:text-brand-500 hover:underline disabled:opacity-50"
                      >
                        Reprendre
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {draft && (
        <div className="grid lg:grid-cols-[340px_1fr] gap-5 items-start">
          <aside className="bg-card border border-border rounded-card p-4 space-y-3">
            <div>
              <div className="text-sm font-medium text-foreground">Blocs source</div>
              <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                <span>
                  {draft.sourceBlocks.length} blocs - {blockingWarnings.length} bloquant(s), {nonBlockingWarnings.length} non bloquant(s)
                </span>
                {allSourceWarnings.length > 0 && (
                  <button onClick={jumpToFirstWarning} className="font-medium text-warn-700 dark:text-warn-500 hover:underline">
                    Voir warning
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {draft.sourceBlocks.map((block) => (
                <button
                  key={block.id}
                  onClick={() => setSelectedBlockId(block.id)}
                  className={`w-full text-left rounded-lg border p-3 text-sm ${
                    selectedBlock?.id === block.id
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <div className="font-medium truncate">{block.title || block.id}</div>
                  <div className="text-xs text-muted-foreground">
                    p. {(block.pages || []).join(', ') || '?'} - {block.stats?.chars || block.cleanText.length} car.
                  </div>
                  {block.warnings?.some((warning) => warning.blocking) && (
                    <div className="mt-1 text-xs text-danger-700 dark:text-danger-500">A verifier avant generation</div>
                  )}
                  {block.warnings?.length && !block.warnings.some((warning) => warning.blocking) ? (
                    <div className="mt-1 text-xs text-warn-700 dark:text-warn-500">Warning non bloquant</div>
                  ) : null}
                </button>
              ))}
            </div>
          </aside>

          <div className="space-y-5">
            {selectedBlock && (
              <div className="bg-card border border-border rounded-card p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={selectedBlock.title}
                    onChange={(e) => updateBlock(selectedBlock.id, { title: e.target.value })}
                    className={`${inputClass} flex-1 min-w-[220px]`}
                  />
                  <button onClick={() => splitBlock(selectedBlock.id)} className="inline-flex items-center gap-1 px-3 py-2 rounded-input border border-border text-sm hover:bg-muted">
                    <Scissors size={14} /> Scinder
                  </button>
                  <button onClick={() => mergeWithPrevious(selectedBlock.id)} className="inline-flex items-center gap-1 px-3 py-2 rounded-input border border-border text-sm hover:bg-muted">
                    <GitMerge size={14} /> Fusionner
                  </button>
                  {selectedBlock.warnings?.some((warning) => warning.blocking) && (
                    <button
                      onClick={() => updateBlock(selectedBlock.id, {
                        warningsOverride: 'accepted',
                        warnings: (selectedBlock.warnings || []).map((warning) => ({ ...warning, blocking: false, accepted: true } as SourceWarning)),
                      })}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-input border border-warn-100 dark:border-warn-700/50 text-warn-700 dark:text-warn-500 text-sm font-medium hover:bg-warn-50 dark:hover:bg-warn-950/30"
                    >
                      Valider le bloc
                    </button>
                  )}
                  <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="checkbox" checked={!!selectedBlock.ignored} onChange={(e) => updateBlock(selectedBlock.id, { ignored: e.target.checked })} />
                    Ignorer
                  </label>
                </div>
                <textarea
                  value={selectedBlock.cleanText}
                  onChange={(e) => updateBlock(selectedBlock.id, { cleanText: e.target.value, rawText: e.target.value })}
                  className={`${textAreaClass} min-h-[260px] font-mono text-xs`}
                />
                {selectedBlock.images && selectedBlock.images.length > 0 && (
                  <div className="grid sm:grid-cols-2 gap-3">
                    {selectedBlock.images.map((image) => (
                      <div key={image.id} className="rounded-input border border-border p-2 text-xs">
                        <img src={`/api/annales/drafts/${draft.id}/img/${image.filename}`} alt="" className="max-h-48 w-full object-contain rounded bg-muted" />
                        <div className="mt-1 text-muted-foreground">{image.filename} - p.{image.page} - {image.confidence || '?'}</div>
                      </div>
                    ))}
                  </div>
                )}
                {selectedBlock.warnings && selectedBlock.warnings.length > 0 && (
                  <SourceBlockWarningsList warnings={selectedBlock.warnings} />
                )}
              </div>
            )}

            <div className="bg-card border border-border rounded-card p-4 space-y-4">
              <div className="grid md:grid-cols-[1fr_180px] gap-3">
                <Field label="Cle API DeepSeek">
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={inputClass} placeholder="sk-..." disabled={mock} />
                </Field>
                <Field label="Modele">
                  <select value={model} onChange={(e) => setModel(e.target.value)} className={inputClass}>
                    <option value="deepseek-v4-flash">deepseek-v4-flash</option>
                    <option value="deepseek-v4-pro">deepseek-v4-pro</option>
                  </select>
                </Field>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={mock} onChange={(e) => setMock(e.target.checked)} />
                Generation test sans appel DeepSeek
              </label>
              <label className="flex items-start gap-2 text-sm text-muted-foreground max-w-2xl">
                <input type="checkbox" checked={skipQa} onChange={(e) => setSkipQa(e.target.checked)} className="mt-1" />
                <span>
                  QA rapide : ignorer la relecture DeepSeek apres generation. Recommande en batch pour eviter les faux positifs ; tu relis le brouillon avant publication.
                </span>
              </label>
              <button
                onClick={generate}
                disabled={busy || blockingWarnings.length > 0}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-input bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
              >
                <Sparkles size={16} /> {job?.status === 'interrupted' ? 'Reprendre' : 'Generer le brouillon'}
              </button>
              {failedNetworkBlockIds.length > 0 && (
                <button
                  onClick={retryNetworkBlocks}
                  disabled={busy || blockingWarnings.length > 0}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-input border border-warn-100 dark:border-warn-700/50 text-warn-700 dark:text-warn-500 disabled:opacity-50 text-sm font-medium hover:bg-warn-50 dark:hover:bg-warn-950/30"
                >
                  <Sparkles size={16} /> Retenter blocs reseau ({failedNetworkBlockIds.join(', ')})
                </button>
              )}
              {blockingWarnings.length > 0 && (
                <div className="text-sm text-danger-700 dark:text-danger-500">Generation bloquee tant que le decoupage contient des warnings bloquants.</div>
              )}
              {job && <JobStatus job={job} onCancel={cancelJob} generatedSoFar={(draft?.generatedQuestions || []).length} />}
            </div>

            {draft.generatedQuestions.length > 0 && (
              <div className="bg-card border border-border rounded-card p-4 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-medium">
                      {draft.generatedQuestions.length} questions generees{' '}
                      <span className="text-xs font-normal text-muted-foreground">
                        ({countByType(draft.generatedQuestions, 'QRU')} QRU · {countByType(draft.generatedQuestions, 'QRM')} QRM · {countByType(draft.generatedQuestions, 'QROC')} QROC)
                      </span>
                    </div>
                    <ReportSeverityBreakdown report={draft.generationReport} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveDraft} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-input border border-border text-sm font-medium hover:bg-muted">
                      <Save size={15} /> Sauvegarder
                    </button>
                    <button onClick={publish} disabled={busy || (generationErrors.length > 0 && !forcePublish)} className="inline-flex items-center gap-2 px-4 py-2 rounded-input bg-success-700 hover:bg-success-500 disabled:opacity-50 text-white text-sm font-medium">
                      <CheckCircle2 size={15} /> Publier
                    </button>
                  </div>
                </div>
                {generationErrors.length > 0 && (
                  <label className="inline-flex items-center gap-2 text-sm text-danger-700 dark:text-danger-500">
                    <input type="checkbox" checked={forcePublish} onChange={(e) => setForcePublish(e.target.checked)} />
                    Forcer la publication malgre les erreurs
                  </label>
                )}
                <ReportDetailsList report={draft.generationReport} />
                <div className="space-y-4">
                  {draft.generatedQuestions.map((question, questionIndex) => (
                    <QuestionEditor
                      key={`${question.id}-${questionIndex}`}
                      question={question}
                      index={questionIndex}
                      updateQuestion={(patch) => updateQuestion(questionIndex, patch)}
                      deleteQuestion={() => deleteQuestion(questionIndex)}
                      updateOption={(optionIndex, patch) => updateOption(questionIndex, optionIndex, patch)}
                      addOption={() => addOption(questionIndex)}
                      deleteOption={(optionIndex) => deleteOption(questionIndex, optionIndex)}
                      isQiSelectable={!question.seriesFormat}
                      isQiSelected={selectedQuestionIds.has(question.id)}
                      onToggleSelect={() => toggleQuestionSelection(question.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Sticky bar : apparait dès ≥ 2 QI sélectionnées */}
            {selectedOrderedQuestions.length >= 2 && (
              <div className="sticky bottom-4 z-30 mt-4 flex items-center gap-3 rounded-card border border-brand-100 dark:border-brand-700/50 bg-brand-50/95 dark:bg-brand-950/80 backdrop-blur px-4 py-3 shadow-lg">
                <span className="text-sm font-medium text-brand-950 dark:text-brand-100">
                  {selectedOrderedQuestions.length} question(s) QI sélectionnée(s)
                </span>
                <button
                  onClick={openRegroupDialog}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-input bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
                >
                  <GitMerge size={15} />
                  Regrouper en DP
                </button>
                <button
                  onClick={clearSelection}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-input text-sm font-medium text-brand-700 dark:text-brand-100 hover:bg-brand-100 dark:hover:bg-brand-950/40"
                >
                  <X size={14} />
                  Désélectionner
                </button>
              </div>
            )}

            {/* Dialog regroupement */}
            {regroupDialogOpen && (
              <RegroupDialog
                count={selectedOrderedQuestions.length}
                form={regroupForm}
                setForm={setRegroupForm}
                error={regroupError}
                onCancel={closeRegroupDialog}
                onConfirm={applyRegroupLocal}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function technicalBatchErrors(item: QrocBatchItem): string[] {
  const errors = item.job?.errors || (item.error ? [item.error] : []);
  return errors.filter((error) => /appel DeepSeek impossible|HTTP|timeout|getaddrinfo|reponse DeepSeek|JSON|options absentes|sourceRefs absent|aucune option correcte/i.test(String(error)));
}

function batchDisplayStatus(item: QrocBatchItem): { label: string; icon: LucideIcon; spin?: boolean; tone: 'green' | 'amber' | 'red' | 'indigo' | 'neutral'; bucket: number; lane: 'failed' | 'inProgress' | 'queued' | 'done' } {
  const phase = item.job?.progress?.phase;
  if (item.status === 'blocked') return { label: 'decoupage a corriger', icon: XCircle, tone: 'red', bucket: 0, lane: 'failed' };
  if (['error', 'cancelled', 'interrupted'].includes(item.status)) return { label: 'echec technique', icon: XCircle, tone: 'red', bucket: 0, lane: 'failed' };
  if (item.status === 'done-with-errors') {
    return technicalBatchErrors(item).length > 0
      ? { label: 'bloc a retenter', icon: AlertTriangle, tone: 'amber', bucket: 0, lane: 'failed' }
      : { label: 'pret a relire', icon: CheckCircle2, tone: 'green', bucket: 2, lane: 'done' };
  }
  if (item.status === 'done') return { label: 'pret a relire', icon: CheckCircle2, tone: 'green', bucket: 2, lane: 'done' };
  if (item.status === 'extracting') return { label: 'extraction PDF', icon: Loader2, spin: true, tone: 'indigo', bucket: 1, lane: 'inProgress' };
  if (item.status === 'running' || item.status === 'generating') {
    if (phase === 'checking') return { label: 'DeepSeek relit', icon: Loader2, spin: true, tone: 'indigo', bucket: 1, lane: 'inProgress' };
    return { label: 'DeepSeek genere', icon: Loader2, spin: true, tone: 'indigo', bucket: 1, lane: 'inProgress' };
  }
  if (item.status === 'queued') return { label: 'en file d\'attente', icon: Clock, tone: 'neutral', bucket: 1, lane: 'queued' };
  return { label: 'en attente', icon: Clock, tone: 'neutral', bucket: 1, lane: 'queued' };
}

function countByType(questions: GeneratedQuestion[], type: GeneratedQuestion['questionType']): number {
  return questions.filter((q) => q.questionType === type).length;
}

// Composant : message + bouton crayon quand le publish a auto-renomme l'annale (collision evitee)
function AutoRenamedNotice({
  currentId,
  originalId,
  onRenamed,
}: {
  currentId: string;
  originalId: string;
  onRenamed: (newId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const startEdit = () => {
    setDraftValue(currentId);
    setLocalError(null);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setLocalError(null);
  };

  const submit = async () => {
    const newId = slugify(draftValue.trim());
    if (!newId) {
      setLocalError('ID invalide');
      return;
    }
    if (newId === currentId) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setLocalError(null);
    try {
      const response = await fetch(`/api/annales/${currentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error((data && data.error) || `HTTP ${response.status}`);
      onRenamed(data.id || newId);
      setEditing(false);
    } catch (e: any) {
      setLocalError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-input bg-warn-50 dark:bg-warn-950/40 border border-warn-100 dark:border-warn-700/50 px-3 py-2 text-xs text-warn-700 dark:text-warn-100 space-y-1.5">
      <div className="flex items-start gap-2 flex-wrap">
        <span className="flex-1 min-w-0">
          <AlertTriangle size={12} className="mr-1 inline -translate-y-px" />
          Publiée sous <code className="font-mono">{currentId}</code> (original <code className="font-mono">{originalId}</code> déjà pris).
        </span>
        {!editing && (
          <button onClick={startEdit} className="inline-flex items-center gap-1 font-medium hover:underline">
            <Pencil size={12} /> Renommer
          </button>
        )}
      </div>
      {editing && (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={draftValue}
            onChange={(e) => setDraftValue(slugify(e.target.value))}
            className="flex-1 min-w-[200px] px-2 py-1 rounded border border-warn-100 dark:border-warn-700/50 bg-input-background text-warn-950 dark:text-warn-100 font-mono text-xs"
            autoFocus
            disabled={busy}
          />
          <button onClick={submit} disabled={busy} className="px-2 py-1 rounded bg-warn-500 hover:bg-warn-700 text-white text-xs font-medium disabled:opacity-50">
            {busy ? '...' : 'Valider'}
          </button>
          <button onClick={cancel} disabled={busy} className="px-2 py-1 rounded text-warn-700 dark:text-warn-500 text-xs font-medium hover:underline disabled:opacity-50">
            Annuler
          </button>
        </div>
      )}
      {localError && <div className="text-danger-700 dark:text-danger-500">{localError}</div>}
    </div>
  );
}

// Composant: liste les warnings d'un bloc source en triant par severite (info masque par defaut)
function SourceBlockWarningsList({ warnings }: { warnings: SourceWarning[] }) {
  const errors = warnings.filter((w) => warningSeverity(w) === 'error');
  const warns = warnings.filter((w) => warningSeverity(w) === 'warning');
  const infos = warnings.filter((w) => warningSeverity(w) === 'info');
  const [showInfos, setShowInfos] = useState(false);
  return (
    <div className="space-y-1">
      {errors.map((warning, i) => (
        <div key={`e-${i}`} className="flex items-start gap-1.5 text-sm text-danger-700 dark:text-danger-500">
          <XCircle size={14} className="mt-0.5 shrink-0" />
          <span>{warning.message}{warning.accepted ? ' (validé)' : ''}</span>
        </div>
      ))}
      {warns.map((warning, i) => (
        <div key={`w-${i}`} className="flex items-start gap-1.5 text-sm text-warn-700 dark:text-warn-500">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{warning.message}{warning.accepted ? ' (validé)' : ''}</span>
        </div>
      ))}
      {infos.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowInfos((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            {showInfos ? 'Masquer' : 'Afficher'} {infos.length} info(s) mineure(s)
          </button>
          {showInfos && (
            <div className="mt-1 space-y-0.5 pl-3 border-l border-border">
              {infos.map((warning, i) => (
                <div key={`i-${i}`} className="text-xs text-muted-foreground">
                  ℹ️ {warning.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Composant: petite breakdown 3-niveaux pour la section "questions generees"
function ReportSeverityBreakdown({ report }: { report?: { warnings?: string[]; errors?: string[]; infos?: string[] } }) {
  const errs = report?.errors?.length || 0;
  const warns = report?.warnings?.length || 0;
  const infos = report?.infos?.length || 0;
  if (errs + warns + infos === 0) {
    return <div className="text-xs text-success-700 dark:text-success-500">Aucun probleme detecte.</div>;
  }
  return (
    <div className="text-xs text-muted-foreground flex flex-wrap gap-2 mt-0.5">
      {errs > 0 && <span className="text-danger-700 dark:text-danger-500 font-medium">{errs} erreur(s)</span>}
      {warns > 0 && <span className="text-warn-700 dark:text-warn-500 font-medium">{warns} warning(s)</span>}
      {infos > 0 && <span className="text-muted-foreground">{infos} info(s) masquee(s)</span>}
    </div>
  );
}

// Composant: liste detaillee des warnings/errors/infos (info collapsed)
function ReportDetailsList({ report }: { report?: { warnings?: string[]; errors?: string[]; infos?: string[] } }) {
  const errs = report?.errors || [];
  const warns = report?.warnings || [];
  const infos = report?.infos || [];
  const [showInfos, setShowInfos] = useState(false);
  if (errs.length + warns.length + infos.length === 0) return null;
  return (
    <div className="space-y-2 rounded-input border border-border p-3 bg-muted/50">
      {errs.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-xs font-[650] uppercase tracking-wider text-danger-700 dark:text-danger-500">{errs.length} Erreur(s) bloquante(s)</div>
          {errs.slice(0, 30).map((line, i) => (
            <div key={`e-${i}`} className="text-xs text-danger-700 dark:text-danger-500 pl-2 font-mono">· {line}</div>
          ))}
          {errs.length > 30 && <div className="text-[10px] text-muted-foreground pl-2">…{errs.length - 30} de plus masquees</div>}
        </div>
      )}
      {warns.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-xs font-[650] uppercase tracking-wider text-warn-700 dark:text-warn-500">{warns.length} Warning(s) a verifier</div>
          {warns.slice(0, 30).map((line, i) => (
            <div key={`w-${i}`} className="text-xs text-warn-700 dark:text-warn-500 pl-2 font-mono">· {line}</div>
          ))}
          {warns.length > 30 && <div className="text-[10px] text-muted-foreground pl-2">…{warns.length - 30} de plus masquees</div>}
        </div>
      )}
      {infos.length > 0 && (
        <div className="space-y-0.5">
          <button
            type="button"
            onClick={() => setShowInfos((v) => !v)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showInfos ? '▼' : '▶'} {infos.length} info(s) mineure(s) (variations lexicales, expectedAnswer vide, etc.)
          </button>
          {showInfos && infos.slice(0, 50).map((line, i) => (
            <div key={`i-${i}`} className="text-xs text-muted-foreground pl-2 font-mono">· {line}</div>
          ))}
          {showInfos && infos.length > 50 && <div className="text-[10px] text-muted-foreground pl-2">…{infos.length - 50} de plus masquees</div>}
        </div>
      )}
    </div>
  );
}

function QrocBatchPanel({
  items,
  busy,
  onOpenDraft,
  onClear,
  idSuffix,
  onApplySuffix,
}: {
  items: QrocBatchItem[];
  busy: boolean;
  onOpenDraft: (item: QrocBatchItem) => void;
  onClear: () => void;
  idSuffix?: string;
  onApplySuffix?: () => void;
}) {
  const enriched = items
    .map((item) => ({ item, display: batchDisplayStatus(item), technicalErrors: technicalBatchErrors(item) }))
    .sort((a, b) => a.display.bucket - b.display.bucket || a.item.title.localeCompare(b.item.title));
  const inProgress = enriched.filter(({ display }) => display.lane === 'inProgress').length;
  const queued = enriched.filter(({ display }) => display.lane === 'queued').length;
  const done = enriched.filter(({ display }) => display.lane === 'done').length;
  const failed = enriched.filter(({ display }) => display.lane === 'failed').length;
  const total = items.length;
  const finished = done + failed;
  const pctGlobal = total > 0 ? Math.round((finished * 100) / total) : 0;
  return (
    <div className="bg-card border border-border rounded-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-sm font-medium text-foreground">Batch QROC · {total} PDF(s)</div>
            <div className="text-xs font-medium text-muted-foreground">{finished} / {total} terminés ({pctGlobal}%)</div>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden mb-2">
            <div className="h-full transition-all bg-gradient-to-r from-brand-500 to-success-500" style={{ width: `${pctGlobal}%` }} />
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            {inProgress > 0 && (
              <span className="inline-flex items-center gap-1 text-brand-700 dark:text-brand-500 font-medium">
                <Loader2 size={12} className="animate-spin" />
                {inProgress} en cours chez DeepSeek
              </span>
            )}
            {queued > 0 && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Clock size={12} /> {queued} en attente
              </span>
            )}
            {done > 0 && (
              <span className="inline-flex items-center gap-1 text-success-700 dark:text-success-500">
                <CheckCircle2 size={12} /> {done} prêts à relire
              </span>
            )}
            {failed > 0 && (
              <span className="inline-flex items-center gap-1 text-danger-700 dark:text-danger-500 font-medium">
                <XCircle size={12} /> {failed} à corriger
              </span>
            )}
          </div>
        </div>
        <button onClick={onClear} disabled={busy} className="text-xs font-medium text-muted-foreground hover:text-danger-700 disabled:opacity-50 self-start">
          Masquer le suivi
        </button>
      </div>
      {idSuffix && onApplySuffix && (() => {
        const renamable = items.filter((item) => item.draftId && !item.annaleId.endsWith(`-${idSuffix}`));
        if (renamable.length === 0) return null;
        return (
          <div className="rounded-input border border-warn-100 dark:border-warn-700/50 bg-warn-50 dark:bg-warn-950/30 px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs text-warn-700 dark:text-warn-100">
              {renamable.length} brouillon(s) sans le suffixe <code className="font-mono">-{idSuffix}</code>. Applique-le pour eviter les collisions au publish.
            </div>
            <button
              onClick={onApplySuffix}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-input bg-warn-500 hover:bg-warn-700 text-white text-xs font-medium disabled:opacity-50"
            >
              Appliquer <code className="font-mono">-{idSuffix}</code> aux {renamable.length} brouillon(s)
            </button>
          </div>
        );
      })()}
      <div className="space-y-2">
        {enriched.map(({ item, display, technicalErrors }) => {
          const progress = item.job?.progress;
          const pct = progress?.total ? Math.round((progress.current * 100) / progress.total) : 0;
          const statusClass =
            display.tone === 'green' ? 'bg-success-100 text-success-700 dark:bg-success-950/40 dark:text-success-500'
            : display.tone === 'amber' ? 'bg-warn-100 text-warn-700 dark:bg-warn-950/40 dark:text-warn-100'
            : display.tone === 'red' ? 'bg-danger-100 text-danger-700 dark:bg-danger-950/40 dark:text-danger-500'
            : display.tone === 'neutral' ? 'bg-muted text-muted-foreground'
            : 'bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-100';
          return (
            <div key={item.key} className="rounded-card border border-border p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm text-foreground truncate">{item.title}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {item.fileName} · <code>{item.annaleId}</code>
                  </div>
                </div>
                <span className={`shrink-0 px-2 py-1 rounded-md text-[11px] font-medium ${statusClass} inline-flex items-center gap-1`}>
                  <display.icon size={12} className={display.spin ? 'animate-spin' : undefined} />
                  {display.label}
                </span>
              </div>
              {item.jobId && (
                <div className="space-y-1">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-brand-500 transition-all" style={{ width: `${Math.max(pct, item.status === 'queued' || item.status === 'running' ? 4 : 0)}%` }} />
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Job {item.jobId} · blocs {progress?.current ?? 0}/{progress?.total ?? item.sourceBlocks ?? '?'}
                    {progress?.activeBlockIds?.length ? ` · actifs : ${progress.activeBlockIds.join(', ')}` : ''}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs text-muted-foreground">
                  {item.sourceBlocks ?? 0} bloc(s) · {item.generatedQuestions ?? 0} question(s)
                  {item.error ? <span className="text-danger-700 dark:text-danger-500"> · {item.error}</span> : null}
                  {!item.error && technicalErrors.length > 0 ? <span className="text-warn-700 dark:text-warn-500"> · {technicalErrors.length} erreur(s) technique(s)</span> : null}
                </div>
                {item.draftId && (
                  <button onClick={() => onOpenDraft(item)} className="text-xs font-medium text-brand-700 dark:text-brand-500 hover:underline">
                    Ouvrir le brouillon
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuestionEditor({
  question,
  index,
  updateQuestion,
  deleteQuestion,
  updateOption,
  addOption,
  deleteOption,
  isQiSelectable,
  isQiSelected,
  onToggleSelect,
}: {
  question: GeneratedQuestion;
  index: number;
  updateQuestion: (patch: Partial<GeneratedQuestion>) => void;
  deleteQuestion: () => void;
  updateOption: (optionIndex: number, patch: Partial<GeneratedOption>) => void;
  addOption: () => void;
  deleteOption: (optionIndex: number) => void;
  isQiSelectable?: boolean;
  isQiSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const needsOptions = question.questionType === 'QRU' || question.questionType === 'QRM';
  const setOptionCorrect = (optionIndex: number, checked: boolean) => {
    if (question.questionType === 'QRU') {
      // QRU = exactement une bonne réponse. On réécrit TOUT le tableau en une seule
      // mise à jour : un forEach de updateOption lit un état périmé (closure) et seule
      // la dernière itération survit → la coche ne "prenait" pas.
      updateQuestion({ options: (question.options || []).map((o, idx) => ({ ...o, correct: idx === optionIndex })) });
      return;
    }
    updateOption(optionIndex, { correct: checked });
  };
  return (
    <div className={`rounded-card border p-4 space-y-3 ${isQiSelected ? 'border-brand-500 dark:border-brand-700 bg-brand-50/40 dark:bg-brand-950/30' : 'border-border'}`}>
      <div className="flex items-center gap-2">
        {isQiSelectable && onToggleSelect && (
          <input
            type="checkbox"
            checked={!!isQiSelected}
            onChange={onToggleSelect}
            title="Sélectionner pour regroupement en DP"
            aria-label="Sélectionner cette question QI pour regroupement"
            className="h-4 w-4 cursor-pointer accent-indigo-600"
          />
        )}
        <span className="font-mono text-xs text-muted-foreground">Q{index + 1}</span>
        <select value={question.questionType} onChange={(e) => updateQuestion({ questionType: e.target.value as GeneratedQuestion['questionType'] })} className={`${inputClass} w-28`}>
          <option value="QRU">QRU</option>
          <option value="QRM">QRM</option>
          <option value="QROC">QROC</option>
        </select>
        <select
          value={question.seriesFormat || ''}
          onChange={(e) => updateQuestion({ seriesFormat: (e.target.value || null) as GeneratedQuestion['seriesFormat'], seriesId: e.target.value ? (question.seriesId || `dp-${index + 1}`) : null })}
          className={`${inputClass} w-28`}
        >
          <option value="">QI</option>
          <option value="DP">DP</option>
          <option value="KFP">KFP</option>
        </select>
        {question.answerSource === 'ai' && (
          <button
            type="button"
            onClick={() => updateQuestion({ answerSource: 'source' })}
            className="inline-flex items-center gap-1 rounded-full bg-warn-100 dark:bg-warn-950/40 px-2 py-0.5 text-xs font-medium text-warn-700 dark:text-warn-100 hover:bg-warn-50 dark:hover:bg-warn-950/60"
            title="Réponse générée par l'IA (corrigé absent du PDF). Clique pour la marquer comme vérifiée."
          >
            <Sparkles size={12} /> IA — à vérifier
          </button>
        )}
        <button onClick={deleteQuestion} className="ml-auto p-2 rounded-input text-muted-foreground hover:text-danger-700 hover:bg-danger-50 dark:hover:bg-danger-950/30" title="Supprimer">
          <Trash2 size={16} />
        </button>
      </div>
      {question.seriesFormat && (
        <div className="grid md:grid-cols-3 gap-2">
          <input value={question.seriesId || ''} onChange={(e) => updateQuestion({ seriesId: e.target.value })} className={inputClass} placeholder="seriesId" />
          <input value={question.customTitle || ''} onChange={(e) => updateQuestion({ customTitle: e.target.value })} className={inputClass} placeholder="Titre dossier" />
          <input value={question.image || ''} onChange={(e) => updateQuestion({ image: e.target.value || null })} className={inputClass} placeholder="image optionnelle" />
        </div>
      )}
      {question.seriesFormat && (
        <textarea value={question.vignette || ''} onChange={(e) => updateQuestion({ vignette: e.target.value })} className={`${textAreaClass} min-h-[80px]`} placeholder="Vignette cumulative" />
      )}
      <textarea value={question.text} onChange={(e) => updateQuestion({ text: e.target.value })} className={textAreaClass} placeholder="Enonce" />
      {needsOptions && (
        <div className="space-y-2">
          {(question.options || []).map((option, optionIndex) => (
            <div key={`${option.id}-${optionIndex}`} className="grid grid-cols-[54px_1fr_80px_36px] gap-2 items-center">
              <input value={option.id} onChange={(e) => updateOption(optionIndex, { id: e.target.value.toUpperCase() })} className={`${inputClass} text-center font-mono`} />
              <input value={option.text} onChange={(e) => updateOption(optionIndex, { text: e.target.value })} className={inputClass} placeholder="Proposition" />
              <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <input type={question.questionType === 'QRU' ? 'radio' : 'checkbox'} checked={option.correct} onChange={(e) => setOptionCorrect(optionIndex, e.target.checked)} />
                Vrai
              </label>
              <button onClick={() => deleteOption(optionIndex)} className="p-2 rounded-input text-muted-foreground hover:text-danger-700 hover:bg-danger-50 dark:hover:bg-danger-950/30">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button onClick={addOption} disabled={(question.options || []).length >= 15} className="inline-flex items-center gap-1 text-sm text-brand-700 dark:text-brand-500 disabled:text-muted-foreground">
            <Plus size={14} /> Ajouter une option
          </button>
        </div>
      )}
      {question.questionType === 'QROC' && (
        <textarea value={question.expectedAnswer || ''} onChange={(e) => updateQuestion({ expectedAnswer: e.target.value })} className={`${textAreaClass} min-h-[80px]`} placeholder="Reponse attendue" />
      )}
      <textarea value={question.correctionText || ''} onChange={(e) => updateQuestion({ correctionText: e.target.value })} className={`${textAreaClass} min-h-[90px]`} placeholder="Correction" />
      <textarea value={(question.sourceRefs || []).join('\n')} onChange={(e) => updateQuestion({ sourceRefs: e.target.value.split('\n').filter(Boolean) })} className={`${textAreaClass} min-h-[70px] font-mono text-xs`} placeholder="Extraits source, un par ligne" />
      {question.warnings && question.warnings.length > 0 && (
        <div className="text-xs text-warn-700 dark:text-warn-500">{question.warnings.join(' - ')}</div>
      )}
    </div>
  );
}

function RegroupDialog({
  count,
  form,
  setForm,
  error,
  onCancel,
  onConfirm,
}: {
  count: number;
  form: { title: string; vignette: string; format: 'DP' | 'KFP' };
  setForm: (f: { title: string; vignette: string; format: 'DP' | 'KFP' }) => void;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="regroup-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-card border border-border bg-card p-6 shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="regroup-dialog-title" className="text-base font-[650] text-foreground flex items-center gap-2">
            <GitMerge size={18} className="text-brand-700 dark:text-brand-500" />
            Regrouper {count} questions
          </h2>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-input text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Fermer"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Les questions sélectionnées vont être rattachées à un nouveau dossier clinique partagé.
          La vignette ne sera portée que par la première question (ordre du draft).
        </p>
        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
              Format
            </span>
            <select
              value={form.format}
              onChange={(e) => setForm({ ...form, format: e.target.value as 'DP' | 'KFP' })}
              className={`mt-1 ${inputClass} w-32`}
            >
              <option value="DP">DP</option>
              <option value="KFP">KFP</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
              Titre du dossier
            </span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex : Insuffisance cardiaque chez Mme X"
              autoFocus
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
              Vignette clinique (min 20 caractères)
            </span>
            <textarea
              value={form.vignette}
              onChange={(e) => setForm({ ...form, vignette: e.target.value })}
              placeholder="Énoncé clinique partagé par les questions de la série"
              className={`mt-1 ${textAreaClass} min-h-[140px]`}
            />
            <span className="text-[10px] text-muted-foreground mt-0.5 block">
              {(form.vignette || '').trim().length} / min 20 caractères
            </span>
          </label>
        </div>
        {error && (
          <div className="text-xs text-danger-700 dark:text-danger-500">{error}</div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-input text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Annuler
          </button>
          <button
            onClick={onConfirm}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-input bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            <GitMerge size={15} />
            Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}

function JobStatus({ job, onCancel, generatedSoFar }: { job: QrocJob; onCancel: () => void; generatedSoFar: number }) {
  const progress = job.progress;
  const total = progress?.total || 0;
  const current = progress?.current || 0;
  const pct = total ? Math.round((current * 100) / total) : 0;
  const phase = progress?.phase || 'pending';
  const activeBlockIds = progress?.activeBlockIds || [];
  const isActive = ['queued', 'running', 'generating', 'checking'].includes(job.status);
  const canCancel = !['done', 'done-with-errors', 'error', 'cancelled', 'interrupted'].includes(job.status);

  // Chrono live depuis updatedAt — re-render toutes les secondes
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isActive) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isActive]);
  const since = job.updatedAt ? Math.max(0, Math.round((now - Date.parse(job.updatedAt)) / 1000)) : 0;
  const elapsedTotal = job.createdAt ? Math.max(0, Math.round((now - Date.parse(job.createdAt)) / 1000)) : 0;
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m${String(r).padStart(2, '0')}s` : `${r}s`;
  };

  const phaseLabel: Record<string, string> = {
    pending: 'En file d\'attente',
    running: 'Blocs traites en parallele',
    generating: 'DeepSeek génère les questions',
    checking: 'DeepSeek relit / contrôle qualité',
    done: 'Bloc terminé',
    blocked: 'Bloqué (warnings non résolus)',
    cancelled: 'Annule',
  };

  const isFinal = ['done', 'done-with-errors', 'error', 'cancelled', 'interrupted'].includes(job.status);
  const statusColors: Record<string, string> = {
    done: 'text-success-700 dark:text-success-500',
    'done-with-errors': 'text-warn-700 dark:text-warn-500',
    error: 'text-danger-700 dark:text-danger-500',
    cancelled: 'text-muted-foreground',
    interrupted: 'text-warn-700 dark:text-warn-500',
  };
  const statusClass = statusColors[job.status] || 'text-brand-700 dark:text-brand-500';

  return (
    <div className="rounded-card border border-border p-4 text-sm space-y-3 bg-card">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {isActive ? <Loader2 size={16} className="animate-spin text-brand-700 dark:text-brand-500" /> : <CheckCircle2 size={16} className={statusClass} />}
          <span className={`font-medium ${statusClass}`}>
            {isFinal ? `Job ${job.status}` : `Job en cours : ${job.status}`}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">Bloc {current}/{total || '?'} · {pct}%</span>
      </div>

      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full transition-all ${isActive ? 'bg-brand-500 animate-pulse' : 'bg-brand-600'}`} style={{ width: `${Math.max(pct, isActive ? 4 : 0)}%` }} />
      </div>

      {isActive && (
        <div className="rounded-input bg-brand-50 dark:bg-brand-950/30 border border-brand-100 dark:border-brand-700/50 p-3 text-xs space-y-1.5">
          <div className="font-medium text-brand-950 dark:text-brand-100 flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            {phaseLabel[phase] || phase}
            {activeBlockIds.length > 0
              ? ` · blocs actifs : ${activeBlockIds.join(', ')}`
              : progress?.currentBlockId ? ` · ${progress.currentBlockId}` : ''}
          </div>
          <div className="text-brand-700 dark:text-brand-100">
            DeepSeek travaille depuis <strong>{fmt(since)}</strong> sur l'etape courante — total écoulé : {fmt(elapsedTotal)}.
          </div>
          <div className="text-brand-700/80 dark:text-brand-500/80">
            Le serveur peut traiter plusieurs blocs en parallele, avec une limite globale pour eviter de taper trop fort sur DeepSeek.
          </div>
          {generatedSoFar > 0 && (
            <div className="text-brand-700 dark:text-brand-100">
              <strong>{generatedSoFar}</strong> question(s) déjà écrites dans le brouillon.
            </div>
          )}
        </div>
      )}

      {isFinal && (
        <div className="text-xs text-muted-foreground">
          Phase finale : {phase} · durée totale : {fmt(elapsedTotal)}
        </div>
      )}

      {job.errors && job.errors.length > 0 && (
        <div className="text-xs text-danger-700 dark:text-danger-500 space-y-0.5">
          {job.errors.slice(0, 5).map((e, i) => <div key={i}>· {e}</div>)}
        </div>
      )}
      {job.warnings && job.warnings.length > 0 && (
        <div className="text-xs text-warn-700 dark:text-warn-500 space-y-0.5">
          {job.warnings.slice(0, 3).map((e, i) => <div key={i}>· {e}</div>)}
        </div>
      )}

      {canCancel && (
        <button onClick={onCancel} className="text-xs font-medium text-danger-700 dark:text-danger-500 hover:underline">
          Annuler le job
        </button>
      )}
    </div>
  );
}

function PdfDropZone({
  fileLabel,
  allowMultiple,
  isDragging,
  setIsDragging,
  handleFiles,
}: {
  fileLabel: string;
  allowMultiple: boolean;
  isDragging: boolean;
  setIsDragging: (value: boolean) => void;
  handleFiles: (files: File[]) => void;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(Array.from(e.dataTransfer.files || []));
      }}
      className={`border-2 border-dashed rounded-card bg-card p-8 transition-colors ${
        isDragging ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/30' : 'border-border'
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-card bg-brand-100 dark:bg-brand-950/40 text-brand-700 dark:text-brand-100 flex items-center justify-center shrink-0">
          <Upload size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground mb-1">{fileLabel}</div>
          <p className="text-sm text-muted-foreground mb-4">
            {allowMultiple ? 'Depose un ou plusieurs PDFs, ou selectionne-les depuis Windows.' : 'Depose le PDF ou selectionne-le depuis Windows.'}
          </p>
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-input bg-foreground text-background text-sm font-medium cursor-pointer hover:opacity-90">
            <FileText size={16} />
            {allowMultiple ? 'Choisir des PDFs' : 'Choisir un PDF'}
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple={allowMultiple}
              className="hidden"
              onChange={(e) => handleFiles(Array.from(e.target.files || []))}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function MetaFields(props: {
  subject: string;
  setSubject: (v: string) => void;
  year: string;
  setYear: (v: string) => void;
  session: string;
  setSession: (v: string) => void;
  title: string;
  setTitle: (v: string) => void;
  annaleId: string;
  setAnnaleId: (v: string) => void;
  overwrite: boolean;
  setOverwrite: (v: boolean) => void;
  idSuffix: string;
  setIdSuffix: (v: string) => void;
  showSuffix: boolean;
}) {
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Matiere">
          <input value={props.subject} onChange={(e) => props.setSubject(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Annee">
          <input value={props.year} onChange={(e) => props.setYear(e.target.value)} className={inputClass} inputMode="numeric" />
        </Field>
      </div>
      <Field label="Session">
        <input value={props.session} onChange={(e) => props.setSession(e.target.value)} className={inputClass} placeholder="S1, S2..." />
      </Field>
      <Field label="Titre">
        <input value={props.title} onChange={(e) => props.setTitle(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Identifiant">
        <input value={props.annaleId} onChange={(e) => props.setAnnaleId(slugify(e.target.value))} className={`${inputClass} font-mono`} />
      </Field>
      {props.showSuffix && (
        <Field label="Suffixe ID (batch · evite les collisions)">
          <input
            value={props.idSuffix}
            onChange={(e) => props.setIdSuffix(slugify(e.target.value))}
            className={`${inputClass} font-mono`}
            placeholder="v2, bis, newprompt..."
          />
          {props.idSuffix && (
            <div className="text-[11px] text-muted-foreground mt-1">
              Tous les IDs deviendront : <code>{`<auto>-${props.idSuffix}`}</code>
            </div>
          )}
        </Field>
      )}
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={props.overwrite} onChange={(e) => props.setOverwrite(e.target.checked)} className="rounded border-input text-brand-600 focus:ring-ring" />
        Remplacer si l'annale existe deja
      </label>
    </>
  );
}

function AutreImportPanel({
  file,
  meta,
  setPageError,
  onOpenPublished,
  onResetAll,
}: {
  file: File | null;
  meta: ImportMeta;
  setPageError: (error: string | null) => void;
  onOpenPublished: (url: string) => void;
  onResetAll: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-v4-flash');
  const [mock, setMock] = useState(false);
  const [draft, setDraft] = useState<QrocDraft | null>(null);
  const [job, setJob] = useState<QrocJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<QrocPublishedInfo | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const AUTRE_STORAGE_KEY = 'hypocampus_autre_session';

  const refreshDrafts = async () => {
    try {
      const response = await fetch('/api/annales/drafts');
      if (!response.ok) return;
      const all = await response.json() as DraftSummary[];
      // Tolérant : on montre les brouillons non publiés sauf ceux explicitement issus du
      // workspace QROC (profile 'qroc'). Avant redémarrage serveur, profile est absent →
      // on les montre quand même pour que les brouillons orphelins restent récupérables.
      setDrafts(all.filter((d) => d.status !== 'published' && d.profile !== 'qroc'));
    } catch {}
  };
  useEffect(() => { refreshDrafts(); }, []);

  useEffect(() => {
    const savedKey = localStorage.getItem('hypocampus_deepseek_key');
    if (savedKey) setApiKey(savedKey);
  }, []);
  useEffect(() => {
    if (apiKey) localStorage.setItem('hypocampus_deepseek_key', apiKey);
  }, [apiKey]);

  // Reprise au montage : recharge un brouillon d'import laissé en cours (après refresh)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = localStorage.getItem(AUTRE_STORAGE_KEY);
      if (!raw) return;
      try {
        const saved = JSON.parse(raw);
        if (!saved?.draftId) return;
        const draftResponse = await fetch(`/api/annales/drafts/${saved.draftId}`);
        if (cancelled) return;
        if (!draftResponse.ok) { localStorage.removeItem(AUTRE_STORAGE_KEY); return; }
        const draftData = await draftResponse.json();
        if (draftData.status === 'published' || draftData.profile !== 'faithful') {
          localStorage.removeItem(AUTRE_STORAGE_KEY);
          return;
        }
        setDraft(draftData);
        if (saved.jobId) {
          const jobResponse = await fetch(`/api/annales/convert-qroc/jobs/${saved.jobId}`);
          if (jobResponse.ok && !cancelled) setJob(await jobResponse.json());
        }
      } catch { localStorage.removeItem(AUTRE_STORAGE_KEY); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persiste {draftId, jobId} pour pouvoir reprendre après un refresh (jamais de remove ici → pas de race au montage)
  useEffect(() => {
    if (!draft && !job) return;
    try {
      localStorage.setItem(AUTRE_STORAGE_KEY, JSON.stringify({ draftId: draft?.id || job?.draftId || null, jobId: job?.id || null }));
    } catch {}
  }, [draft, job]);

  // Polling du job : rafraîchit l'état + le brouillon en cours (compteur live), puis charge le final
  useEffect(() => {
    if (!job || isTerminalJobStatus(job.status)) return;
    let tick = 0;
    const id = window.setInterval(async () => {
      tick += 1;
      const response = await fetch(`/api/annales/convert-qroc/jobs/${job.id}`);
      const next = await response.json();
      setJob(next);
      // Final → charge le brouillon ; sinon rafraîchit périodiquement pour le compteur live
      if (isTerminalJobStatus(next.status) || tick % 4 === 0) {
        const draftResponse = await fetch(`/api/annales/drafts/${next.draftId}`);
        if (draftResponse.ok) setDraft(await draftResponse.json());
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [job]);

  const cancelJob = async () => {
    if (!job) return;
    const response = await fetch(`/api/annales/convert-qroc/jobs/${job.id}/cancel`, { method: 'POST' });
    const data = await response.json().catch(() => null);
    if (response.ok) setJob(data);
  };

  // Abandonne l'import en cours : annule le job, supprime le brouillon, réinitialise.
  const cancelImport = async () => {
    const draftId = draft?.id || job?.draftId;
    setBusy(true);
    try {
      if (job && !isTerminalJobStatus(job.status)) {
        try { await fetch(`/api/annales/convert-qroc/jobs/${job.id}/cancel`, { method: 'POST' }); } catch {}
      }
      if (draftId) {
        try { await fetch(`/api/annales/drafts/${draftId}`, { method: 'DELETE' }); } catch {}
      }
    } finally {
      try { localStorage.removeItem(AUTRE_STORAGE_KEY); } catch {}
      setDraft(null);
      setJob(null);
      setPublished(null);
      setPageError(null);
      setBusy(false);
      refreshDrafts();
    }
  };

  // Reprend un brouillon depuis la liste (génération déjà faite → on relit les questions)
  const openDraft = async (id: string) => {
    setBusy(true);
    setPageError(null);
    try {
      const response = await fetch(`/api/annales/drafts/${id}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      setJob(null);
      setDraft(data as QrocDraft);
    } catch (e: any) {
      setPageError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteDraft = async (id: string) => {
    try { await fetch(`/api/annales/drafts/${id}`, { method: 'DELETE' }); } catch {}
    refreshDrafts();
  };

  const runImport = async () => {
    setPageError(null);
    setPublished(null);
    setDraft(null);
    setJob(null);
    if (!file) { setPageError('PDF manquant.'); return; }
    if (!meta.subject || !meta.title || !meta.annaleId || !meta.year) { setPageError('Métadonnées incomplètes.'); return; }
    if (!mock && !apiKey.trim()) { setPageError('Clé API DeepSeek manquante.'); return; }
    setBusy(true);
    try {
      const pdfBase64 = await readFileAsBase64(file);
      const extractResponse = await fetch('/api/annales/convert-qroc/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...meta, pdfBase64, profile: 'faithful' }),
      });
      const extractData = await extractResponse.json().catch(() => null);
      if (!extractResponse.ok) throw new Error(extractData?.error || `HTTP ${extractResponse.status}`);
      const newDraft = extractData.draft as QrocDraft;
      setDraft(newDraft);
      const generateResponse = await fetch(`/api/annales/convert-qroc/drafts/${newDraft.id}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, model, mock, skipQa: true }),
      });
      const generateData = await generateResponse.json().catch(() => null);
      if (!generateResponse.ok) throw new Error(generateData?.error || `HTTP ${generateResponse.status}`);
      const newJobId = generateData?.jobId ?? generateData?.id;
      if (!newJobId) throw new Error('Réponse de génération invalide (jobId manquant).');
      setJob({ ...generateData, id: newJobId } as QrocJob);
    } catch (e: any) {
      setPageError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const updateQuestion = (index: number, patch: Partial<GeneratedQuestion>) => {
    if (!draft) return;
    const generatedQuestions = [...draft.generatedQuestions];
    generatedQuestions[index] = { ...generatedQuestions[index], ...patch };
    setDraft({ ...draft, generatedQuestions });
  };
  const deleteQuestion = (index: number) => {
    if (!draft) return;
    setDraft({ ...draft, generatedQuestions: draft.generatedQuestions.filter((_, i) => i !== index) });
  };
  const updateOption = (questionIndex: number, optionIndex: number, patch: Partial<GeneratedOption>) => {
    if (!draft) return;
    const options = [...(draft.generatedQuestions[questionIndex].options || [])];
    options[optionIndex] = { ...options[optionIndex], ...patch };
    updateQuestion(questionIndex, { options });
  };
  const addOption = (questionIndex: number) => {
    if (!draft) return;
    const options = [...(draft.generatedQuestions[questionIndex].options || [])];
    if (options.length >= 15) return;
    options.push({ id: nextOptionId(options), text: '', correct: false });
    updateQuestion(questionIndex, { options });
  };
  const deleteOption = (questionIndex: number, optionIndex: number) => {
    if (!draft) return;
    updateQuestion(questionIndex, { options: (draft.generatedQuestions[questionIndex].options || []).filter((_, i) => i !== optionIndex) });
  };

  const publish = async () => {
    if (!draft) return;
    setBusy(true);
    setPageError(null);
    try {
      const patchResponse = await fetch(`/api/annales/drafts/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta: draft.meta, generatedQuestions: draft.generatedQuestions }),
      });
      const patched = await patchResponse.json().catch(() => null);
      if (!patchResponse.ok) throw new Error(patched?.error || `HTTP ${patchResponse.status}`);
      const publishResponse = await fetch(`/api/annales/drafts/${draft.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwrite: meta.overwrite, force: false }),
      });
      const publishData = await publishResponse.json().catch(() => null);
      if (!publishResponse.ok) throw new Error(publishData?.error || `HTTP ${publishResponse.status}`);
      setPublished({
        redirectTo: publishData.redirectTo,
        title: (draft.meta as any)?.title || draft.id,
        questionsCount: (publishData.annale?.questionsCount as number | undefined) ?? (draft.generatedQuestions?.length || 0),
        annaleId: (publishData.annale?.id as string | undefined) || '',
        originalAnnaleId: publishData.originalAnnaleId,
        autoRenamed: !!publishData.autoRenamed,
      });
      try { localStorage.removeItem(AUTRE_STORAGE_KEY); } catch {}
      setDraft(null);
      setJob(null);
      refreshDrafts();
    } catch (e: any) {
      setPageError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const generating = !!job && !isTerminalJobStatus(job.status);
  const questions = draft?.generatedQuestions || [];
  const aiCount = questions.filter((q) => q.answerSource === 'ai').length;
  // Validation live : une QRU doit avoir exactement 1 bonne réponse, une QRM au moins 1.
  const questionIssues = questions
    .map((q, i) => {
      if (q.questionType !== 'QRU' && q.questionType !== 'QRM') return null;
      const opts = q.options || [];
      const correct = opts.filter((o) => o.correct).length;
      if (opts.length === 0) return { n: i + 1, msg: 'sans options' };
      if (q.questionType === 'QRU' && correct !== 1) return { n: i + 1, msg: correct === 0 ? 'bonne réponse non cochée' : `${correct} cochées (QRU = 1)` };
      if (q.questionType === 'QRM' && correct < 1) return { n: i + 1, msg: 'bonne réponse non cochée' };
      return null;
    })
    .filter(Boolean) as { n: number; msg: string }[];

  if (published) {
    return (
      <div className="rounded-card bg-card border border-border p-5">
        <div className="rounded-card bg-success-50 dark:bg-success-950/30 border border-success-100 dark:border-success-700/50 text-success-950 dark:text-success-100 p-4 text-sm space-y-3">
          <div className="flex gap-2 font-medium"><CheckCircle2 size={18} />{published.questionsCount} questions publiées · {published.title}</div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={() => onOpenPublished(published.redirectTo)} className="inline-flex items-center gap-2 px-4 py-2 rounded-input bg-success-700 hover:bg-success-500 text-white font-medium">Ouvrir l'annale</button>
            <button onClick={() => { setPublished(null); onResetAll(); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-input border border-success-100 bg-card/60 text-success-700 dark:border-success-700/50 dark:text-success-100 font-medium">Importer un autre PDF</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card bg-card border border-border p-5 space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Clé API DeepSeek</span>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={inputClass} placeholder="sk-..." />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Modèle</span>
          <select value={model} onChange={(e) => setModel(e.target.value)} className={inputClass}>
            <option value="deepseek-v4-flash">deepseek-v4-flash</option>
            <option value="deepseek-v4-pro">deepseek-v4-pro</option>
          </select>
        </label>
      </div>
      <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={mock} onChange={(e) => setMock(e.target.checked)} />
        Mode mock (sans appel API, pour tester)
      </label>
      {!draft && !job ? (
        <button
          onClick={runImport}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-input bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium shadow-sm transition-all duration-150 active:scale-95"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
          {busy ? 'Traitement…' : 'Importer (Autre)'}
        </button>
      ) : (
        <button
          onClick={cancelImport}
          disabled={busy}
          title="Annuler cet import et supprimer le brouillon"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-input border border-danger-100 text-danger-700 hover:bg-danger-50 dark:border-danger-700/50 dark:text-danger-500 dark:hover:bg-danger-950/30 disabled:opacity-60 text-sm font-medium"
        >
          <X size={16} /> {generating ? 'Annuler la génération' : "Annuler l'import"}
        </button>
      )}

      {!draft && !job && drafts.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Brouillons d'import en cours ({drafts.length})</div>
          {drafts.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 rounded-input border border-border px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{d.title}</div>
                <div className="text-xs text-muted-foreground">
                  {d.generatedQuestions} question(s) · {d.sourceBlocks} bloc(s)
                  {d.updatedAt ? ` · ${new Date(d.updatedAt).toLocaleString('fr-FR')}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => openDraft(d.id)} disabled={busy} className="px-3 py-1.5 rounded-input bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white text-xs font-medium">Reprendre</button>
                <button onClick={() => deleteDraft(d.id)} disabled={busy} title="Supprimer ce brouillon" className="p-1.5 rounded-input text-muted-foreground hover:text-danger-700 hover:bg-danger-50 dark:hover:bg-danger-950/30"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {job && (
        <JobStatus job={job} onCancel={cancelJob} generatedSoFar={questions.length} />
      )}

      {job && isTerminalJobStatus(job.status) && questions.length === 0 && (
        <div className="text-sm text-warn-700 dark:text-warn-500">
          Aucune question générée. {(job.errors || []).slice(0, 2).join(' · ')}
        </div>
      )}

      {questions.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-muted-foreground">
              {questions.length} questions détectées
              {aiCount > 0 && <span className="ml-2 text-warn-700 dark:text-warn-500">· {aiCount} corrigé(s) IA à vérifier</span>}
            </div>
            <button
              onClick={publish}
              disabled={busy || questionIssues.length > 0}
              title={questionIssues.length > 0 ? 'Coche la bonne réponse des questions signalées avant de publier' : undefined}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-input bg-success-700 hover:bg-success-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium"
            >
              <Save size={15} /> Publier
            </button>
          </div>
          {questionIssues.length > 0 && (
            <div className="rounded-input border border-warn-100 dark:border-warn-700/60 bg-warn-50 dark:bg-warn-950/30 px-3 py-2 text-xs text-warn-700 dark:text-warn-100">
              <strong>{questionIssues.length} question(s) à compléter</strong> avant publication — coche la bonne réponse dans la carte :
              <div className="mt-1 font-medium">{questionIssues.map((x) => `Q${x.n} (${x.msg})`).join(' · ')}</div>
            </div>
          )}
          <div className="space-y-4">
            {questions.map((question, questionIndex) => {
              const hasIssue = questionIssues.some((x) => x.n === questionIndex + 1);
              return (
                <div key={`${question.id}-${questionIndex}`} className={hasIssue ? 'rounded-card ring-2 ring-warn-500' : ''}>
                  <QuestionEditor
                    question={question}
                    index={questionIndex}
                    updateQuestion={(patch) => updateQuestion(questionIndex, patch)}
                    deleteQuestion={() => deleteQuestion(questionIndex)}
                    updateOption={(optionIndex, patch) => updateOption(questionIndex, optionIndex, patch)}
                    addOption={() => addOption(questionIndex)}
                    deleteOption={(optionIndex) => deleteOption(questionIndex, optionIndex)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function LocalExplainer() {
  return (
    <div className="bg-card border border-border rounded-card p-5 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ScanText size={16} className="text-brand-700 dark:text-brand-500" />
        Faculté
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Pour les PDF au format correction UNESS avec cases cochees. Aucun appel API : le document determine les questions, les bonnes reponses et les images.
      </p>
    </div>
  );
}

function AutreExplainer() {
  return (
    <div className="bg-card border border-border rounded-card p-5 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Sparkles size={16} className="text-brand-700 dark:text-brand-500" />
        Autre PDF
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Pour les PDF varies (hors format UNESS/QROC). Decoupage local, puis DeepSeek transcrit fidelement chaque question en detectant son type, sans melanger les questions. Si le PDF n'a pas de corrige, il est genere par IA (a verifier). Tu relis avant publication.
      </p>
    </div>
  );
}

function QrocExplainer() {
  return (
    <div className="bg-card border border-border rounded-card p-5 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Sparkles size={16} className="text-brand-700 dark:text-brand-500" />
        Conversion QROC
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Le PDF corrige est decoupe localement en blocs QROC. Tu peux corriger le decoupage, puis DeepSeek genere un brouillon DP/QI/KFP que tu relis et modifies avant publication.
      </p>
    </div>
  );
}

function ImportSuccess({ result, onOpen, onReset, onRenamed }: { result: ImportResult; onOpen: () => void; onReset: () => void; onRenamed?: (newId: string) => void }) {
  return (
    <div className="rounded-card bg-success-50 dark:bg-success-950/30 border border-success-100 dark:border-success-700/50 text-success-950 dark:text-success-100 p-4 text-sm space-y-3">
      <div className="flex gap-2 font-medium">
        <CheckCircle2 size={18} />
        {result.annale.questionsCount} questions importees · {result.annale.title}
      </div>
      <div className="text-success-700 dark:text-success-500">
        {result.pages} pages, {result.textChars.toLocaleString('fr-FR')} caracteres extraits.
      </div>
      {result.report && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-input bg-card/60 p-2">
            DP/KFP : {result.report.series.map((s) => `${s.id}=${s.total}`).join(', ') || 'aucun'}
          </div>
          <div className="rounded-input bg-card/60 p-2">
            QI : {result.report.qiCount} - Images : {result.report.imagesWritten ?? result.report.imagesAttached}
          </div>
        </div>
      )}
      {result.warnings && result.warnings.length > 0 && (
        <div className="text-warn-700 dark:text-warn-500">{result.warnings.slice(0, 3).join(' - ')}</div>
      )}
      {result.autoRenamed && result.originalAnnaleId && onRenamed && (
        <AutoRenamedNotice
          currentId={result.annale.id}
          originalId={result.originalAnnaleId}
          onRenamed={onRenamed}
        />
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button onClick={onOpen} className="inline-flex items-center gap-2 px-4 py-2 rounded-input bg-success-700 hover:bg-success-500 text-white font-medium">
          Ouvrir l'annale
        </button>
        <button onClick={onReset} className="inline-flex items-center gap-2 px-4 py-2 rounded-input border border-success-100 dark:border-success-700/50 bg-card/60 text-success-700 dark:text-success-100 hover:bg-card font-medium">
          Importer une autre annale
        </button>
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-card bg-danger-50 dark:bg-danger-950/30 border border-danger-100 dark:border-danger-700/50 text-danger-700 dark:text-danger-500 p-3 text-sm flex gap-2">
      <AlertTriangle size={17} className="shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
