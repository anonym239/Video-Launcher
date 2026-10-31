import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAccount } from '../server/yt.js';

test('Kontodaten aus dem Web-Kontomenü (activeAccountHeaderRenderer)', () => {
  const raw = {
    actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: {
      header: { activeAccountHeaderRenderer: {
        accountName: { simpleText: 'Max Mustermann' },
        accountPhoto: { thumbnails: [{ url: 'https://yt3.ggpht.com/abc=s88-c-k-c0x00ffffff-no-rj', width: 88, height: 88 }] },
        channelHandle: { simpleText: '@maxm' }
      } },
      sections: [{ multiPageMenuSectionRenderer: { items: [{ compactLinkRenderer: {
        title: { simpleText: 'Dein Kanal' },
        navigationEndpoint: { browseEndpoint: { browseId: 'UCabcdefghijklmnopqrstuv' } }
      } }] } }]
    } } } }]
  };
  assert.deepEqual(extractAccount(raw), {
    name: 'Max Mustermann',
    handle: '@maxm',
    photo: 'https://yt3.ggpht.com/abc=s176-c-k-c0x00ffffff-no-rj',
    channelId: 'UCabcdefghijklmnopqrstuv'
  });
});

test('Kontodaten aus der TV-Kontoliste (accountItem, ausgewähltes Konto)', () => {
  const raw = {
    contents: [{ accountSectionListRenderer: { contents: [{ accountItemSectionRenderer: { contents: [
      { accountItem: { accountName: { runs: [{ text: 'Zweitkonto' }] }, accountPhoto: { thumbnails: [{ url: '//yt3.ggpht.com/x=s48' }] }, isSelected: false } },
      { accountItem: { accountName: { runs: [{ text: 'Hauptkonto' }] }, accountPhoto: { thumbnails: [{ url: '//yt3.ggpht.com/y=s48' }] }, isSelected: true, channelHandle: { simpleText: '@haupt' } } }
    ] } }] } }]
  };
  const acc = extractAccount(raw);
  assert.equal(acc.name, 'Hauptkonto');
  assert.equal(acc.handle, '@haupt');
  assert.equal(acc.photo, 'https://yt3.ggpht.com/y=s176');
});

test('Keine Kontodaten → null', () => {
  assert.equal(extractAccount({ contents: [] }), null);
});
