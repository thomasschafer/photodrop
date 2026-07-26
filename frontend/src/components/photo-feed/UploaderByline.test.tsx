import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UploaderByline } from './UploaderByline';

const uploadedAt = Math.floor(Date.now() / 1000);

describe('UploaderByline', () => {
  it('names the uploader and shows their avatar initials', () => {
    render(<UploaderByline name="Ada Lovelace" color="teal" uploadedAt={uploadedAt} />);

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('falls back to a nameless label when the uploader account is gone', () => {
    render(<UploaderByline name={null} color={null} uploadedAt={uploadedAt} />);

    expect(screen.getByText('Deleted user')).toBeInTheDocument();
    // No avatar to render without a name or colour.
    expect(screen.queryByText('AL')).not.toBeInTheDocument();
  });
});
