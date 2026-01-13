import { useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { getNavDirection } from './lib/keyboard';
import { PhotoFeed } from './components/PhotoFeed';
import { MembersList } from './components/MembersList';
import { Logo } from './components/Logo';
import { ThemeToggle } from './components/ThemeToggle';
import { GroupSwitcher } from './components/GroupSwitcher';
import { InstallPrompt, InstallButton } from './components/InstallPrompt';
import { MobileMenu } from './components/MobileMenu';
import { NotificationBell } from './components/NotificationBell';
import { NotificationPrompt } from './components/NotificationPrompt';
import { OfflineIndicator } from './components/OfflineIndicator';
import { LoginPage } from './pages/LoginPage';
import { AuthVerifyPage } from './pages/AuthVerifyPage';
import { LandingPage } from './pages/LandingPage';
import { GroupPickerPage } from './pages/GroupPickerPage';

const tabs = [
  { id: 'feed' as const, path: '/', label: 'Photos' },
  { id: 'members' as const, path: '/members', label: 'Group' },
];

function MainApp() {
  const { user, currentGroup, logout } = useAuth();
  const location = useLocation();
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const isAdmin = currentGroup?.role === 'admin';

  // Filter tabs based on role - only admins can see the Group tab
  const visibleTabs = tabs.filter((tab) => {
    if (tab.id === 'members') {
      return isAdmin;
    }
    return true;
  });

  const activeTab = visibleTabs.find((tab) => tab.path === location.pathname)?.id ?? 'feed';

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
    return <LandingPage />;
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <a href="#main-content" className="skip-to-main">
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 bg-surface border-b border-border">
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
                <span className="text-sm text-text-secondary">{user.name}</span>
                <button
                  onClick={logout}
                  className="text-sm font-medium text-accent bg-transparent border-none cursor-pointer transition-colors hover:text-accent-hover"
                >
                  Sign out
                </button>
              </div>

              <div className="mobile:hidden flex items-center gap-2">
                <InstallButton />
                <NotificationBell />
                <MobileMenu />
              </div>
            </div>
          </div>

          {isAdmin && (
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
      <InstallPrompt />
      <NotificationPrompt />

      <main id="main-content" className="max-w-[900px] mx-auto py-8 px-6">
        <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-label={`${activeTab} content`}>
          {activeTab === 'feed' && <PhotoFeed isAdmin={isAdmin} />}
          {activeTab === 'members' && isAdmin && (
            <div className="max-w-[600px] mx-auto">
              <MembersList />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function App() {
  const { user, currentGroup, loading } = useAuth();

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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
