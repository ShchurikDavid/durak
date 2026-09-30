export const $ = (id) => document.getElementById(id);
export function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => (el.style.display = 'none'), 2600);
}
