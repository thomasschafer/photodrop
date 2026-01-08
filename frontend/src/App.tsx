import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { PhotoUpload } from './components/PhotoUpload';
import { PhotoFeed } from './components/PhotoFeed';
import { InviteForm } from './components/InviteForm';
import { Logo } from './components/Logo';
import { LoginPage } from './pages/LoginPage';
import { AuthVerifyPage } from './pages/AuthVerifyPage';
import { LandingPage } from './pages/LandingPage';

function MainApp() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'feed' | 'upload' | 'invite'>('feed');
  const [feedKey, setFeedKey] = useState(0);

  const handleUploadComplete = () => {
    setActiveTab('feed');
    setFeedKey((prev) => prev + 1);
  };

  if (!user) {
    return <LandingPage />;
  }

  const tabs = [
    { id: 'feed' as const, label: 'Photos' },
    { id: 'upload' as const, label: 'Upload' },
    { id: 'invite' as const, label: 'Invite' },
  ];

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#fdfcfa' }}>
      <a href="#main-content" className="skip-to-main">
        Skip to main content
      </a>

      <header
        style={{
          backgroundColor: 'white',
          borderBottom: '1px solid #f0ebe6',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 1.5rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              height: '4rem',
            }}
          >
            <Logo size="sm" />

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ fontSize: '0.875rem', color: '#8a8078' }}>{user.name}</span>
              <button
                onClick={logout}
                style={{
                  fontSize: '0.875rem',
                  color: '#c67d5a',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Sign out
              </button>
            </div>
          </div>

          {user.role === 'admin' && (
            <nav style={{ display: 'flex', gap: '2rem' }}>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    paddingBottom: '0.875rem',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: activeTab === tab.id ? '#3a3632' : '#8a8078',
                    background: 'none',
                    border: 'none',
                    borderBottom:
                      activeTab === tab.id ? '2px solid #c67d5a' : '2px solid transparent',
                    marginBottom: '-1px',
                    cursor: 'pointer',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          )}
        </div>
      </header>

      <main
        id="main-content"
        style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}
      >
        <div>
          {activeTab === 'feed' && <PhotoFeed key={feedKey} isAdmin={user.role === 'admin'} />}
          {activeTab === 'upload' && user.role === 'admin' && (
            <PhotoUpload onUploadComplete={handleUploadComplete} />
          )}
          {activeTab === 'invite' && user.role === 'admin' && (
            <div style={{ maxWidth: '420px' }}>
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#fdfcfa',
        }}
      >
        <div className="spinner" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/:token" element={<AuthVerifyPage />} />
      <Route path="/" element={<MainApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
