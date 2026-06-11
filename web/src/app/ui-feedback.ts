export function humanizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  const message = raw.trim();

  if (!message) return "Une erreur est survenue.";
  if (/HTTP 409|deja existante|already exists/i.test(message)) return "Cette ressource existe deja.";
  if (/HTTP 404|introuvable|not found/i.test(message)) return "Ressource introuvable.";
  if (/HTTP 401|HTTP 403/i.test(message)) return "Action refusee par le serveur local.";
  if (/HTTP 500|HTTP 502|HTTP 503|HTTP 504/i.test(message)) return "Le serveur local a rencontre une erreur.";
  if (/failed to fetch|network|connexion|load failed/i.test(message)) return "Connexion au serveur local perdue.";

  return message;
}

export function scoreGradientClass(percentage: number | null | undefined): string {
  if (percentage === null || percentage === undefined) return "from-neutral-500 to-neutral-700";
  if (percentage >= 70) return "from-green-500 to-green-700";
  if (percentage >= 50) return "from-amber-500 to-amber-700";
  return "from-red-500 to-red-700";
}

export function scoreTextClass(percentage: number | null | undefined): string {
  if (percentage === null || percentage === undefined) return "text-neutral-500";
  if (percentage >= 70) return "text-green-600 dark:text-green-400";
  if (percentage >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export function formatScoreNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}
