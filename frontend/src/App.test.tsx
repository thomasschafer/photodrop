import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

vi.mock('./contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    logout: vi.fn(),
    login: vi.fn(),
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
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText('photodrop')).toBeInTheDocument();
    expect(
      screen.getByText('Private photo sharing for families and close friends.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows login page at /login route', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeInTheDocument();
  });
});
