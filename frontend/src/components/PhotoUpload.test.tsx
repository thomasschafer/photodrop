import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  convertHeicToJpeg: vi.fn(),
  compressImage: vi.fn(),
  validateImageFile: vi.fn(),
  validateImageDecodes: vi.fn(),
  upload: vi.fn(),
}));

vi.mock('../lib/imageCompression', () => ({
  isHeicFile: () => false,
  validateImageFile: (...args: unknown[]) => mocks.validateImageFile(...args),
  validateImageDecodes: (...args: unknown[]) => mocks.validateImageDecodes(...args),
  formatFileSize: () => '1 KB',
  convertHeicToJpeg: mocks.convertHeicToJpeg,
  compressImage: mocks.compressImage,
}));

vi.mock('../lib/api', () => ({ api: { photos: { upload: mocks.upload } } }));

import { PhotoUpload } from './PhotoUpload';

function selectFiles(...names: string[]) {
  const input = document.querySelector<HTMLInputElement>('#photo-input');
  if (!input) throw new Error('file input is not rendered');
  fireEvent.change(input, {
    target: { files: names.map((name) => new File(['x'], name, { type: 'image/jpeg' })) },
  });
}

async function awaitReady(...names: string[]) {
  // The selection pipeline (decode + FileReader preview) settles on real
  // macrotasks, so wait for each row's caption field to appear.
  for (const name of names) {
    await screen.findByLabelText(`Caption for ${name}`);
  }
}

describe('PhotoUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateImageFile.mockReturnValue({ valid: true });
    mocks.validateImageDecodes.mockResolvedValue(true);
    mocks.compressImage.mockResolvedValue({
      fullSize: new File(['f'], 'full.jpg', { type: 'image/jpeg' }),
      thumbnail: new File(['t'], 'thumb.jpg', { type: 'image/jpeg' }),
    });
    mocks.upload.mockResolvedValue({ id: 'photo-1', message: 'ok' });
  });

  it('queues multiple selected files, each with its own caption field', async () => {
    render(<PhotoUpload />);

    selectFiles('one.jpg', 'two.jpg');
    await awaitReady('one.jpg', 'two.jpg');

    expect(screen.getByText(/one\.jpg/)).toBeInTheDocument();
    expect(screen.getByText(/two\.jpg/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload 2 photos' })).toBeEnabled();
  });

  it('appends later selections to the queue instead of replacing it', async () => {
    render(<PhotoUpload />);

    selectFiles('one.jpg');
    await awaitReady('one.jpg');
    selectFiles('two.jpg');
    await awaitReady('two.jpg');

    expect(screen.getByText(/one\.jpg/)).toBeInTheDocument();
    expect(screen.getByText(/two\.jpg/)).toBeInTheDocument();
  });

  it('rejects an undecodable file inline without blocking the rest', async () => {
    mocks.validateImageDecodes.mockImplementation(
      async (file: File) => file.name !== 'corrupt.jpg'
    );

    render(<PhotoUpload />);
    selectFiles('good.jpg', 'corrupt.jpg');
    await awaitReady('good.jpg');

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid image/i);
    // Only the good file counts toward the upload.
    const uploadButton = screen.getByRole('button', { name: 'Upload' });
    fireEvent.click(uploadButton);
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
  });

  it('uploads every ready file with its own caption and completes once', async () => {
    const onUploadComplete = vi.fn();
    render(<PhotoUpload onUploadComplete={onUploadComplete} />);

    selectFiles('one.jpg', 'two.jpg');
    await awaitReady('one.jpg', 'two.jpg');

    fireEvent.change(screen.getByLabelText('Caption for one.jpg'), {
      target: { value: 'first caption' },
    });
    fireEvent.change(screen.getByLabelText('Caption for two.jpg'), {
      target: { value: 'second caption' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Upload 2 photos' }));
    });

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledTimes(1));
    expect(onUploadComplete).toHaveBeenCalledWith(2);
    const captions = mocks.upload.mock.calls.map((call) => call[2]).sort();
    expect(captions).toEqual(['first caption', 'second caption']);
  });

  it('leaves a failed upload retryable and completes only after it succeeds', async () => {
    const onUploadComplete = vi.fn();
    mocks.upload
      .mockRejectedValueOnce(new Error('Photo exceeds maximum size of 20MB'))
      .mockResolvedValue({ id: 'photo-2', message: 'ok' });

    render(<PhotoUpload onUploadComplete={onUploadComplete} />);
    selectFiles('one.jpg', 'two.jpg');
    await awaitReady('one.jpg', 'two.jpg');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Upload 2 photos' }));
    });

    // One landed, one failed with its server message; no completion yet.
    await screen.findByText('Photo exceeds maximum size of 20MB');
    expect(onUploadComplete).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });

    await waitFor(() => expect(onUploadComplete).toHaveBeenCalledWith(2));
  });

  it('completes the batch when the one failed item is removed', async () => {
    const onUploadComplete = vi.fn();
    mocks.upload
      .mockRejectedValueOnce(new Error('too big'))
      .mockResolvedValue({ id: 'photo-ok', message: 'ok' });

    render(<PhotoUpload onUploadComplete={onUploadComplete} />);
    selectFiles('bad.jpg', 'good.jpg');
    await awaitReady('bad.jpg', 'good.jpg');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Upload 2 photos' }));
    });
    await screen.findByText('too big');
    expect(onUploadComplete).not.toHaveBeenCalled();

    // Removing the failed row is the user saying "forget it" — the uploaded
    // photo must still complete the batch rather than stranding the modal.
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Remove bad.jpg'));
    });

    expect(onUploadComplete).toHaveBeenCalledWith(1);
  });

  it('excludes removed items from the upload', async () => {
    render(<PhotoUpload />);
    selectFiles('keep.jpg', 'drop.jpg');
    await awaitReady('keep.jpg', 'drop.jpg');

    fireEvent.click(screen.getByLabelText('Remove drop.jpg'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    });

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/drop\.jpg/)).not.toBeInTheDocument();
  });
});
