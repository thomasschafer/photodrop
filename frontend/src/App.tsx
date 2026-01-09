import { useState, useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { PhotoUpload } from './components/PhotoUpload';
import { PhotoFeed } from './components/PhotoFeed';
import { InviteForm } from './components/InviteForm';
import { Logo } from './components/Logo';
import { ThemeToggle } from './components/ThemeToggle';
import { LoginPage } from './pages/LoginPage';
import { AuthVerifyPage } from './pages/AuthVerifyPage';
import { LandingPage } from './pages/LandingPage';

const tabs = [
  { id: 'feed' as const, path: '/', label: 'Photos' },
  { id: 'upload' as const, path: '/upload', label: 'Upload' },
  { id: 'invite' as const, path: '/invite', label: 'Invite' },
];

function MainApp() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [feedKey, setFeedKey] = useState(0);
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const activeTab = tabs.find((tab) => tab.path === location.pathname)?.id ?? 'feed';

  const handleUploadComplete = () => {
    setFeedKey((prev) => prev + 1);
    navigate('/');
  };

  const focusTab = useCallback((index: number) => {
    const clampedIndex = Math.max(0, Math.min(index, tabs.length - 1));
    tabRefs.current[clampedIndex]?.focus();
  }, []);

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
        focusTab(tabs.length - 1);
        break;
    }
  };

  if (!user) {
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
            <Logo size="sm" />

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

          {user.role === 'admin' && (
            <nav className="flex gap-8" role="tablist" aria-label="Main navigation">
              {tabs.map((tab, index) => (
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
          {activeTab === 'feed' && <PhotoFeed key={feedKey} isAdmin={user.role === 'admin'} />}
          {activeTab === 'upload' && user.role === 'admin' && (
            <PhotoUpload onUploadComplete={handleUploadComplete} />
          )}
          {activeTab === 'invite' && user.role === 'admin' && (
            <div className="max-w-[480px] mx-auto">
              <InviteForm />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function App() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg-primary">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/:token" element={<AuthVerifyPage />} />
      <Route path="/" element={<MainApp />} />
      <Route path="/upload" element={<MainApp />} />
      <Route path="/invite" element={<MainApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
