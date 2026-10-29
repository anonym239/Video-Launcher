// Kommentarbereich (Desktop: unter dem Video, Handy: ausklappbares Panel).
import { api, el, html, raw, qs } from '../util.js';
import { icon } from '../icons.js';
import { avatar, infinite, openMenu, toast, emptyState } from '../components.js';
import { signedIn, state } from '../state.js';

function commentNode(c, { onReplies } = {}) {
  const n = el(html`<div class="comment ${c.pinned ? 'pinned' : ''}">
    <a href="${c.author.id ? `/channel/${c.author.id}` : '#'}" class="c-avatar">${avatar(c.author.avatar, 40, c.author.name)}</a>
    <div class="c-main">
      ${c.pinned ? html`<div class="c-pinned">${raw(icon('pin'))} Angepinnt</div>` : ''}
      <div class="c-head"><a href="${c.author.id ? `/channel/${c.author.id}` : '#'}" class="c-author ${c.author.owner ? 'owner' : ''}">${c.author.name}</a>${c.author.verified ? raw(`<span class="verified">${icon('verified')}</span>`) : ''}<span class="c-time">${c.published}</span></div>
      <div class="c-text clamp">${raw(c.content)}</div>
      <button class="c-more-text" hidden>Mehr anzeigen</button>
      <div class="c-actions">
        <button class="icon-btn small c-like" aria-label="Mag ich">${raw(icon(c.liked ? 'likeFilled' : 'like'))}</button><span class="c-likes">${c.likes}</span>
        <button class="icon-btn small c-dislike" aria-label="Mag ich nicht">${raw(icon('dislike'))}</button>
        ${c.hearted ? html`<span class="c-heart" title="Vom Ersteller mit Herz markiert">${c.creatorAvatar ? raw(`<img src="${c.creatorAvatar}" alt="">`) : ''}${raw(icon('heart'))}</span>` : ''}
        <button class="btn btn-text small c-reply">Antworten</button>
      </div>
      ${c.thread && c.replies ? html`<button class="btn btn-text c-toggle-replies">${raw(icon('down'))} ${c.replies} ${c.replies === 1 ? 'Antwort' : 'Antworten'}</button>` : ''}
      <div class="c-replies" hidden></div>
    </div>
  </div>`);
  const text = n.querySelector('.c-text');
  requestAnimationFrame(() => {
    if (text.scrollHeight > text.clientHeight + 2) {
      const more = n.querySelector('.c-more-text');
      more.hidden = false;
      more.onclick = () => {
        const clamped = text.classList.toggle('clamp');
        more.textContent = clamped ? 'Mehr anzeigen' : 'Weniger anzeigen';
      };
    }
  });
  const toggle = n.querySelector('.c-toggle-replies');
  if (toggle) {
    const box = n.querySelector('.c-replies');
    let loaded = false;
    toggle.onclick = async () => {
      const open = box.hidden;
      box.hidden = !open;
      toggle.innerHTML = `${icon(open ? 'up' : 'down')} ${c.replies} ${c.replies === 1 ? 'Antwort' : 'Antworten'}`;
      if (open && !loaded) {
        loaded = true;
        box.innerHTML = '<div class="spinner"></div>';
        try {
          await loadReplies(box, c.thread, false);
        } catch (e) {
          box.textContent = e.message;
          loaded = false;
        }
      }
    };
  }
  const likeBtn = n.querySelector('.c-like');
  const dislikeBtn = n.querySelector('.c-dislike');
  likeBtn.classList.toggle('on', !!c.liked);
  const send = async (action) => {
    if (!signedIn() || !c.key) {
      toast('Melde dich an, um Kommentare zu bewerten.');
      return false;
    }
    try {
      await api('/api/comment/action', { method: 'POST', body: { key: c.key, action } });
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  };
  const paint = () => {
    likeBtn.innerHTML = icon(likeBtn.classList.contains('on') ? 'likeFilled' : 'like');
    dislikeBtn.innerHTML = icon(dislikeBtn.classList.contains('on') ? 'dislikeFilled' : 'dislike');
  };
  likeBtn.onclick = async () => {
    const on = !likeBtn.classList.contains('on');
    if (!(await send(on ? 'like' : 'unlike'))) return;
    likeBtn.classList.toggle('on', on);
    if (on) dislikeBtn.classList.remove('on');
    paint();
  };
  dislikeBtn.onclick = async () => {
    const on = !dislikeBtn.classList.contains('on');
    if (!(await send(on ? 'dislike' : 'undislike'))) return;
    dislikeBtn.classList.toggle('on', on);
    if (on) likeBtn.classList.remove('on');
    paint();
  };
  n.querySelector('.c-reply').onclick = () => {
    if (!signedIn() || !c.key) return toast('Melde dich an, um zu antworten.');
    if (n.querySelector('.c-reply-form')) return;
    const form = el(html`<form class="c-reply-form"><input name="text" placeholder="Antworten…" maxlength="10000"><div class="c-compose-actions"><button type="button" class="btn btn-text">Abbrechen</button><button class="btn btn-blue">Antworten</button></div></form>`);
    form.querySelector('button[type="button"]').onclick = () => form.remove();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = form.text.value.trim();
      if (!text) return;
      try {
        await api('/api/comment/action', { method: 'POST', body: { key: c.key, action: 'reply', text } });
        form.remove();
        toast('Antwort hinzugefügt');
      } catch (err) {
        toast(err.message);
      }
    };
    n.querySelector('.c-actions').after(form);
    form.text.focus();
  };
  return n;
}

