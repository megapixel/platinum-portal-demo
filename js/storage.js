// storage (StorageProvider). Production: S3-compatible bucket in Singapore.
import { safeGet, safeSet } from './utils.js';

const FILE_PREFIX = 'pi_file_';
export const storage = {
  objectUrls: new Map(),
  /** put(docId, file): keeps bytes in memory and tries to persist small files for other tabs. */
  async put(docId, file) {
    this.objectUrls.set(docId, URL.createObjectURL(file));
    if (file.size <= 1.5 * 1024 * 1024) {
      const dataUrl = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => resolve(null);
        r.readAsDataURL(file);
      });
      if (dataUrl) safeSet(window.localStorage, FILE_PREFIX + docId, dataUrl);
    }
  },
  /** url(docId): an object URL, or null when the bytes are no longer available. */
  url(docId) {
    if (this.objectUrls.has(docId)) return this.objectUrls.get(docId);
    const dataUrl = safeGet(window.localStorage, FILE_PREFIX + docId);
    if (!dataUrl) return null;
    try {
      const [meta, b64] = dataUrl.split(',');
      const mime = meta.slice(5).split(';')[0];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const u = URL.createObjectURL(new Blob([bytes], { type: mime }));
      this.objectUrls.set(docId, u);
      return u;
    } catch (e) { return null; }
  },
  /** bytes(docId): the stored file as an ArrayBuffer, or null when it is not available (e.g. seeded specimens). */
  async bytes(docId) {
    const u = this.url(docId);
    if (!u) return null;
    try { return await (await fetch(u)).arrayBuffer(); } catch (e) { return null; }
  },
  clearAll() {
    this.objectUrls.forEach((u) => URL.revokeObjectURL(u));
    this.objectUrls.clear();
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(FILE_PREFIX)) keys.push(k); }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
  },
};
