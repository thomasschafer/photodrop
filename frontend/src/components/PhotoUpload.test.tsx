import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  convertHeicToJpeg: vi.fn(),
  compressImage: vi.fn(),
}));

vi.mock('../lib/imageCompression', () => ({
  isHeicFile: () => true,
  validateImageFile: () => ({ valid: true }),
  formatFileSize: () => '1 KB',
  convertHeicToJpeg: mocks.convertHeicToJpeg,
  compressImage: mocks.compressImage,
}));

vi.mock('../lib/api', () => ({ api: { photos: { upload: vi.fn() } } }));

import { PhotoUpload } from './PhotoUpload';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function selectFile(name: string) {
  const input = document.querySelector<HTMLInputElement>('#photo-input');
  if (!input) throw new Error('file input is not rendered');
  fireEvent.change(input, {
    target: { files: [new File(['x'], name, { type: 'image/heic' })] },
  });
}

describe('PhotoUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discards a superseded selection so the preview matches the file it will upload', async () => {
    // The picker stays on screen for the whole conversion (selectedFile isn't
    // set until it finishes), so a second pick runs a second pipeline in
    // parallel. Whichever finished last used to win each piece of state
    // independently — the bytes queued for upload could belong to one file and
    // the preview on screen to the other.
    const slowFirst = deferred<File>();
    const quickSecond = deferred<File>();
    mocks.convertHeicToJpeg
      .mockReturnValueOnce(slowFirst.promise)
      .mockReturnValueOnce(quickSecond.promise);

    render(<PhotoUpload />);

    selectFile('first.heic');
    selectFile('second.heic');
    expect(mocks.convertHeicToJpeg).toHaveBeenCalledTimes(2);

    quickSecond.resolve(new File(['second-bytes'], 'second.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByText(/second\.jpg/)).toBeInTheDocument());
    const previewAfterSecond = await screen.findByAltText<HTMLImageElement>('Preview');
    const secondPreviewSrc = previewAfterSecond.src;

    // The abandoned first conversion finally lands.
    await waitFor(async () => {
      slowFirst.resolve(new File(['first-bytes'], 'first.jpg', { type: 'image/jpeg' }));
      await slowFirst.promise;
    });

    expect(screen.getByText(/second\.jpg/)).toBeInTheDocument();
    expect(screen.queryByText(/first\.jpg/)).not.toBeInTheDocument();
    expect(screen.getByAltText<HTMLImageElement>('Preview').src).toBe(secondPreviewSrc);
  });

  it('accepts a fresh selection after the previous one was cancelled', async () => {
    mocks.convertHeicToJpeg
      .mockResolvedValueOnce(new File(['first-bytes'], 'first.jpg', { type: 'image/jpeg' }))
      .mockResolvedValueOnce(new File(['second-bytes'], 'second.jpg', { type: 'image/jpeg' }));

    render(<PhotoUpload />);

    selectFile('first.heic');
    await screen.findByText(/first\.jpg/);

    fireEvent.click(screen.getByLabelText('Cancel upload'));
    expect(screen.queryByText(/first\.jpg/)).not.toBeInTheDocument();

    selectFile('second.heic');
    await screen.findByText(/second\.jpg/);
    expect(await screen.findByAltText('Preview')).toBeInTheDocument();
  });
});
