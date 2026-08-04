import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

const mocks = vi.hoisted(() => ({
  getExport: vi.fn(),
  downloadBlob: vi.fn(),
}));

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    statusText: string;

    constructor(status: number, statusText: string, message: string) {
      super(message);
      this.status = status;
      this.statusText = statusText;
    }
  },
  api: {
    groups: { getExport: mocks.getExport },
    photos: { downloadBlob: mocks.downloadBlob },
  },
}));

import { ApiError } from './api';
import { exportGroup } from './groupExport';

describe('exportGroup', () => {
  let exportedBlob: Blob | undefined;

  beforeEach(() => {
    mocks.getExport.mockReset();
    mocks.downloadBlob.mockReset();
    exportedBlob = undefined;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        exportedBlob = blob;
        return 'blob:export';
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mocks.getExport.mockResolvedValue({
      groupName: 'Our Family',
      exportedAt: 123,
      photos: [
        {
          id: 'photo-1',
          caption: 'First steps',
          uploadedAt: 100,
          uploaderName: 'Alice',
          fileName: 'first.jpg',
        },
        {
          id: 'photo-2',
          caption: null,
          uploadedAt: 90,
          uploaderName: 'Bob',
          fileName: 'second.jpg',
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries transient failures, reports progress, and creates a valid archive', async () => {
    mocks.downloadBlob
      .mockRejectedValueOnce(new TypeError('network interrupted'))
      .mockResolvedValueOnce(new Blob([new Uint8Array([1, 2, 3])]))
      .mockResolvedValueOnce(new Blob([new Uint8Array([4, 5])]))
      .mockResolvedValueOnce(new Blob([new Uint8Array([9])]))
      .mockResolvedValueOnce(new Blob([new Uint8Array([8])]));
    const progress = vi.fn();

    await exportGroup('group-1', progress);

    expect(mocks.downloadBlob).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenNthCalledWith(1, { completed: 1, total: 2 });
    expect(progress).toHaveBeenNthCalledWith(2, { completed: 2, total: 2 });
    expect(exportedBlob).toBeDefined();

    const archive = unzipSync(new Uint8Array(await exportedBlob!.arrayBuffer()));
    expect([...archive['photos/first.jpg']]).toEqual([1, 2, 3]);
    expect([...archive['photos/second.jpg']]).toEqual([4, 5]);
    expect(JSON.parse(strFromU8(archive['metadata.json']))).toMatchObject({
      groupName: 'Our Family',
      photos: [{ id: 'photo-1' }, { id: 'photo-2' }],
    });
  });

  it('does not retry a permanent API error and identifies the failed photo', async () => {
    mocks.downloadBlob.mockRejectedValue(
      new ApiError(404, 'Not Found', 'Photo is no longer available')
    );

    await expect(exportGroup('group-1')).rejects.toThrow(
      'Could not download first.jpg (photo-1), photo 1 of 2: Photo is no longer available'
    );
    expect(mocks.downloadBlob).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('backs off before retrying a rate-limited download', async () => {
    vi.useFakeTimers();
    mocks.getExport.mockResolvedValue({
      groupName: 'Our Family',
      exportedAt: 123,
      photos: [
        {
          id: 'photo-1',
          caption: null,
          uploadedAt: 100,
          uploaderName: 'Alice',
          fileName: 'first.jpg',
        },
      ],
    });
    mocks.downloadBlob
      .mockRejectedValueOnce(new ApiError(429, 'Too Many Requests', 'Slow down'))
      .mockResolvedValueOnce(new Blob([new Uint8Array([1])]));

    const exportPromise = exportGroup('group-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.downloadBlob).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(499);
    expect(mocks.downloadBlob).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    await exportPromise;
    expect(mocks.downloadBlob).toHaveBeenCalledTimes(2);
  });

  it('stops after three attempts when a transient failure persists', async () => {
    mocks.downloadBlob.mockRejectedValue(new TypeError('connection lost'));

    await expect(exportGroup('group-1')).rejects.toThrow(
      'Could not download first.jpg (photo-1), photo 1 of 2: connection lost'
    );
    expect(mocks.downloadBlob).toHaveBeenCalledTimes(3);
  });
});
