(() => {
  'use strict';

  const icons = {
    '🔇': 'sound-off', '🔊': 'sound-on', '🎵': 'sound-on',
    '🃏': 'cards', '⚙': 'settings', '🎮': 'game',
    '👥': 'players', '➕': 'plus', '🔗': 'link',
    '🔔': 'bell', '🔉': 'sound-on', '🔈': 'sound-on', '🎨': 'palette'
  };
  const pattern = /(🔇|🔊|🎵|🃏|⚙\uFE0F?|🎮|👥|➕|🔗|🔔|🔉|🔈|🎨)/gu;

  function replaceText(node) {
    if (!node.parentElement || node.parentElement.closest('script,style,textarea,option,[contenteditable]')) return;
    const text = node.nodeValue;
    const matches = [...text.matchAll(pattern)];
    if (!matches.length) return;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      fragment.append(text.slice(offset, match.index));
      const name = icons[match[0].replace('\uFE0F', '')];
      const img = document.createElement('img');
      img.src = `/icons/${name}.svg`;
      img.className = `ui-icon ui-icon-${name}`;
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.draggable = false;
      fragment.append(img);
      offset = match.index + match[0].length;
    }
    fragment.append(text.slice(offset));
    node.replaceWith(fragment);
  }

  function replaceIcons(root) {
    if (root.nodeType === Node.TEXT_NODE) return replaceText(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(replaceText);
  }

  replaceIcons(document.body);
  // Music toggles, room lists and game updates rebuild their text dynamically.
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') replaceIcons(record.target);
      else record.addedNodes.forEach(replaceIcons);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
})();
