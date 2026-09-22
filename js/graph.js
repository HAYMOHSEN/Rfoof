// ============================================================
//  Rfoof – Microsoft Graph client (OneDrive app folder)
// ============================================================
import { auth, AuthError } from './auth.js';
import { LIMITS } from './config.js';
import { sleep } from './utils.js';

const BASE = 'https://graph.microsoft.com/v1.0';

export class GraphError extends Error {
  constructor(msg, status, code) { super(msg); this.status = status; this.code = code || ''; }
}

export class GraphClient {
  constructor(getToken = () => auth.getToken()) { this.getToken = getToken; }

  async request(path, { method = 'GET', headers = {}, body, raw = false, retries = 4 } = {}) {
    const url = path.startsWith('http') ? path : BASE + path;
    let attempt = 0; let forced = false;
    for (;;) {
      const token = await this.getToken({ force: forced });
      const h = { Authorization: 'Bearer ' + token, ...headers };
      if (body && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof Uint8Array) && typeof body !== 'string') { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
      let res;
      try { res = await fetch(url, { method, headers: h, body }); }
      catch (e) { if (attempt++ < retries) { await sleep(800 * attempt); continue; } throw new GraphError('Network error', 0, 'network'); }
      if (res.status === 401 && !forced) { forced = true; continue; }
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt++ < retries) {
        const ra = +res.headers.get('Retry-After') || Math.min(30, 2 ** attempt);
        await sleep(ra * 1000); continue;
      }
      if (!res.ok) {
        let code = '', msg = `HTTP ${res.status}`;
        try { const j = await res.json(); code = j.error?.code || ''; msg = j.error?.message || msg; } catch { /* ignore */ }
        throw new GraphError(msg, res.status, code);
      }
      if (raw) return res;
      if (res.status === 204) return null;
      const ct = res.headers.get('Content-Type') || '';
      return ct.includes('json') ? res.json() : res;
    }
  }

  // ---- identity ----
  me() { return this.request('/me?$select=displayName,userPrincipalName,mail,id'); }
  async photo() {
    try {
      const res = await this.request('/me/photos/96x96/$value', { raw: true });
      return await res.blob();
    } catch { return null; }
  }
  driveQuota() { return this.request('/me/drive?$select=quota'); }

  // ---- app root ----
  approot() { return this.request('/me/drive/special/approot?$select=id,name,webUrl,parentReference'); }
  children(itemId) { return this._collect(`/me/drive/items/${itemId}/children?$select=id,name,size,eTag,cTag,file,folder,deleted,lastModifiedDateTime,parentReference&$top=200`); }
  async _collect(path) {
    let out = []; let next = path;
    while (next) { const j = await this.request(next); out = out.concat(j.value || []); next = j['@odata.nextLink']; }
    return out;
  }
  item(itemId) { return this.request(`/me/drive/items/${itemId}?$select=id,name,size,eTag,cTag,file,folder,deleted,lastModifiedDateTime,parentReference,@microsoft.graph.downloadUrl`); }
  itemByPath(rootId, relPath) {
    const enc = relPath.split('/').map(encodeURIComponent).join('/');
    return this.request(`/me/drive/items/${rootId}:/${enc}?$select=id,name,size,eTag,file,folder,parentReference`);
  }

  async createFolder(parentId, name) {
    return this.request(`/me/drive/items/${parentId}/children`, {
      method: 'POST', body: { name, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' },
    });
  }
  async ensureFolder(parentId, name) {
    // returns existing folder with that name or creates it
    try {
      const enc = encodeURIComponent(name);
      const it = await this.request(`/me/drive/items/${parentId}:/${enc}?$select=id,name,folder,parentReference`);
      if (it && it.folder) return it;
    } catch (e) { if (e.status !== 404) throw e; }
    return this.request(`/me/drive/items/${parentId}/children`, { method: 'POST', body: { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' } })
      .catch(async (e) => { if (e.status === 409) return this.request(`/me/drive/items/${parentId}:/${encodeURIComponent(name)}`); throw e; });
  }

  patch(itemId, body) { return this.request(`/me/drive/items/${itemId}`, { method: 'PATCH', body }); }
  rename(itemId, name) { return this.patch(itemId, { name, '@microsoft.graph.conflictBehavior': 'rename' }); }
  move(itemId, parentId, name) { return this.patch(itemId, { parentReference: { id: parentId }, ...(name ? { name } : {}), '@microsoft.graph.conflictBehavior': 'rename' }); }
  delete(itemId) { return this.request(`/me/drive/items/${itemId}`, { method: 'DELETE' }).catch(e => { if (e.status === 404) return null; throw e; }); }

  // ---- upload ----
  async upload(parentId, name, blob, onProgress, conflict = 'rename') {
    const enc = encodeURIComponent(name);
    if (blob.size <= LIMITS.smallUpload) {
      return this.request(`/me/drive/items/${parentId}:/${enc}:/content?@microsoft.graph.conflictBehavior=${conflict}`, {
        method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      });
    }
    const session = await this.request(`/me/drive/items/${parentId}:/${enc}:/createUploadSession`, {
      method: 'POST', body: { item: { '@microsoft.graph.conflictBehavior': conflict, name } },
    });
    const url = session.uploadUrl;
    const chunk = LIMITS.uploadChunk;
    let offset = 0; let item = null;
    while (offset < blob.size) {
      const end = Math.min(offset + chunk, blob.size);
      const part = blob.slice(offset, end);
      let res; let tries = 0;
      for (;;) {
        try {
          res = await fetch(url, { method: 'PUT', headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${blob.size}`, 'Content-Length': String(end - offset) }, body: part });
        } catch (e) { if (tries++ < 4) { await sleep(1000 * tries); continue; } throw new GraphError('Network error during upload', 0, 'network'); }
        if (res.status === 429 || res.status >= 500) { if (tries++ < 4) { await sleep((+res.headers.get('Retry-After') || 2 * tries) * 1000); continue; } throw new GraphError('Upload failed', res.status); }
        if (res.status === 416) { // range already received – query status
          const st = await fetch(url).then(r => r.json()).catch(() => null);
          const next = st?.nextExpectedRanges?.[0]; if (next) { offset = +next.split('-')[0]; break; }
        }
        if (!res.ok) throw new GraphError('Upload failed', res.status);
        break;
      }
      if (res.status === 200 || res.status === 201) { item = await res.json(); offset = blob.size; }
      else if (res.status === 202) { const j = await res.json().catch(() => ({})); const next = j.nextExpectedRanges?.[0]; offset = next ? +next.split('-')[0] : end; }
      onProgress?.(Math.min(offset, blob.size), blob.size);
    }
    if (!item) item = await this.request(`/me/drive/items/${parentId}:/${enc}`);
    return item;
  }

  // ---- download ----
  async download(itemId, onProgress) {
    const it = await this.item(itemId);
    const url = it['@microsoft.graph.downloadUrl'];
    if (!url) throw new GraphError('No download URL', 404, 'noUrl');
    const res = await fetch(url);
    if (!res.ok) throw new GraphError('Download failed', res.status);
    if (onProgress && res.body && it.size) {
      const reader = res.body.getReader(); const chunks = []; let got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress(got, it.size); }
      return { blob: new Blob(chunks, { type: it.file?.mimeType || 'application/octet-stream' }), item: it };
    }
    const blob = await res.blob();
    return { blob: blob.type ? blob : new Blob([blob], { type: it.file?.mimeType || 'application/octet-stream' }), item: it };
  }

  // Convert an Office file to PDF via OneDrive (docx, pptx, xlsx, doc, ppt, xls, odt, odp, ods, rtf …)
  async convertToPdf(itemId) {
    const res = await this.request(`/me/drive/items/${itemId}/content?format=pdf`, { raw: true });
    return res.blob();
  }
  async thumbnail(itemId, size = 'large') {
    const j = await this.request(`/me/drive/items/${itemId}/thumbnails/0/${size}`);
    return j?.url || null;
  }

  // ---- delta ----
  async delta(rootId, link) {
    let items = []; let next = link || `/me/drive/items/${rootId}/delta?$select=id,name,size,eTag,cTag,file,folder,deleted,lastModifiedDateTime,parentReference`;
    let deltaLink = '';
    while (next) {
      const j = await this.request(next);
      items = items.concat(j.value || []);
      if (j['@odata.deltaLink']) { deltaLink = j['@odata.deltaLink']; break; }
      next = j['@odata.nextLink'];
    }
    return { items, deltaLink };
  }

  // ---- small JSON helpers ----
  async getJson(parentId, name) {
    try {
      const res = await this.request(`/me/drive/items/${parentId}:/${encodeURIComponent(name)}:/content`, { raw: true });
      return await res.json();
    } catch (e) { if (e.status === 404) return null; throw e; }
  }
  putJson(parentId, name, obj) {
    const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
    return this.upload(parentId, name, blob, null, 'replace');
  }

  // Full recursive listing (fallback when delta is unavailable)
  async walk(rootId) {
    const out = []; const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      const kids = await this.children(id);
      for (const it of kids) { out.push(it); if (it.folder) stack.push(it.id); }
    }
    return out;
  }
}

export { AuthError };
