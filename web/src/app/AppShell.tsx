import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router';
import { AlertTriangle, Check, Loader2, Menu, Moon, Save, ScanText, Sun } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './components/ui/sheet';
import { useTheme } from './theme-context';
import logoImg from '../imports/ChatGPT_Image_11_mai_2026__22_39_20.png';

const BACKUP_AUTO_KEY = 'hypocampus_last_backup_iso';
const BACKUP_AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;

type Tab = { to: string; label: string; active: boolean; badge?: number | null };

export function AppShell() {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const inImport = pathname.startsWith('/entrainement/import');
  const inHistory = pathname.startsWith('/entrainement/historique');
  const inExam = pathname.startsWith('/entrainement/') && !inImport && !inHistory;

  const [correctionsTotal, setCorrectionsTotal] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/reports/summary')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setCorrectionsTotal(typeof data.total === 'number' ? data.total : null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    const last = localStorage.getItem(BACKUP_AUTO_KEY);
    const lastMs = last ? Date.parse(last) : 0;
    if (Date.now() - lastMs < BACKUP_AUTO_INTERVAL_MS) return;
    fetch('/api/admin/backup', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.filename) {
          localStorage.setItem(BACKUP_AUTO_KEY, new Date().toISOString());
          console.log(`[backup] auto-backup cree : ${data.filename} (${Math.round(data.sizeBytes / 1024 / 1024)} MB)`);
        }
      })
      .catch(() => {});
  }, []);

  // Mode copie : pendant un examen, aucun chrome de navigation — la copie
  // occupe tout l'écran, comme à l'UNESS. exam-page gère son propre header.
  if (inExam) {
    return (
      <div className="h-screen overflow-hidden bg-background text-foreground">
        <Outlet />
      </div>
    );
  }

  const tabs: Tab[] = [
    { to: '/entrainement', label: 'Tableau de bord', active: pathname === '/' || pathname === '/entrainement' },
    { to: '/captures', label: "Cahier d'erreurs", active: pathname.startsWith('/captures') },
    { to: '/entrainement/historique', label: 'Historique', active: inHistory },
    { to: '/admin/corrections', label: 'Maintenance', active: pathname.startsWith('/admin'), badge: correctionsTotal },
  ];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="z-40 flex h-14 shrink-0 items-center gap-1.5 border-b border-border bg-card px-3 sm:px-5">
        <button
          onClick={() => setMobileOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
          aria-label="Ouvrir la navigation"
        >
          <Menu size={18} />
        </button>

        <Link to="/entrainement" className="flex items-center gap-2.5 pr-3" title="Hypocampus — tableau de bord">
          <img src={logoImg} alt="" className="h-8 w-8 rounded-[8px] object-cover" />
          <span className="hidden text-[15px] font-[650] tracking-[-0.01em] text-foreground sm:block">
            Hypocampus
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Navigation principale">
          {tabs.map((tab) => (
            <TopNavLink key={tab.to} {...tab} />
          ))}
        </nav>

        <div className="flex-1" />

        {!inImport && (
          <Link
            to="/entrainement/import"
            className="hidden items-center gap-1.5 rounded-input bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-brand-700 sm:inline-flex"
          >
            <ScanText size={14} />
            Importer
          </Link>
        )}
        <BackupButton />
        <ThemeToggle />
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[80vw] max-w-xs gap-0 p-0">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="flex items-center gap-2.5 text-left text-sm font-[650]">
              <img src={logoImg} alt="" className="h-8 w-8 rounded-[8px] object-cover" />
              Hypocampus
            </SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-1 p-3" aria-label="Navigation">
            {tabs.map((tab) => {
              const badgeLabel = tab.badge && tab.badge > 0 ? (tab.badge > 99 ? '99+' : String(tab.badge)) : null;
              return (
                <Link
                  key={tab.to}
                  to={tab.to}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center justify-between rounded-input px-3 py-2.5 text-sm font-medium transition-colors ${
                    tab.active
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-100'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {tab.label}
                  {badgeLabel && (
                    <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-pill bg-warn-500 px-1.5 text-[10px] font-[650] text-white">
                      {badgeLabel}
                    </span>
                  )}
                </Link>
              );
            })}
            <div className="my-2 h-px bg-border" />
            <Link
              to="/entrainement/import"
              onClick={() => setMobileOpen(false)}
              className="inline-flex items-center justify-center gap-1.5 rounded-input bg-brand-600 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              <ScanText size={15} />
              Importer une annale
            </Link>
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TopNavLink({ to, label, active, badge }: Tab) {
  const badgeLabel = badge && badge > 0 ? (badge > 99 ? '99+' : String(badge)) : null;
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex items-center gap-1.5 rounded-input px-3 py-1.5 text-[13.5px] font-medium transition-colors ${
        active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
      }`}
    >
      {label}
      {badgeLabel && (
        <span className="inline-flex h-4 min-w-[18px] items-center justify-center rounded-pill bg-warn-500 px-1 text-[10px] font-[650] text-white">
          {badgeLabel}
        </span>
      )}
    </Link>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      onClick={toggleTheme}
      className="inline-flex h-9 w-9 items-center justify-center rounded-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title={isDark ? 'Mode clair' : 'Mode sombre'}
      aria-label={isDark ? 'Passer en mode clair' : 'Passer en mode sombre'}
    >
      {isDark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

function BackupButton() {
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBackup = async () => {
    setBusy(true);
    setSuccess(false);
    setError(null);
    try {
      const response = await fetch('/api/admin/backup', { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error((data && data.error) || `HTTP ${response.status}`);
      localStorage.setItem(BACKUP_AUTO_KEY, new Date().toISOString());
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e.message || String(e));
      setTimeout(() => setError(null), 5000);
    } finally {
      setBusy(false);
    }
  };

  let icon = <Save size={17} />;
  let titleAttr = 'Creer une sauvegarde maintenant (auto 1x/jour)';
  let tone = 'text-muted-foreground hover:bg-muted hover:text-foreground';
  if (busy) {
    icon = <Loader2 size={17} className="animate-spin" />;
    titleAttr = 'Sauvegarde en cours';
  } else if (success) {
    icon = <Check size={17} />;
    titleAttr = 'Sauvegarde creee';
    tone = 'bg-success-50 text-success-700 dark:bg-success-950/40 dark:text-success-100';
  } else if (error) {
    icon = <AlertTriangle size={17} />;
    titleAttr = error;
    tone = 'bg-danger-50 text-danger-700 dark:bg-danger-950/40 dark:text-danger-100';
  }

  return (
    <button
      onClick={handleBackup}
      disabled={busy}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-input transition-colors disabled:opacity-60 ${tone}`}
      title={titleAttr}
      aria-label="Sauvegarder les donnees"
    >
      {icon}
    </button>
  );
}
