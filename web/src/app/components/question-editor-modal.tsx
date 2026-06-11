import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { X, Save, Loader2, AlertTriangle } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { Checkbox } from './ui/checkbox';

// Note : on type minimal pour ne pas dépendre du type front PlayAnnale qui
// strip les champs `correct`/`expectedAnswer`. Ici on lit directement le JSON
// brut côté serveur (data/annales/<id>.json) via une route de détail "admin".
// Pour l'instant on utilise GET /api/annales/<id> qui est stripé : on charge
// donc séparément les champs admin via un PATCH dry-run pour récupérer l'état.
// Solution pragmatique : on demande au caller de fournir la `question` déjà
// chargée (depuis admin-corrections-page qui aura fait le fetch).

export interface EditableQuestion {
  id: string;
  questionType: 'QRU' | 'QRM' | 'QROC' | 'ZONE';
  text: string;
  vignette?: string | null;
  correctionText?: string | null;
  expectedAnswer?: string | null;
  customTitle?: string | null;
  options?: Array<{ id: string; text: string; correct?: boolean }>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  annaleId: string;
  question: EditableQuestion | null;
  /** Note du signalement / extrait auto pour contexte de la correction */
  contextNote?: string | null;
  /** Appelé après PATCH réussi (live, pas dry-run) */
  onSaved?: () => void;
}

interface DryRunResult {
  wouldChange: boolean;
  changedFields: string[];
  sessionsImpacted: number;
}

