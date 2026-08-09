import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './contexts/ThemeContext';

vi.mock('./contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    currentGroup: null,
    groups: [],
    needsGroupSelection: false,
    loading: false,
    logout: vi.fn(),
    login: vi.fn(),
    refreshAuth: vi.fn(),
    switchGroup: vi.fn(),
    selectGroup: vi.fn(),
  }),
}));

vi.mock('./components/PhotoUpload', () => ({
  PhotoUpload: () => <div>PhotoUpload</div>,
}));

vi.mock('./components/PhotoFeed', () => ({
  PhotoFeed: () => <div>PhotoFeed</div>,
}));

describe('App', () => {
  it('shows landing page when not authenticated', () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    );

    expect(screen.getByText('photodrop')).toBeInTheDocument();
    expect(
      screen.getByText('Private photo sharing for families and close friends.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows login page at /login route', () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/login']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    );

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeInTheDocument();
  });

  it('sends signed-out photo links to sign in so the photo can be resumed', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/photo/photo-1?group=group-1']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('returns other signed-out app routes to the landing page', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/members']}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    );

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });
});
