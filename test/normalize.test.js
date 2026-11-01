import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Parser } from 'youtubei.js';
import { collectItems, pageRoots, textToHtml, rewriteLink, parseDuration, formatDuration, txt, thumb } from '../server/normalize.js';
import { parseFeed } from '../server/rss.js';
import { rewriteM3U8, isAllowedUpstream } from '../server/stream.js';

const fixture = (name) => Parser.parseResponse(JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')));

test('Startseite: Videos, Shorts-Regal und neues Lockup-Layout werden erkannt, Werbung entfernt', () => {
  const items = collectItems(pageRoots(fixture('feed')));
  assert.equal(items.length, 3);

  const [video, shelf, lockup] = items;
  assert.equal(video.type, 'video');
  assert.equal(video.id, 'dQw4w9WgXcQ');
  assert.equal(video.title, 'Never Gonna Give You Up');
  assert.equal(video.duration, '3:33');
  assert.equal(video.durationSec, 213);
  assert.equal(video.live, false);
  assert.equal(video.channel.id, 'UCuAXFkgsw1L7xaCfnd5JJOw');
  assert.equal(video.channel.avatar, 'https://yt3.ggpht.com/rick.jpg');

  assert.equal(shelf.type, 'shelf');
  assert.equal(shelf.shorts, true);
  assert.deepEqual(shelf.items.map((s) => s.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.equal(shelf.items[0].title, 'Lustiges Short');

  assert.equal(lockup.type, 'video');
  assert.equal(lockup.id, 'abcdefghijk');
  assert.equal(lockup.duration, '12:34');
  assert.equal(lockup.views, '5.000 Aufrufe');
  assert.equal(lockup.published, 'vor 2 Tagen');
  assert.equal(lockup.channel.name, 'Testkanal');
  assert.equal(lockup.channel.id, 'UCabcdefghijklmnopqrstuv');

  assert.ok(!JSON.stringify(items).includes('ad1'), 'Werbung darf nicht auftauchen');
});

test('flatten: Regale werden aufgelöst', () => {
  const items = collectItems(pageRoots(fixture('feed')), { flatten: true });
  assert.deepEqual(items.map((i) => i.type), ['video', 'short', 'short', 'video']);
});

test('Suche: Kanal und Playlist, Anzeigen entfernt', () => {
  const items = collectItems(pageRoots(fixture('search')));
  assert.deepEqual(items.map((i) => i.type), ['channel', 'playlist']);
  const [ch, pl] = items;
  assert.equal(ch.handle, '@RickAstleyYT');
  assert.equal(ch.subscribers, '4,2 Mio. Abonnenten');
  assert.equal(ch.avatar, 'https://yt3.ggpht.com/rick176.jpg');
  assert.equal(pl.id, 'PLabcdefghijklmnop');
  assert.equal(pl.count, '25 Videos');
  assert.equal(pl.firstVideoId, 'dQw4w9WgXcQ');
  assert.equal(pl.channel.name, 'Musikfan');
});

test('Text- und Link-Hilfen', () => {
  assert.equal(txt(null), '');
  assert.equal(txt('a'), 'a');
  assert.equal(txt({ runs: [{ text: 'a' }, { text: 'b' }] }), 'ab');
  assert.equal(parseDuration('1:02:03'), 3723);
  assert.equal(parseDuration('LIVE'), 0);
  assert.equal(formatDuration(3723), '1:02:03');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(thumb([{ url: '//a', width: 100 }, { url: '//b', width: 2000 }], 720), 'https://a');
  assert.equal(rewriteLink('https://www.youtube.com/redirect?q=https%3A%2F%2Fexample.com'), 'https://example.com');
  assert.equal(rewriteLink('https://www.youtube.com/watch?v=abc&t=5s'), '/watch?v=abc&t=5s');
  assert.equal(rewriteLink('https://youtu.be/dQw4w9WgXcQ'), '/watch?v=dQw4w9WgXcQ');
});

test('textToHtml escaped HTML und verlinkt Zeitstempel', () => {
  const html = textToHtml({
    runs: [
      { text: '<script>x</script> ' },
      { text: '1:30', endpoint: { payload: { videoId: 'dQw4w9WgXcQ', startTimeSeconds: 90 }, metadata: { url: '/watch?v=dQw4w9WgXcQ&t=90s' } } },
      { text: '\nhttps://example.com' }
    ]
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('data-seek="90"'));
  assert.ok(html.includes('<br>'));
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test('RSS-Feed eines Kanals wird gelesen (Shorts erkannt)', () => {
  const xml = `<?xml version="1.0"?><feed><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>Video &amp; mehr</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/><author><name>Rick</name></author>
    <published>2024-01-02T10:00:00+00:00</published><media:group><media:statistics views="1234"/></media:group></entry>
    <entry><yt:videoId>aaaaaaaaaaa</yt:videoId><title>Kurz</title><link rel="alternate" href="https://www.youtube.com/shorts/aaaaaaaaaaa"/>
    <published>2024-01-03T10:00:00+00:00</published></entry></feed>`;
  const items = parseFeed(xml, { id: 'UCx', name: 'Rick', avatar: '' });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Video & mehr');
  assert.equal(items[0].type, 'video');
  assert.equal(items[0].views, '1.234 Aufrufe');
  assert.equal(items[1].type, 'short');
  assert.ok(items[1].publishedAt > items[0].publishedAt);
});

test('Proxy: nur YouTube-Video-Hosts erlaubt', () => {
  assert.ok(isAllowedUpstream('https://rr1---sn-abc.googlevideo.com/videoplayback?x=1'));
  assert.ok(isAllowedUpstream('https://manifest.googlevideo.com/api/manifest/hls_variant/x'));
  assert.ok(isAllowedUpstream('https://www.youtube.com/api/timedtext?v=x'));
  assert.ok(!isAllowedUpstream('https://www.youtube.com/watch?v=x'));
  assert.ok(!isAllowedUpstream('http://rr1---sn-abc.googlevideo.com/videoplayback'));
  assert.ok(!isAllowedUpstream('https://evil.com/?googlevideo.com'));
  assert.ok(!isAllowedUpstream('https://googlevideo.com.evil.com/'));
  assert.ok(!isAllowedUpstream('file:///etc/passwd'));
  assert.ok(!isAllowedUpstream('nonsense'));
});

test('HLS-Playlists werden auf den Proxy umgeschrieben', () => {
  const out = rewriteM3U8('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nseg1.ts\nhttps://rr1.googlevideo.com/seg2.ts\n', 'https://manifest.googlevideo.com/api/manifest/hls_playlist/a/index.m3u8');
  const lines = out.split('\n');
  assert.equal(lines[0], '#EXTM3U');
  assert.ok(lines[1].startsWith('#EXT-X-MAP:URI="/vp?u=https%3A%2F%2Fmanifest.googlevideo.com%2Fapi%2Fmanifest%2Fhls_playlist%2Fa%2Finit.mp4"'));
  assert.equal(lines[2], '/vp?u=' + encodeURIComponent('https://manifest.googlevideo.com/api/manifest/hls_playlist/a/seg1.ts'));
  assert.equal(lines[3], '/vp?u=' + encodeURIComponent('https://rr1.googlevideo.com/seg2.ts'));
});

test('TV-Kacheln (Anmeldung per Geräte-Code) werden gelesen', async () => {
  const { itemsFromTvRaw } = await import('../server/normalize.js');
  const tile = (id, type, title, lines, duration) => ({ tileRenderer: {
    contentId: id, contentType: type,
    header: { tileHeaderRenderer: { thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` }] }, thumbnailOverlays: duration ? [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: duration } } }] : [] } },
    metadata: { tileMetadataRenderer: { title: { simpleText: title }, lines: lines.map((l) => ({ lineRenderer: { items: l.map((t) => ({ lineItemRenderer: { text: { simpleText: t } } })) } })) } }
  } });
  const raw = { contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content: { gridRenderer: { items: [
    tile('aaaaaaaaaaa', 'TILE_CONTENT_TYPE_VIDEO', 'Erstes Video', [['Kanal A'], ['1.234 Aufrufe', '•', 'vor 2 Tagen']], '12:34'),
    tile('bbbbbbbbbbb', 'TILE_CONTENT_TYPE_SHORTS', 'Ein Short', [['5 Mio. Aufrufe']]),
    tile('UCxxxxxxxxxxxxxxxxxxxxxx', 'TILE_CONTENT_TYPE_CHANNEL', 'Kanal', [])
  ] } } } } } } };
  const items = itemsFromTvRaw(raw);
  assert.equal(items.length, 2);
  assert.equal(items[0].type, 'video');
  assert.equal(items[0].title, 'Erstes Video');
  assert.equal(items[0].duration, '12:34');
  assert.equal(items[0].views, '1.234 Aufrufe');
  assert.equal(items[0].published, 'vor 2 Tagen');
  assert.equal(items[0].channel.name, 'Kanal A');
  assert.equal(items[1].type, 'short');
});

test('Eilmeldung-Regal wird ausgeblendet, außer bei Nachrichten-Suche', async () => {
  const { collectItems } = await import('../server/normalize.js');
  const vid = (id) => ({ type: 'Video', video_id: id, title: { text: 'Video ' + id }, author: { name: 'K', id: 'UC1' } });
  const root = [
    vid('aaaaaaaaaaa'),
    { type: 'Shelf', title: { text: 'Eilmeldung' }, content: { type: 'VerticalList', contents: [vid('bbbbbbbbbbb'), vid('ccccccccccc')] } },
    vid('ddddddddddd')
  ];
  const normal = collectItems(root);
  assert.ok(!normal.some((i) => i.type === 'shelf'), 'kein Eilmeldung-Regal');
  assert.deepEqual(normal.map((i) => i.id), ['aaaaaaaaaaa', 'ddddddddddd']);
  const news = collectItems(root, { news: true });
  assert.ok(news.some((i) => i.type === 'shelf' && i.title === 'Eilmeldung'));
});

test('Nachrichten-Regale mit anderen Titeln werden ebenfalls ausgeblendet', async () => {
  const { collectItems } = await import('../server/normalize.js');
  const vid = (id) => ({ type: 'Video', video_id: id, title: { text: 'Video ' + id }, author: { name: 'K', id: 'UC1' } });
  for (const t of ['Top-Nachrichten', 'Breaking News', 'Schlagzeilen', 'Aktuelles']) {
    const items = collectItems([{ type: 'RichShelf', title: { text: t }, contents: [vid('bbbbbbbbbbb')] }, vid('aaaaaaaaaaa')]);
    assert.deepEqual(items.map((i) => i.type), ['video'], t);
  }
  const shorts = collectItems([{ type: 'ReelShelf', title: { text: 'Shorts' }, items: [vid('ccccccccccc')] }]);
  assert.equal(shorts[0].type, 'shelf', 'normale Regale bleiben');
});
