import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from './App';

vi.mock('./contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    logout: vi.fn(),
  }),
}));

vi.mock('./components/PhotoUpload', () => ({
  PhotoUpload: () => <div>PhotoUpload</div>,
}));

vi.mock('./components/PhotoFeed', () => ({
  PhotoFeed: () => <div>PhotoFeed</div>,
}));

describe('App', () => {
  it('renders welcome message when not authenticated', () => {
    render(<App />);

    expect(screen.getByText('photodrop')).toBeInTheDocument();
    expect(screen.getByText('You need an invite link to access this app')).toBeInTheDocument();
  });
});
