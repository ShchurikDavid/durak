import { localize } from './translations.js';
let language = ['ru', 'uk', 'en'].includes(localStorage.getItem('durak.language'))
  ? localStorage.getItem('durak.language')
  : 'ru';
export function translate(text, lang = language) {
  return localize(text, lang);
}
export function initLanguage() {
  const originals = new WeakMap();
  const attributes = new WeakMap();
  const ignored =
    'script,style,[translate="no"],.room-code,.friend-code,#friendInput,#settingsName,#authName';
  function apply(root = document.body) {
    if (root.nodeType === 3) {
      const parent = root.parentElement;
      if (!parent || parent.closest(ignored)) return;
      const previous = originals.get(root);
      const source =
        previous && root.textContent === previous.output ? previous.source : root.textContent;
      const output = translate(source);
      originals.set(root, { source, output });
      if (root.textContent !== output) root.textContent = output;
      return;
    }
    if (root.nodeType !== 1 || root.matches(ignored)) return;
    for (const attr of ['placeholder', 'aria-label', 'title']) {
      if (!root.hasAttribute(attr)) continue;
      const saved = attributes.get(root) || {};
      const current = root.getAttribute(attr);
      const source = saved[attr]?.output === current ? saved[attr].source : current;
      const output = translate(source);
      saved[attr] = { source, output };
      attributes.set(root, saved);
      if (current !== output) root.setAttribute(attr, output);
    }
    for (const child of root.childNodes) apply(child);
  }
  const selects = [...document.querySelectorAll('#languageSelect,[data-language]')];
  for (const select of selects) select.value = language;
  function update() {
    document.documentElement.lang = language;
    apply();
  }
  for (const select of selects)
    select.onchange = () => {
      language = select.value;
      for (const other of selects) other.value = language;
      localStorage.setItem('durak.language', language);
      update();
    };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') for (const node of record.addedNodes) apply(node);
      else apply(record.target);
    }
  });
  update();
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['title', 'aria-label', 'placeholder']
  });
}
