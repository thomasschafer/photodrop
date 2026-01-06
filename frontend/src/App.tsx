import { useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import { PhotoUpload } from './components/PhotoUpload';
import { PhotoFeed } from './components/PhotoFeed';

function App() {
  const { user, loading, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'feed' | 'upload'>('feed');
  const [feedKey, setFeedKey] = useState(0);

  const handleUploadComplete = () => {
    setActiveTab('feed');
    setFeedKey((prev) => prev + 1);
  };

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

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-primary-50 to-neutral-50">
        <div className="text-center px-6">
          <h1 className="text-5xl font-black text-primary-600 mb-4 tracking-tight">photodrop</h1>
          <p className="text-xl text-neutral-700 mb-6 font-medium">
            Private photo sharing for your group
          </p>
          <div className="card max-w-md mx-auto">
            <p className="text-neutral-600">
              You need an invite to access this app.
              <br />
              Check your email for your magic link.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Skip to main content for keyboard navigation */}
      <a href="#main-content" className="skip-to-main">
        Skip to main content
      </a>

      {/* Navigation */}
      <nav
        className="bg-white border-b border-neutral-200 sticky top-0 z-10 shadow-sm"
        aria-label="Main navigation"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <div className="flex items-center">
              <h1 className="text-2xl font-black text-primary-600 tracking-tight">photodrop</h1>
            </div>

            {/* User info and actions */}
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

      {/* Main content */}
      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tab navigation for admins */}
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
            </div>
          </div>
        )}

        {/* Tab panels */}
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
        </div>
      </main>
    </div>
  );
}

export default App;
