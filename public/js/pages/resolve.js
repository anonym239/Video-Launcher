// Leitet alte Link-Formate (/c/…, /user/…, youtu.be/ID) auf die passende Seite um.
import { api } from '../util.js';
import { go } from '../router.js';

export default async function resolve({ node, signal }) {
  const path = location.pathname;
  const short = path.match(/^\/([A-Za-z0-9_-]{11})$/);
  if (short) {
    const t = new URLSearchParams(location.search).get('t');
    go(`/watch?v=${short[1]}${t ? `&t=${t}` : ''}`, { replace: true });
    return;
  }
  node.innerHTML = '<div class="spinner"></div>';
  const r = await api(`/api/resolve?url=${encodeURIComponent(path)}`, { signal });
  if (r.type === 'channel') go(`/channel/${r.id}`, { replace: true });
  else if (r.type === 'video') go(`/watch?v=${r.id}`, { replace: true });
  else if (r.type === 'playlist') go(`/playlist?list=${r.id}`, { replace: true });
  else node.innerHTML = '<div class="empty-state"><h2>Diese Seite gibt es nicht.</h2></div>';
}