export function QuestionEditorModal({ open, onOpenChange, annaleId, question, contextNote, onSaved }: Props) {
  const [text, setText] = useState('');
  const [vignette, setVignette] = useState('');
  const [correctionText, setCorrectionText] = useState('');
  const [expectedAnswer, setExpectedAnswer] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [options, setOptions] = useState<Array<{ id: string; text: string; correct: boolean }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);

  // Reset form quand la question change
  useEffect(() => {
    if (!question) return;
    setText(question.text || '');
    setVignette(question.vignette || '');
    setCorrectionText(question.correctionText || '');
    setExpectedAnswer(question.expectedAnswer || '');
    setCustomTitle(question.customTitle || '');
    setOptions(
      (question.options || []).map((o) => ({
        id: o.id,
        text: o.text || '',
        correct: !!o.correct,
      })),
    );
    setDryRun(null);
    setConfirmStep(false);
  }, [question]);

  const buildPayload = useCallback(() => {
    if (!question) return {};
    const payload: Record<string, any> = {};
    if (text !== (question.text || '')) payload.text = text;
    if (vignette !== (question.vignette || '')) payload.vignette = vignette;
    if (correctionText !== (question.correctionText || '')) payload.correctionText = correctionText;
    if (expectedAnswer !== (question.expectedAnswer || '')) payload.expectedAnswer = expectedAnswer;
    if (customTitle !== (question.customTitle || '')) payload.customTitle = customTitle;
    if (question.options && question.options.length > 0) {
      const optsChanged = options.some((o, i) => {
        const orig = question.options![i];
        return o.text !== (orig.text || '') || o.correct !== !!orig.correct;
      });
      if (optsChanged) {
        payload.options = options.map((o) => ({ id: o.id, text: o.text, correct: o.correct }));
      }
    }
    return payload;
  }, [question, text, vignette, correctionText, expectedAnswer, customTitle, options]);

  const hasChanges = Object.keys(buildPayload()).length > 0;

  const doPatch = useCallback(async (dryRunMode: boolean) => {
    if (!question || !annaleId) return null;
    const payload = buildPayload();
    if (Object.keys(payload).length === 0) {
      toast.message('Aucune modification à enregistrer');
      return null;
    }
    const qs = dryRunMode ? '?dryRun=1' : '';
    const res = await fetch(
      `/api/annales/${encodeURIComponent(annaleId)}/questions/${encodeURIComponent(question.id)}${qs}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    return data;
  }, [annaleId, question, buildPayload]);

  const handleClickSave = async () => {
    if (!hasChanges) {
      toast.message('Aucune modification');
      return;
    }
    setSubmitting(true);
    try {
      const dry = await doPatch(true);
      if (dry && dry.sessionsImpacted > 0) {
        setDryRun(dry);
        setConfirmStep(true);
        setSubmitting(false);
        return;
      }
      // Pas d'impact sessions → on commit direct
      const live = await doPatch(false);
      if (live && live.updated) {
        toast.success(`Question modifiée (${(live.changedFields || []).join(', ')})`);
        if (onSaved) onSaved();
        onOpenChange(false);
      } else if (live && live.noop) {
        toast.message('Aucun changement détecté côté serveur');
        onOpenChange(false);
      }
    } catch (e: any) {
      toast.error(`Échec : ${e?.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmedSave = async () => {
    setSubmitting(true);
    try {
      const live = await doPatch(false);
      if (live && live.updated) {
        toast.success(`Question modifiée (${(live.changedFields || []).join(', ')})`);
        if (onSaved) onSaved();
        onOpenChange(false);
      }
    } catch (e: any) {
      toast.error(`Échec : ${e?.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!question) return null;

  const isQROC = question.questionType === 'QROC';
  const isQCM = question.questionType === 'QRU' || question.questionType === 'QRM';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <SheetHeader className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <SheetTitle className="flex items-center gap-2 text-base">
            ✏️ Corriger la question
            <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              {annaleId} · {question.id} · {question.questionType}
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Contexte signalement / extrait auto */}
          {contextNote && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 dark:border-indigo-800 dark:bg-indigo-950/30">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                Contexte du signalement
              </div>
              <div className="whitespace-pre-wrap text-xs text-indigo-900 dark:text-indigo-200">
                {contextNote}
              </div>
            </div>
          )}

          {/* Vignette */}
          <FieldGroup label="Vignette (cas clinique)" hint="Vide = pas de vignette. Sur série DP, seule la Q1 doit en avoir une.">
            <textarea
              value={vignette}
              onChange={(e) => setVignette(e.target.value)}
              rows={5}
              className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </FieldGroup>

          {/* Énoncé */}
          <FieldGroup label="Énoncé de la question" required>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </FieldGroup>

          {/* Options QRU/QRM */}
          {isQCM && options.length > 0 && (
            <FieldGroup label="Options" hint="Cocher = bonne réponse. Modifier le texte si mal parsé.">
              <div className="space-y-2">
                {options.map((opt, idx) => (
                  <OptionRow
                    key={opt.id}
                    option={opt}
                    onTextChange={(v) => {
                      const next = [...options];
                      next[idx] = { ...next[idx], text: v };
                      setOptions(next);
                    }}
                    onCorrectChange={(v) => {
                      const next = [...options];
                      next[idx] = { ...next[idx], correct: v };
                      setOptions(next);
                    }}
                  />
                ))}
              </div>
            </FieldGroup>
          )}

          {/* expectedAnswer QROC */}
          {isQROC && (
            <FieldGroup label="Réponse attendue (QROC)">
              <input
                type="text"
                value={expectedAnswer}
                onChange={(e) => setExpectedAnswer(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              />
            </FieldGroup>
          )}

          {/* Correction */}
          <FieldGroup label="Texte de correction">
            <textarea
              value={correctionText}
              onChange={(e) => setCorrectionText(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </FieldGroup>

          {/* customTitle (admin/utilitaire) */}
          <FieldGroup label="Titre custom (optionnel)" hint="Utilisé pour le label des séries DP">
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </FieldGroup>

          {/* Dry-run banner : sessions impactées */}
          {confirmStep && dryRun && dryRun.sessionsImpacted > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/30">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-1 text-sm">
                  <div className="font-semibold text-amber-800 dark:text-amber-200">
                    {dryRun.sessionsImpacted} session(s) historique(s) seront impactée(s)
                  </div>
                  <div className="text-xs text-amber-700 dark:text-amber-300">
                    Modifier <strong>{(dryRun.changedFields || []).join(', ')}</strong> va rendre les scores passés incohérents pour ces sessions. Confirmer pour appliquer quand même.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <X size={14} /> Annuler
          </button>
          {!confirmStep ? (
            <button
              type="button"
              onClick={handleClickSave}
              disabled={submitting || !hasChanges}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Enregistrer
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirmedSave}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-500 disabled:opacity-60"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
              Confirmer malgré l'impact
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FieldGroup({
  label, required, hint, children,
}: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <div className="text-[11px] text-neutral-400 dark:text-neutral-500">{hint}</div>}
    </div>
  );
}

function OptionRow({
  option, onTextChange, onCorrectChange,
}: {
  option: { id: string; text: string; correct: boolean };
  onTextChange: (v: string) => void;
  onCorrectChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex shrink-0 items-center gap-1.5 pt-2">
        <Checkbox
          checked={option.correct}
          onCheckedChange={(v) => onCorrectChange(!!v)}
          aria-label={`Marquer ${option.id} comme correcte`}
        />
        <span className="w-5 text-center font-mono text-xs font-bold text-neutral-600 dark:text-neutral-300">{option.id}</span>
      </div>
      <textarea
        value={option.text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={2}
        className="min-h-[44px] flex-1 resize-y rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      />
    </div>
  );
}
