import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, TextInput, Share } from 'react-native';
import { NetworkGame } from './network';
import type { User } from './types';
import { LocalText as Text, useLanguage, textFor } from './language';
import { s, colors } from './styles';
type Friend = { id: string; name: string; status: 'pending' | 'accepted'; incoming: boolean };
export function FriendsPanel({ client, user }: { client: NetworkGame | null; user: User | null }) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const { language } = useLanguage();
  const owner = useRef(user?.id);
  owner.current = user?.id;
  async function run(action?: string, target?: string) {
    if (!client || !user || busy) return;
    const id = user.id;
    setBusy(true);
    try {
      if (action) await client.request('friends', { action, code: target });
      const data = await client.request('friends');
      if (!mounted.current || owner.current !== id) return;
      setFriends(data.friends);
      setNotice(data.friends.length ? '' : 'Пока нет друзей. Отправьте первую заявку.');
      if (action === 'request') setCode('');
    } catch (error) {
      if (mounted.current && owner.current === id)
        setNotice(error instanceof Error ? error.message : 'Ошибка сервера');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    setFriends([]);
    setNotice('');
    run();
    return () => {
      mounted.current = false;
    };
  }, [user?.id, client]);
  const button = (title: string, action: () => void) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={action}
      style={[s.button, s.smallButton, busy && s.disabled]}
    >
      <Text style={s.buttonText}>{title}</Text>
    </Pressable>
  );
  if (!user) return <Text style={s.muted}>Войдите в аккаунт, чтобы добавлять друзей.</Text>;
  return (
    <View style={{ gap: 16 }}>
      <Text style={s.muted}>Обменяйтесь кодами, чтобы играть вместе.</Text>
      <Text selectable translate={false} style={s.caption}>
        {user.id}
      </Text>
      {button('Поделиться моим кодом', () => {
        Share.share({ message: user.id }).catch(() => setNotice('Не удалось выполнить действие'));
      })}
      <TextInput
        value={code}
        onChangeText={setCode}
        maxLength={36}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={textFor('Код друга', language)}
        accessibilityLabel={textFor('Код друга', language)}
        placeholderTextColor={colors.muted}
        style={s.input}
      />
      {button('Добавить друга', () => run('request', code.trim().toLowerCase()))}
      {!!notice && (
        <Text accessibilityLiveRegion="polite" style={s.muted}>
          {notice}
        </Text>
      )}
      {friends.map((friend) => (
        <View key={friend.id} style={s.panel}>
          <Text translate={false} style={s.sectionTitle}>
            {friend.name}
          </Text>
          <Text style={s.caption}>
            {friend.status === 'accepted'
              ? 'В друзьях'
              : friend.incoming
                ? 'Входящая заявка'
                : 'Заявка отправлена'}
          </Text>
          {friend.status === 'pending' &&
            friend.incoming &&
            button('Принять', () => run('accept', friend.id))}
          {button(
            friend.status === 'accepted' ? 'Удалить' : friend.incoming ? 'Отклонить' : 'Отменить',
            () => run('remove', friend.id)
          )}
        </View>
      ))}
      {button('Обновить', () => run())}
    </View>
  );
}