async function loadReplies(box, cont, more) {
  const data = await api('/api/replies' + qs({ cont, more: more ? '1' : '' }));
  box.querySelector('.spinner')?.remove();
  box.querySelector('.c-more-replies')?.remove();
  for (const r of data.items) box.appendChild(commentNode(r));
  if (data.cont) {
    const b = el(`<button class="btn btn-text c-more-replies">${icon('right')} Weitere Antworten anzeigen</button>`);
    b.onclick = async () => {
      b.disabled = true;
      try {
        await loadReplies(box, data.cont, true);
      } catch (e) {
        toast(e.message);
        b.disabled = false;
      }
    };
    box.appendChild(b);
  }
}

export function mountComments(container, video, { signal, countHint = '' } = {}) {
  container.innerHTML = '';
  const root = el(html`<section class="comments">
    <button class="comments-teaser">
      <div class="ct-head"><b>Kommentare</b> <span class="ct-count">${countHint}</span></div>
      <div class="ct-preview"><div class="spinner small"></div></div>
    </button>
    <div class="comments-panel">
      <div class="comments-header">
        <h2><span class="ch-count">${countHint}</span> Kommentare</h2>
        <button class="btn btn-text c-sort">${raw(icon('sort'))} Sortieren nach</button>
        <button class="icon-btn comments-close" aria-label="Schließen">${raw(icon('close'))}</button>
      </div>
      <form class="c-compose">
        ${avatar(state.auth.account?.photo, 40, state.auth.account?.name || '?')}
        <div class="c-compose-main">
          <input name="text" placeholder="${signedIn() ? 'Kommentieren…' : 'Zum Kommentieren anmelden'}" ${signedIn() ? '' : raw('disabled')} maxlength="10000">
          <div class="c-compose-actions" hidden><button type="button" class="btn btn-text c-cancel">Abbrechen</button><button type="submit" class="btn btn-blue c-submit">Kommentieren</button></div>
        </div>
      </form>
      <div class="comments-list"></div>
    </div>
  </section>`);
  container.appendChild(root);
  const list = root.querySelector('.comments-list');
  const form = root.querySelector('.c-compose');
  let sort = 'top';
  let scroller = null;

  form.text.addEventListener('focus', () => (form.querySelector('.c-compose-actions').hidden = false));
  form.querySelector('.c-cancel').onclick = () => {
    form.text.value = '';
    form.querySelector('.c-compose-actions').hidden = true;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = form.text.value.trim();
    if (!text) return;
    try {
      await api('/api/comment', { method: 'POST', body: { id: video.id, text } });
      list.prepend(commentNode({ id: 'new', author: { name: state.auth.account?.name || 'Du', avatar: state.auth.account?.photo || '', id: state.auth.account?.channelId || '' }, content: text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]), published: 'gerade eben', likes: '', replies: 0 }));
      form.text.value = '';
      form.querySelector('.c-compose-actions').hidden = true;
      toast('Kommentar hinzugefügt');
    } catch (err) {
      toast(err.message);
    }
  };

  root.querySelector('.comments-teaser').onclick = () => {
    root.classList.add('open');
    document.body.classList.add('comments-open');
  };
  root.querySelector('.comments-close').onclick = () => {
    root.classList.remove('open');
    document.body.classList.remove('comments-open');
  };
  root.querySelector('.c-sort').onclick = (e) => {
    openMenu(e.currentTarget, [
      { label: 'Top-Kommentare', check: sort === 'top', run: () => load('top') },
      { label: 'Neueste zuerst', check: sort === 'new', run: () => load('new') }
    ]);
  };

  async function load(s) {
    sort = s;
    scroller?.stop();
    list.innerHTML = '<div class="spinner"></div>';
    let data;
    try {
      data = await api(`/api/comments/${video.id}` + qs({ sort: s }), { signal });
    } catch (e) {
      if (e.name === 'AbortError') return;
      list.innerHTML = '';
      list.appendChild(emptyState('Kommentare nicht verfügbar', e.message, 'comment'));
      root.querySelector('.ct-preview').textContent = 'Kommentare sind nicht verfügbar.';
      return;
    }
    list.innerHTML = '';
    if (data.count) {
      root.querySelector('.ch-count').textContent = data.count;
      root.querySelector('.ct-count').textContent = data.count;
    }
    const first = data.items[0];
    const prev = root.querySelector('.ct-preview');
    prev.innerHTML = '';
    if (first) {
      prev.appendChild(el(html`<div class="ct-first">${avatar(first.author.avatar, 24, first.author.name)}<span class="ct-text">${raw(first.content)}</span></div>`));
    } else {
      prev.textContent = 'Noch keine Kommentare.';
    }
    if (!data.items.length) {
      list.appendChild(emptyState('Keine Kommentare', 'Sei der Erste, der kommentiert.', 'comment'));
      return;
    }
    for (const c of data.items) list.appendChild(commentNode(c));
    let cont = data.cont;
    if (cont) {
      scroller = infinite(list, async () => {
        const more = await api(`/api/comments/${video.id}` + qs({ cont }), { signal });
        for (const c of more.items) list.appendChild(commentNode(c));
        cont = more.cont;
        return !!cont;
      }, { signal });
    }
  }

  // Erst laden, wenn der Bereich sichtbar wird (spart Anfragen).
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      load('top');
    }
  }, { rootMargin: '400px' });
  io.observe(root);
  signal?.addEventListener('abort', () => {
    io.disconnect();
    document.body.classList.remove('comments-open');
  });
  return root;
}
