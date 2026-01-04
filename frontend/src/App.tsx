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
    setFeedKey(prev => prev + 1);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4">photodrop</h1>
          <p className="text-gray-600 mb-4">Private family photo sharing</p>
          <p className="text-sm text-gray-500">
            You need an invite link to access this app
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold">photodrop</h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">
                {user.name} ({user.role})
              </span>
              <button
                onClick={logout}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {user.role === 'admin' && (
          <div className="mb-6 flex gap-2 border-b">
            <button
              onClick={() => setActiveTab('feed')}
              className={`px-4 py-2 font-medium ${
                activeTab === 'feed'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Photos
            </button>
            <button
              onClick={() => setActiveTab('upload')}
              className={`px-4 py-2 font-medium ${
                activeTab === 'upload'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Upload
            </button>
          </div>
        )}

        {activeTab === 'feed' && <PhotoFeed key={feedKey} />}
        {activeTab === 'upload' && user.role === 'admin' && (
          <PhotoUpload onUploadComplete={handleUploadComplete} />
        )}
      </main>
    </div>
  );
}

export default App;
