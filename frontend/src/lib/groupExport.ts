import { strToU8, zipSync } from 'fflate';
import { api } from './api';

function safeFileName(value: string): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'photodrop-export';
}

/** Download the converted archive photos and package them with readable metadata. */
export async function exportGroup(groupId: string): Promise<void> {
  const manifest = await api.groups.getExport(groupId);
  const files: Record<string, Uint8Array> = {};

  // Keep only a few authenticated downloads in flight so large groups don't
  // create an avoidable spike of network and browser memory pressure.
  const pending = [...manifest.photos];
  const workers = Array.from({ length: Math.min(3, pending.length) }, async () => {
    while (pending.length > 0) {
      const photo = pending.shift();
      if (!photo) return;
      const blob = await api.photos.downloadBlob(photo.id);
      files[`photos/${photo.fileName}`] = new Uint8Array(await blob.arrayBuffer());
    }
  });
  await Promise.all(workers);

  files['metadata.json'] = strToU8(JSON.stringify(manifest, null, 2));
  const zipped = zipSync(files, { level: 0 });
  const zipBuffer = zipped.buffer.slice(
    zipped.byteOffset,
    zipped.byteOffset + zipped.byteLength
  ) as ArrayBuffer;
  const blob = new Blob([zipBuffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileName(manifest.groupName)}-photodrop-export.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
