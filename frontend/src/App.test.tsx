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
  it('redirects to login page when not authenticated', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText('photodrop')).toBeInTheDocument();
    expect(screen.getByText('Log in to your account')).toBeInTheDocument();
  });

  it('shows login page at /login route', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText('Log in to your account')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
  });
});
