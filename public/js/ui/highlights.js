import { $ } from '../core/dom.js';
import { session } from '../core/session.js';
function cardSuitColor(suit) {
  return suit === 'H' || suit === 'D' ? 'red' : 'black';
}

function localCanDefend(attack, defend, trumpSuit) {
  if (!attack || !defend) return false;
  if (defend.joker) {
    if (attack.joker) return false;
    const attackRed = cardSuitColor(attack.suit) === 'red';
    return defend.color === 'red' ? attackRed : !attackRed;
  }
  if (attack.joker || !trumpSuit) return false;
  if (attack.suit === defend.suit) {
    const ranks = {
      2: 2,
      3: 3,
      4: 4,
      5: 5,
      6: 6,
      7: 7,
      8: 8,
      9: 9,
      10: 10,
      J: 11,
      Q: 12,
      K: 13,
      A: 14
    };
    return (ranks[defend.val] || 0) > (ranks[attack.val] || 0);
  }
  return defend.suit === trumpSuit && attack.suit !== trumpSuit;
}

function prepareCardFilterOverlays() {
  const hand = $('hand');
  if (!hand) return;
  const cardImages = [...hand.querySelectorAll('img.card')];
  cardImages.forEach((img) => {
    if (img.parentElement?.classList.contains('durak-card-filter')) return;
    const wrap = document.createElement('span');
    wrap.className = 'durak-card-filter';
    // Перекрытие карт (отрицательный margin-left) считается для самой
    // картинки, но раз она теперь вложена в обёртку — именно обёртка
    // занимает место в ряду #hand. Margin нужно перенести на неё,
    // иначе он ничего не "сжимает" и веер карт вылезает за экран.
    if (img.style.marginLeft) {
      wrap.style.marginLeft = img.style.marginLeft;
      img.style.marginLeft = '0';
    }
    // То же самое с z-index: он был нужен картинке, чтобы более поздние
    // карты в веере перекрывали более ранние. Но если оставить z-index
    // на самой картинке, она (начиная с 4-й карты, z-index > 3) рисуется
    // ПОВЕРХ собственной серо/зелёной заливки "можно/нельзя ходить" —
    // заливку становится не видно. Переносим z-index на обёртку, а с
    // картинки снимаем — тогда заливка (она рисуется поверх картинки
    // внутри той же обёртки) всегда видна, а нужный порядок наложения
    // карт друг на друга сохраняется на уровне обёрток.
    if (img.style.zIndex) {
      wrap.style.zIndex = img.style.zIndex;
      img.style.zIndex = '';
    }
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);
  });
}

function syncCardFilterOverlay(img, mode) {
  const wrap = img?.parentElement?.classList?.contains('durak-card-filter')
    ? img.parentElement
    : null;
  if (!wrap) return;
  wrap.classList.remove('can', 'cant');
  if (mode === 'can') wrap.classList.add('can');
  if (mode === 'cant') wrap.classList.add('cant');
}

function highlightPlayableCards(state) {
  const hand = $('hand');
  if (!hand) return;
  prepareCardFilterOverlays();
  const cards = [...hand.querySelectorAll('img.card')];
  cards.forEach((img) => {
    img.classList.remove('durak-card-can', 'durak-card-cant');
    syncCardFilterOverlay(img, null);
  });

  const myIndex = Number(state?.myIndex);
  const myCards = Array.isArray(state?.myHand) ? state.myHand : [];
  if (state?.status !== 'playing' || !Number.isInteger(myIndex) || !state.turn) return;

  const isDefender = myIndex === Number(state.defenderIndex ?? -1);
  const isAttacker = myIndex !== Number(state.defenderIndex ?? -1); // In podkidnoy, all non-defenders can attack

  let isMyTurn = false;
  let canPlay = () => false;

  if (state.turn === 'attacker' && isAttacker) {
    isMyTurn = true;
    const tableValues = Array.isArray(state.table)
      ? [
          ...new Set(
            state.table.flatMap((pair) => [pair.attack?.val, pair.defend?.val].filter(Boolean))
          )
        ]
      : [];
    const limit = Number(state.attackLimit ?? 6);
    const tableLength = Array.isArray(state.table) ? state.table.length : 0;
    // Джокером ходить (атаковать/подкидывать) нельзя — только защищаться им.
    // На первой атаке (пустой стол) разрешены любые обычные карты ТОЛЬКО главному атакующему.
    // Если есть незащищенные карты, можно подкидывать карты тех же рангов (все атакующие).
    // Если все защищены, можно подкидывать карты тех же рангов (обычные правила подкидного).
    canPlay = (card) => {
      if (card.joker) return false;
      if (tableLength >= limit) return false;
      if (tableLength === 0) {
        // Only main attacker can start
        return myIndex === Number(state.attackerIndex ?? -1);
      }
      return tableLength < limit && tableValues.includes(card.val);
    };
  } else if (isDefender) {
    // Defender can defend anytime there are undefended cards
    const openPair = Array.isArray(state.table) ? state.table.find((pair) => !pair.defend) : null;
    if (openPair) {
      isMyTurn = true;
      canPlay = (card) => localCanDefend(openPair.attack, card, state.trumpCard?.suit);
    }
  }

  if (!isMyTurn) return;

  // На пустом столе (первая атака в раунде, включая джокер-режим) ничего
  // не подсвечиваем — карты остаются обычными/белыми, без заливки:
  // выбор карты здесь ограничен только запретом на джокер, а не рангом.
  const tableIsEmpty =
    state.turn === 'attacker' && Array.isArray(state.table) && state.table.length === 0;
  if (tableIsEmpty) return;

  myCards.forEach((card, index) => {
    const img = cards.find((image) => image.dataset.code === card.code);
    if (!img) return;
    const playable = session.transferMode
      ? state.transferCardIndexes?.includes(index)
      : canPlay(card);
    img.classList.add(playable ? 'durak-card-can' : 'durak-card-cant');
    syncCardFilterOverlay(img, playable ? 'can' : 'cant');
  });
}

export { highlightPlayableCards };
