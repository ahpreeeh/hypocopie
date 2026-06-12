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
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            ✏️ Corriger la question
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {annaleId} · {question.id} · {question.questionType}
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* Contexte signalement / extrait auto */}
          {contextNote && (
            <div className="rounded-input border border-brand-100 bg-brand-50 px-4 py-3 dark:border-brand-700/40 dark:bg-brand-950/30">
              <div className="mb-1 text-[10px] font-[650] uppercase tracking-wide text-brand-700 dark:text-brand-100">
                Contexte du signalement
              </div>
              <div className="whitespace-pre-wrap text-xs text-brand-950 dark:text-brand-100">
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
              className="w-full resize-y rounded-input border border-input bg-input-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </FieldGroup>

          {/* Énoncé */}
          <FieldGroup label="Énoncé de la question" required>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-input border border-input bg-input-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
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
                className="w-full rounded-input border border-input bg-input-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </FieldGroup>
          )}

          {/* Correction */}
          <FieldGroup label="Texte de correction">
            <textarea
              value={correctionText}
              onChange={(e) => setCorrectionText(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-input border border-input bg-input-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </FieldGroup>

          {/* customTitle (admin/utilitaire) */}
          <FieldGroup label="Titre custom (optionnel)" hint="Utilisé pour le label des séries DP">
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              className="w-full rounded-input border border-input bg-input-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </FieldGroup>

          {/* Dry-run banner : sessions impactées */}
          {confirmStep && dryRun && dryRun.sessionsImpacted > 0 && (
            <div className="rounded-input border border-warn-100 bg-warn-50 px-4 py-3 dark:border-warn-700/50 dark:bg-warn-950/30">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn-700 dark:text-warn-500" />
                <div className="space-y-1 text-sm">
                  <div className="font-[650] text-warn-950 dark:text-warn-100">
                    {dryRun.sessionsImpacted} session(s) historique(s) seront impactée(s)
                  </div>
                  <div className="text-xs text-warn-700 dark:text-warn-100">
                    Modifier <strong>{(dryRun.changedFields || []).join(', ')}</strong> va rendre les scores passés incohérents pour ces sessions. Confirmer pour appliquer quand même.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-input border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X size={14} /> Annuler
          </button>
          {!confirmStep ? (
            <button
              type="button"
              onClick={handleClickSave}
              disabled={submitting || !hasChanges}
              className="inline-flex items-center gap-1.5 rounded-input bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Enregistrer
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConfirmedSave}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-input bg-warn-500 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-warn-700 disabled:opacity-60"
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
      <label className="block text-xs font-[650] uppercase tracking-wide text-muted-foreground">
        {label} {required && <span className="text-danger-700 dark:text-danger-500">*</span>}
      </label>
      {children}
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
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
    <div className="flex items-start gap-2 rounded-input border border-border bg-card p-2">
      <div className="flex shrink-0 items-center gap-1.5 pt-2">
        <Checkbox
          checked={option.correct}
          onCheckedChange={(v) => onCorrectChange(!!v)}
          aria-label={`Marquer ${option.id} comme correcte`}
        />
        <span className="w-5 text-center font-mono text-xs font-[650] text-muted-foreground">{option.id}</span>
      </div>
      <textarea
        value={option.text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={2}
        className="min-h-[44px] flex-1 resize-y rounded-input border border-input bg-input-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}
