function getUserId(storage = localStorage, cryptoProvider = crypto) {
  let id = storage.getItem('durak_user_id');
  if (!id) {
    const bytes = cryptoProvider.getRandomValues(new Uint8Array(16));
    id = 'user_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    storage.setItem('durak_user_id', id);
  }
  return id;
}

let account = null;
function setAccount(user) {
  account = user;
}
function getName() {
  return account?.name || localStorage.getItem('durak_name')?.trim() || 'Игрок';
}
export { getUserId, getName, setAccount };
