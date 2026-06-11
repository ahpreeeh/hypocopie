import { useState } from 'react';
import { toast } from 'sonner';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';

export const REPORT_CATEGORIES = [
  { value: 'vignette-missing',     label: 'Vignette manquante' },
  { value: 'vignette-incomplete',  label: 'Vignette incomplète (ex : bio sans valeurs)' },
  { value: 'question-text-bad',    label: 'Énoncé mal parsé / tronqué' },
  { value: 'option-text-bad',      label: 'Option mal parsée / tronquée' },
  { value: 'correction-incomplete', label: 'Correction manquante / incomplète' },
  { value: 'wrong-answer-flagged', label: 'Mauvaise réponse identifiée' },
  { value: 'other',                label: 'Autre' },
] as const;

export type ReportCategory = typeof REPORT_CATEGORIES[number]['value'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  annaleId: string;
  questionId: string;
  questionLabel?: string;
  /** Catégorie pré-remplie au mount, défaut 'vignette-incomplete' */
  defaultCategory?: ReportCategory;
  /** Appelé après création réussie. Reçoit l'id du report. */
  onCreated?: (reportId: string) => void;
}

export function ReportIssueModal({
  open, onOpenChange, annaleId, questionId, questionLabel,
  defaultCategory = 'vignette-incomplete',
  onCreated,
}: Props) {
  const [category, setCategory] = useState<ReportCategory>(defaultCategory);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!annaleId || !questionId) {
      toast.error('Identifiants manquants');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annaleId,
          questionId,
          category,
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data && data.error) || `HTTP ${res.status}`);
      }
      toast.success('Signalement enregistré');
      if (data && data.id && onCreated) onCreated(data.id);
      setNote('');
      setCategory(defaultCategory);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Échec : ${e?.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  const noteLen = note.length;
  const noteOver = noteLen > 500;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md gap-0 overflow-y-auto p-0">
        <SheetHeader className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <SheetTitle className="flex items-center gap-2 text-base">
            <AlertTriangle size={18} className="text-amber-500" />
            Signaler une coquille
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5 px-5 py-5">
          {questionLabel && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
              {questionLabel}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Catégorie
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as ReportCategory)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            >
              {REPORT_CATEGORIES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Note (optionnel)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="ex : la bio manque les valeurs d'hémoglobine, on a juste « hémoglobine » sans le nombre"
              rows={4}
              maxLength={600}
              className="w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-600"
            />
            <div className={`text-right text-[11px] ${noteOver ? 'text-red-500' : 'text-neutral-400'}`}>
              {noteLen}/500
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <X size={14} /> Annuler
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || noteOver}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
              Envoyer
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
