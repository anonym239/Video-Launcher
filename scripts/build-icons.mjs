// Erzeugt die Icon-Pfade in public/js/icons.js aus Google „Material Symbols“
// (Rounded, Stärke 500 – so kräftig wie die Symbole der YouTube-App, Apache-2.0).
//
//   npm pack @material-symbols/svg-500 && tar xzf material-symbols-svg-500-*.tgz
//   node scripts/build-icons.mjs ./package
import fs from 'node:fs';
import path from 'node:path';

const MAP = {
  // Kopf & Navigation
  menu: 'menu', search: 'search', mic: 'mic', back: 'arrow_back', close: 'close',
  bell: 'notifications', bellFilled: 'notifications-fill', bellOff: 'notifications_off', bellActive: 'notifications_active',
  home: 'home', homeFilled: 'home-fill', subs: 'subscriptions', subsFilled: 'subscriptions-fill',
  library: 'account_circle', libraryFilled: 'account_circle-fill', explore: 'explore', cast: 'cast',
  // Konto & „Mein YouTube“
  account: 'account_circle', accountBox: 'account_box', switchAccount: 'switch_account', incognito: 'domino_mask',
  myVideos: 'smart_display', movies: 'movie', logout: 'logout', theme: 'dark_mode', settings: 'settings', help: 'help',
  // Video-Aktionen
  like: 'thumb_up', likeFilled: 'thumb_up-fill', dislike: 'thumb_down', dislikeFilled: 'thumb_down-fill',
  share: 'reply', shareFilled: 'reply-fill', comment: 'chat', commentFilled: 'chat-fill',
  bookmark: 'bookmark', bookmarkFilled: 'bookmark-fill',
  save: 'playlist_add', download: 'download', addQueue: 'playlist_play', queue: 'queue_play_next',
  clock: 'schedule', history: 'history', playlist: 'playlist_play',
  dontRecommend: 'do_not_disturb_on', unsubscribe: 'person_remove', block: 'block',
  // Player
  play: 'play_arrow-fill', pause: 'pause-fill', next: 'skip_next-fill', prev: 'skip_previous-fill', replay: 'replay',
  volume: 'volume_up-fill', volumeLow: 'volume_down-fill', volumeOff: 'volume_off-fill',
  fullscreen: 'fullscreen', fullscreenExit: 'fullscreen_exit', cc: 'closed_caption', ccOn: 'closed_caption-fill',
  pip: 'picture_in_picture_alt', theater: 'crop_landscape', speed: 'speed', hd: 'hd-fill',
  fastForward: 'fast_forward-fill', fastRewind: 'fast_rewind-fill', shuffle: 'shuffle', repeat: 'repeat',
  // Sonstiges
  check: 'check', checkBox: 'check_box-fill', checkBoxBlank: 'check_box_outline_blank', add: 'add', sort: 'sort', tune: 'tune',
  delete: 'delete', trending: 'local_fire_department', music: 'music_note', gaming: 'sports_esports', news: 'newspaper',
  sports: 'trophy', live: 'sensors', info: 'info', down: 'keyboard_arrow_down', up: 'keyboard_arrow_up',
  right: 'chevron_right', left: 'chevron_left', verified: 'check_circle-fill', lock: 'lock', globe: 'language',
  link: 'link', heart: 'favorite-fill', pin: 'keep', upload: 'upload', refresh: 'refresh', edit: 'edit', send: 'send',
  external: 'open_in_new', expand: 'open_in_full', northWest: 'north_west', more: 'more_vert', moreH: 'more_horiz'
};

const src = process.argv[2];
if (!src) {
  console.error('Pfad zum entpackten Paket angeben (siehe Kopf der Datei).');
  process.exit(1);
}
const dir = path.join(src, 'rounded');
const lines = Object.entries(MAP).map(([k, f]) => {
  const svg = fs.readFileSync(path.join(dir, `${f}.svg`), 'utf8');
  const ds = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
  if (ds.length !== 1) throw new Error(`${f}: ${ds.length} Pfade`);
  return `  ${k}: '${ds[0]}'`;
});
const file = new URL('../public/js/icons.js', import.meta.url);
const js = fs.readFileSync(file, 'utf8');
const start = js.indexOf('const P = {');
const end = js.indexOf('};', start);
fs.writeFileSync(file, js.slice(0, start) + 'const P = {\n' + lines.join(',\n') + '\n' + js.slice(end));
console.log(`${lines.length} Symbole geschrieben.`);
