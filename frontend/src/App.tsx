import { useState, useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { PhotoUpload } from './components/PhotoUpload';
import { PhotoFeed } from './components/PhotoFeed';
import { InviteForm } from './components/InviteForm';
import { Logo } from './components/Logo';
import { ThemeToggle } from './components/ThemeToggle';
import { GroupSwitcher } from './components/GroupSwitcher';
import { LoginPage } from './pages/LoginPage';
import { AuthVerifyPage } from './pages/AuthVerifyPage';
import { LandingPage } from './pages/LandingPage';
import { GroupPickerPage } from './pages/GroupPickerPage';

const tabs = [
  { id: 'feed' as const, path: '/', label: 'Photos' },
  { id: 'upload' as const, path: '/upload', label: 'Upload' },
  { id: 'invite' as const, path: '/invite', label: 'Invite' },
  { id: 'members' as const, path: '/members', label: 'Members' },
];

function MainApp() {
  const { user, currentGroup, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [feedKey, setFeedKey] = useState(0);
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const isAdmin = currentGroup?.role === 'admin';

  // Filter tabs based on role
  const visibleTabs = tabs.filter((tab) => {
    if (tab.id === 'upload' || tab.id === 'invite' || tab.id === 'members') {
      return isAdmin;
    }
    return true;
  });

  const activeTab = visibleTabs.find((tab) => tab.path === location.pathname)?.id ?? 'feed';

  const handleUploadComplete = () => {
    setFeedKey((prev) => prev + 1);
    navigate('/');
  };

  const focusTab = useCallback(
    (index: number) => {
      const clampedIndex = Math.max(0, Math.min(index, visibleTabs.length - 1));
      tabRefs.current[clampedIndex]?.focus();
    },
    [visibleTabs.length]
  );

  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusTab(index + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusTab(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusTab(0);
        break;
      case 'End':
        e.preventDefault();
        focusTab(visibleTabs.length - 1);
        break;
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
              <GroupSwitcher />
            </div>

            <div className="flex items-center gap-4">
              <ThemeToggle />
              <span className="text-sm text-text-secondary">{user.name}</span>
              <button
                onClick={logout}
                className="text-sm font-medium text-accent bg-transparent border-none cursor-pointer transition-colors hover:text-accent-hover"
              >
                Sign out
              </button>
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

      <main id="main-content" className="max-w-[900px] mx-auto py-8 px-6">
        <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-label={`${activeTab} content`}>
          {activeTab === 'feed' && <PhotoFeed key={feedKey} isAdmin={isAdmin} />}
          {activeTab === 'upload' && isAdmin && (
            <PhotoUpload onUploadComplete={handleUploadComplete} />
          )}
          {activeTab === 'invite' && isAdmin && (
            <div className="max-w-[480px] mx-auto">
              <InviteForm />
            </div>
          )}
          {activeTab === 'members' && isAdmin && (
            <div className="max-w-[600px] mx-auto">
              <MembersPlaceholder />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function MembersPlaceholder() {
  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-bg-secondary flex items-center justify-center">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-text-tertiary"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </div>
      <h2 className="text-lg font-medium text-text-primary mb-2">Members</h2>
      <p className="text-text-secondary">Member management coming soon</p>
    </div>
  );
}

function App() {
  const { user, needsGroupSelection, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg-primary">
        <div className="spinner" />
      </div>
    );
  }

  // User is logged in but needs to select a group
  if (user && needsGroupSelection) {
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
      <Route path="/" element={<MainApp />} />
      <Route path="/upload" element={<MainApp />} />
      <Route path="/invite" element={<MainApp />} />
      <Route path="/members" element={<MainApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
