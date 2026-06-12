import { createBrowserRouter, RouterProvider, Navigate, isRouteErrorResponse, useRouteError } from "react-router";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { DataProvider } from "./data-context";
import { ThemeProvider } from "./theme-context";
import { AppShell } from "./AppShell";
import { ListPage } from "./pages/list-page";
import { QuestionPage } from "./pages/question-page";
import { AnnalesList } from "./pages/annales-list";
import { AnnaleImportPage } from "./pages/annale-import-page";
import { ExamPage } from "./pages/exam-page";
import { HistoriquePage, HistoriqueDetailPage } from "./pages/historique-page";
import { AdminVignettesPage } from "./pages/admin-vignettes-page";
import { AdminCorrectionsPage } from "./pages/admin-corrections-page";
import { Toaster } from "sonner";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: AppShell,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      // Racine -> tableau de bord d'entrainement.
      { index: true, element: <Navigate to="/entrainement" replace /> },

      // 📓 Cahier d'erreurs (questions capturées via l'extension)
      { path: "captures", Component: ListPage },
      { path: "captures/q/:id", Component: QuestionPage },

      // 🎓 Espace d'entraînement (annales PDF jouables)
      { path: "entrainement", Component: AnnalesList },
      { path: "entrainement/import", Component: AnnaleImportPage },
      { path: "entrainement/historique", Component: HistoriquePage },
      { path: "entrainement/historique/:sessionId", Component: HistoriqueDetailPage },
      { path: "entrainement/:annaleId", Component: ExamPage },

      // Admin
      { path: "admin/corrections", Component: AdminCorrectionsPage },
      { path: "admin/vignettes", Component: AdminVignettesPage },

      // Anciennes routes → redirection vers les nouvelles
      { path: "q/:id", element: <Navigate to="/captures" replace /> },
      { path: "annales", element: <Navigate to="/entrainement" replace /> },
      { path: "exam/:annaleId", element: <Navigate to="/entrainement" replace /> },
    ],
  },
]);

function RouteErrorBoundary() {
  const error = useRouteError();
  const title = isRouteErrorResponse(error)
    ? `Erreur ${error.status}`
    : "Erreur d'affichage";
  const message = isRouteErrorResponse(error)
    ? (error.statusText || "La page n'a pas pu etre chargee.")
    : error instanceof Error
    ? error.message
    : "Une erreur inattendue a interrompu cette page.";

  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto mt-16 max-w-xl rounded-card border border-border bg-card p-6 shadow-[var(--shadow-card)]">
        <div className="mb-4 flex items-start gap-3">
          <div className="rounded-input bg-danger-50 p-2 text-danger-700 dark:bg-danger-950/40 dark:text-danger-500">
            <AlertTriangle size={22} />
          </div>
          <div>
            <h1 className="text-lg font-medium">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              La page a plante, mais l'application locale continue de fonctionner. Recharge d'abord la page ; si ca revient, envoie-moi le message ci-dessous.
            </p>
          </div>
        </div>
        <pre className="max-h-48 overflow-auto rounded-input border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
          {message}
        </pre>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-input bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <RotateCcw size={15} />
            Recharger
          </button>
          <a
            href="/entrainement"
            className="inline-flex items-center rounded-input border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Retour aux annales
          </a>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <DataProvider>
        <RouterProvider router={router} />
        <Toaster position="top-right" richColors closeButton />
      </DataProvider>
    </ThemeProvider>
  );
}
