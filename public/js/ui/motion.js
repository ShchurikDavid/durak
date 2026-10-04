const running = new WeakMap();
const cards = () => [...document.querySelectorAll('#hand img.card, #table img.card')];
const surface = (card) => card.closest('.durak-card-filter') || card;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function captureCards() {
  if (reduced()) return new Map();
  const elements = cards();
  const positions = new Map(
    elements.map((card) => [card.dataset.code, surface(card).getBoundingClientRect()])
  );
  for (const card of elements) running.get(surface(card))?.cancel();
  return positions;
}

export function animateCards(before) {
  if (reduced()) return;
  // Measure together before starting animations; preserve CSS rotation and highlights.
  const items = cards().map((card) => ({ card, rect: surface(card).getBoundingClientRect() }));
  for (const { card, rect } of items) {
    if (!rect.width || !card.animate) continue;
    const old = before.get(card.dataset.code);
    const x = old ? old.left - rect.left : 0;
    const y = old ? old.top - rect.top : 12;
    if (old && Math.abs(x) < 1 && Math.abs(y) < 1) continue;
    const target = surface(card);
    running.get(target)?.cancel();
    const animation = target.animate(
      [
        { translate: `${x}px ${y}px`, opacity: old ? 1 : 0 },
        { translate: '0px 0px', opacity: 1 }
      ],
      { duration: 240, easing: 'cubic-bezier(.22, 1, .36, 1)' }
    );
    running.set(target, animation);
    animation.onfinish = () => running.delete(target);
  }
}
