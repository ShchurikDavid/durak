const SKINS = {
  'bicycle-classic': {
    label: 'Classic Clean',
    sub: 'Прежняя колода',
    dir: '/cards/bicycle-classic/',
    back: 'backs/red.png',
    preview: 'QH.png'
  },
  'rider-red': {
    label: 'Bicycle Rider Red',
    sub: 'Классика, красная рубашка',
    dir: '/cards/rider-red/',
    back: 'backs/main.png',
    preview: 'QH.png'
  },
  'rider-blue': {
    label: 'Bicycle Rider Blue',
    sub: 'Классика, синяя рубашка',
    dir: '/cards/rider-blue/',
    back: 'backs/main.png',
    preview: 'QH.png'
  }
};
const DEFAULT_SKIN = 'bicycle-classic';
let skin = localStorage.getItem('durak_skin');
if (!SKINS[skin]) skin = DEFAULT_SKIN;
const CARD_ASSET_BASE = '/cards/bicycle-classic/';
function skinDir() {
  return SKINS[skin].dir;
}
/*
  Сервер присылает «десятку» как 0S / 0H / 0D / 0C (формат Deck of Cards API),
  а файлы картинок лежат как 10S.png. Раньше клиент просил 0S.png — файла
  нет, поэтому вместо карты была сломанная картинка. Здесь код нормализуется,
  плюс добавлен запасной вариант .svg (там десятка названа как 0S.svg).
*/
function pngName(code) {
  const key = String(code || '').toUpperCase();
  return /^0[SHDC]$/.test(key) ? '10' + key[1] : key;
}
function svgName(code) {
  const key = String(code || '').toUpperCase();
  return /^10[SHDC]$/.test(key) ? '0' + key[2] : key;
}
function cardUrl(code) {
  return `${skinDir()}${pngName(code)}.png`;
}
function cardBack() {
  return `${skinDir()}${SKINS[skin].back}`;
}
function makeCardImg(code, alt, cls) {
  const img = document.createElement('img');
  img.className = cls || 'card';
  img.dataset.code = code;
  img.alt = alt || String(code || '');
  img.draggable = false;
  img.loading = 'eager';
  img.dataset.step = '0';
  img.addEventListener('error', () => {
    const step = img.dataset.step;
    if (step === '0') {
      img.dataset.step = '1';
      img.src = `${CARD_ASSET_BASE}${pngName(code)}.png`;
    } else if (step === '1') {
      img.dataset.step = '2';
      img.src = `${CARD_ASSET_BASE}${svgName(code)}.svg`;
    } else if (step === '2') {
      img.dataset.step = '3';
      img.src = cardBack();
    }
  });
  img.src = cardUrl(code);
  return img;
}
export function selectSkin(id) {
  if (!Object.hasOwn(SKINS, id)) return false;
  skin = id;
  localStorage.setItem('durak_skin', id);
  return true;
}
export { SKINS, skin, cardBack, makeCardImg };
