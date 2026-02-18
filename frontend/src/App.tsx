import { useRef, useCallback, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, Link, useNavigate } from 'react-router-dom';
import { DEEP_LINK_EVENT } from './lib/deepLink';
import { useAuth } from './contexts/AuthContext';
import { getNavDirection } from './lib/keyboard';
import { Logo } from './components/Logo';
import { ThemeToggle } from './components/ThemeToggle';
import { GroupSwitcher } from './components/GroupSwitcher';
import { InstallPrompt, InstallButton } from './components/InstallPrompt';
import { MobileMenu } from './components/MobileMenu';
import { NotificationBell } from './components/NotificationBell';
import { UserMenu } from './components/UserMenu';
import { NotificationPrompt } from './components/NotificationPrompt';
import { OfflineIndicator } from './components/OfflineIndicator';
import { SwUpdatePrompt } from './components/SwUpdatePrompt';
import { LoginPage } from './pages/LoginPage';
import { AuthVerifyPage } from './pages/AuthVerifyPage';
import { LandingPage } from './pages/LandingPage';
import { GroupPickerPage } from './pages/GroupPickerPage';
import { NotFoundPage } from './pages/NotFoundPage';

// Lazy-load heavy components
const PhotoFeed = lazy(() =>
  import('./components/PhotoFeed').then((m) => ({ default: m.PhotoFeed }))
);
const MembersList = lazy(() =>
  import('./components/MembersList').then((m) => ({ default: m.MembersList }))
);

const tabs = [
  { id: 'feed' as const, path: '/', label: 'Photos' },
  { id: 'members' as const, path: '/members', label: 'Group' },
];

function MainApp() {
  const { user, currentGroup } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const isAdmin = currentGroup?.role === 'admin';

  // Only admins can access the Group tab
  const visibleTabs = isAdmin ? tabs : tabs.filter((tab) => tab.id === 'feed');

  const activeTab = visibleTabs.find((tab) => tab.path === location.pathname)?.id ?? 'feed';

  useEffect(() => {
    if (!isAdmin && location.pathname === '/members') {
      navigate('/', { replace: true });
    }
  }, [isAdmin, location.pathname, navigate]);

  const focusTab = useCallback(
    (index: number) => {
      const clampedIndex = Math.max(0, Math.min(index, visibleTabs.length - 1));
      tabRefs.current[clampedIndex]?.focus();
    },
    [visibleTabs.length]
  );

  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    const direction = getNavDirection(e);
    if (direction === 'right') {
      e.preventDefault();
      focusTab(index + 1);
    } else if (direction === 'left') {
      e.preventDefault();
      focusTab(index - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusTab(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusTab(visibleTabs.length - 1);
    }
  };

  if (!user || !currentGroup) {
    if (location.pathname !== '/') {
      return <Navigate to="/" replace />;
    }
    return <LandingPage />;
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <a href="#main-content" className="skip-to-main">
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 bg-surface border-b border-border pt-[env(safe-area-inset-top)]">
        <div className="max-w-[900px] mx-auto px-6">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-4">
              <Logo size="sm" />
              <div className="hidden mobile:block">
                <GroupSwitcher />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden mobile:flex items-center gap-4">
                <InstallButton />
                <NotificationBell />
                <ThemeToggle />
                <UserMenu />
              </div>

              <div className="mobile:hidden flex items-center gap-2">
                <InstallButton />
                <NotificationBell />
                <MobileMenu />
              </div>
            </div>
          </div>

          {visibleTabs.length > 1 && (
            <nav className="flex gap-8" role="tablist" aria-label="Main navigation">
              {visibleTabs.map((tab, index) => (
                <Link
                  key={tab.id}
                  to={tab.path}
                  ref={(el) => {
                    tabRefs.current[index] = el;
                  }}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`tabpanel-${tab.id}`}
                  onKeyDown={(e) => handleTabKeyDown(e, index)}
                  className={`pb-3.5 text-sm font-medium no-underline cursor-pointer -mb-px border-b-2 transition-colors hover:text-text-primary ${
                    activeTab === tab.id
                      ? 'text-text-primary border-accent'
                      : 'text-text-secondary border-transparent'
                  }`}
                >
                  {tab.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>

      <OfflineIndicator />
      <SwUpdatePrompt />
      <InstallPrompt />
      <NotificationPrompt />

      <main id="main-content" className="max-w-[900px] mx-auto py-8 px-6">
        <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-label={`${activeTab} content`}>
          <Suspense
            fallback={
              <div className="flex justify-center py-12">
                <div className="spinner" />
              </div>
            }
          >
            {activeTab === 'feed' && <PhotoFeed isAdmin={isAdmin} />}
            {activeTab === 'members' && (
              <div className="max-w-[600px] mx-auto">
                <MembersList />
              </div>
            )}
          </Suspense>
        </div>
      </main>
    </div>
  );
}

function App() {
  const { user, currentGroup, loading } = useAuth();
  const navigate = useNavigate();

  // Handle deep link navigation without full page reload
  useEffect(() => {
    const handleDeepLink = (event: CustomEvent<{ path: string }>) => {
      navigate(event.detail.path, { replace: true });
    };

    window.addEventListener(DEEP_LINK_EVENT, handleDeepLink as EventListener);
    return () => {
      window.removeEventListener(DEEP_LINK_EVENT, handleDeepLink as EventListener);
    };
  }, [navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg-primary">
        <div className="spinner" />
      </div>
    );
  }

  // User is logged in but needs to select a group (or has no groups)
  if (user && !currentGroup) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/:token" element={<AuthVerifyPage />} />
        <Route path="*" element={<GroupPickerPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/:token" element={<AuthVerifyPage />} />
      <Route path="/" element={<MainApp />}>
        <Route index element={null} />
        <Route path="photo/:photoId" element={null} />
        <Route path="members" element={null} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;
