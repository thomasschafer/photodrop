import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { PhotoUpload } from './components/PhotoUpload';
import { PhotoFeed } from './components/PhotoFeed';
import { InviteForm } from './components/InviteForm';
import { LoginPage } from './pages/LoginPage';
import { AuthVerifyPage } from './pages/AuthVerifyPage';

function MainApp() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'feed' | 'upload' | 'invite'>('feed');
  const [feedKey, setFeedKey] = useState(0);

  const handleUploadComplete = () => {
    setActiveTab('feed');
    setFeedKey((prev) => prev + 1);
  };

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <a href="#main-content" className="skip-to-main">
        Skip to main content
      </a>

      <nav
        className="bg-white border-b border-neutral-200 sticky top-0 z-10 shadow-sm"
        aria-label="Main navigation"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-black text-primary-600 tracking-tight">photodrop</h1>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-sm text-neutral-600">
                <span className="font-medium text-neutral-800">{user.name}</span>
                <span className="mx-2 text-neutral-400">·</span>
                <span className="capitalize text-neutral-600">{user.role}</span>
              </div>
              <button
                onClick={logout}
                className="btn-text text-sm"
                aria-label="Log out of your account"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {user.role === 'admin' && (
          <div className="mb-8" role="tablist" aria-label="Photo management tabs">
            <div className="flex gap-2 border-b-2 border-neutral-200">
              <button
                role="tab"
                aria-selected={activeTab === 'feed'}
                aria-controls="feed-panel"
                id="feed-tab"
                onClick={() => setActiveTab('feed')}
                className={`px-6 py-3 font-semibold transition-all duration-200 -mb-0.5 ${
                  activeTab === 'feed'
                    ? 'border-b-2 border-primary-500 text-primary-600'
                    : 'text-neutral-600 hover:text-neutral-900 focus:text-neutral-900'
                }`}
              >
                Photos
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'upload'}
                aria-controls="upload-panel"
                id="upload-tab"
                onClick={() => setActiveTab('upload')}
                className={`px-6 py-3 font-semibold transition-all duration-200 -mb-0.5 ${
                  activeTab === 'upload'
                    ? 'border-b-2 border-primary-500 text-primary-600'
                    : 'text-neutral-600 hover:text-neutral-900 focus:text-neutral-900'
                }`}
              >
                Upload
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'invite'}
                aria-controls="invite-panel"
                id="invite-tab"
                onClick={() => setActiveTab('invite')}
                className={`px-6 py-3 font-semibold transition-all duration-200 -mb-0.5 ${
                  activeTab === 'invite'
                    ? 'border-b-2 border-primary-500 text-primary-600'
                    : 'text-neutral-600 hover:text-neutral-900 focus:text-neutral-900'
                }`}
              >
                Invite
              </button>
            </div>
          </div>
        )}

        <div>
          {activeTab === 'feed' && (
            <div role="tabpanel" id="feed-panel" aria-labelledby="feed-tab">
              <PhotoFeed key={feedKey} />
            </div>
          )}
          {activeTab === 'upload' && user.role === 'admin' && (
            <div role="tabpanel" id="upload-panel" aria-labelledby="upload-tab">
              <PhotoUpload onUploadComplete={handleUploadComplete} />
            </div>
          )}
          {activeTab === 'invite' && user.role === 'admin' && (
            <div role="tabpanel" id="invite-panel" aria-labelledby="invite-tab">
              <div className="max-w-md">
                <InviteForm />
              </div>
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
        className="flex items-center justify-center min-h-screen"
        role="status"
        aria-live="polite"
      >
        <div className="text-lg text-neutral-600">Loading...</div>
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
