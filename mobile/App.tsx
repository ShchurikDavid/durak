import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  Linking,
  AppState,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  Switch,
  TextInput,
  View,
  Keyboard,
  KeyboardAvoidingView
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLocalGame } from './local-game';
import { tapHaptic } from './haptics';
import {
  matchRecord,
  readHistory,
  addMatch,
  historySummary,
  resultLabels
} from '../src/game/match-history';
import { DEFAULT_SERVER, NetworkGame } from './network';
import { secureSessionStore } from './session-store';
import { BluetoothGame, type Device } from './bluetooth';
import { BluetoothIcon } from './BluetoothIcon';
import { animateLayout, MotionProvider, ReducedMotion, WelcomeMotion } from './motion';
import type { Card, GameState, Options, Room, Session, User } from './types';
import { s, colors } from './styles';
import { backs, faces, skins, skinNames, type Skin } from './cards';
import { orderedHand } from '../public/js/hand-order';
import { FriendsPanel } from './FriendsPanel';
import {
  LanguageProvider,
  LanguagePicker,
  useLanguage,
  textFor,
  LocalText as Text
} from './language';
import { handLayout } from './hand-layout';
import { tableLayout } from './table-layout';
import { configureAudio, defaultAudio, playSound, stopAudio, type AudioSettings } from './audio';
const SkinContext = createContext<Skin>('bicycle-classic');
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const suits: Record<string, string> = { S: '♠\uFE0E', H: '♥\uFE0E', D: '♦\uFE0E', C: '♣\uFE0E' };
const suitNames: Record<string, string> = { S: 'Пики', H: 'Червы', D: 'Бубны', C: 'Трефы' };
const defaults: Options = { mode: '36', maxPlayers: 2, gameType: 'throwIn' };
function GameBrand() {
  return (
    <Text accessibilityLabel="Дурак" style={s.brand}>
      ДУРАК <Text style={s.brandSuit}>♠</Text>
    </Text>
  );
}
const PATREON_URL = 'https://www.patreon.com/cw/Durakcardsgame';
function PatreonButton({ label = false }: { label?: boolean }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Поддержать игру на Patreon"
      onPress={() =>
        Linking.openURL(PATREON_URL).catch(() =>
          Alert.alert('Patreon', 'Не удалось открыть ссылку. Проверьте подключение к интернету.')
        )
      }
      style={({ pressed }) => [label ? s.networkTile : s.patreonButton, pressed && s.pressed]}
    >
      <Image
        source={require('./assets/patreon-logo.png')}
        style={{ width: 24, height: 24 }}
        resizeMode="contain"
      />
      {label && <Text style={[s.sectionTitle, { flex: 1 }]}>Поддержать игру · Patreon</Text>}
    </Pressable>
  );
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось выполнить действие';

function Button({
  title,
  onPress,
  secondary,
  disabled,
  small,
  compact,
  stretch
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  small?: boolean;
  compact?: boolean;
  stretch?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondaryButton,
        small && s.smallButton,
        compact && s.compactButton,
        stretch && s.actionButton,
        disabled && s.disabled,
        pressed && s.pressed
      ]}
    >
      <Text
        numberOfLines={stretch ? 1 : undefined}
        adjustsFontSizeToFit={stretch}
        minimumFontScale={0.75}
        style={[s.buttonText, compact && s.compactButtonText, secondary && s.secondaryButtonText]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChangeText,
  password,
  email,
  placeholder,
  compact = false
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  password?: boolean;
  email?: boolean;
  placeholder?: string;
  compact?: boolean;
}) {
  const { language } = useLanguage();
  const [visible, setVisible] = useState(false);
  return (
    <View style={[s.field, compact && { gap: 3 }]}>
      <Text style={s.label}>{label}</Text>
      <View style={s.inputRow}>
        <TextInput
          accessibilityLabel={textFor(label, language)}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ? textFor(placeholder, language) : undefined}
          placeholderTextColor={colors.muted}
          secureTextEntry={password && !visible}
          maxLength={password ? 128 : email ? 254 : 20}
          autoCapitalize={email || password ? 'none' : 'sentences'}
          autoCorrect={!email && !password}
          keyboardType={email ? 'email-address' : 'default'}
          style={[s.input, compact && { minHeight: 40, paddingVertical: 7 }]}
        />
        {password && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Скрыть пароль' : 'Показать пароль'}
            onPress={() => setVisible(!visible)}
            style={s.reveal}
          >
            <View style={s.eye}>
              <View style={s.eyePupil} />
              {visible && <View style={s.eyeSlash} />}
            </View>
          </Pressable>
        )}
      </View>
    </View>
  );
}
function CardFace({
  card,
  small,
  active,
  disabled,
  onPress,
  size
}: {
  card: Card;
  size?: number;
  small?: boolean;
  active?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const skin = useContext(SkinContext);
  const reducedMotion = useContext(ReducedMotion);
  const lift = useRef(new Animated.Value(0)).current;
  const visibility = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(lift, {
        toValue: active ? -Math.min(5, ((size || 96) / 96) * 5) : 0,
        duration: reducedMotion ? 0 : 180,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      }),
      Animated.timing(visibility, {
        toValue: onPress && disabled ? 0.78 : 1,
        duration: reducedMotion ? 0 : 200,
        useNativeDriver: true
      })
    ]);
    animation.start();
    return () => animation.stop();
  }, [active, disabled, !!onPress, size, reducedMotion, lift, visibility]);
  const artwork = faces[skin][card.code] || faces['bicycle-classic'][card.code];
  const red = card.suit === 'H' || card.suit === 'D' || card.code === 'JOKER_RED';
  const suit = suits[card.suit] || '✦';
  const value = card.val === 'JOKER' ? 'JK' : card.val;
  return (
    <AnimatedPressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${value} ${suit}${active ? ', можно сыграть' : ''}`}
      disabled={!onPress || disabled}
      onPress={onPress}
      style={[
        s.card,
        small && s.cardSmall,
        size ? { width: size, height: size * 1.44 } : undefined,
        active && s.cardActive,
        onPress && disabled && s.cardDim,
        { opacity: visibility, transform: [{ translateY: lift }] }
      ]}
    >
      {artwork ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 2,
            right: 2,
            top: 2,
            bottom: 2,
            backgroundColor: '#F6EFDF',
            borderRadius: 7,
            overflow: 'hidden'
          }}
        >
          <Image source={artwork} style={{ width: '100%', height: '100%' }} resizeMode="stretch" />
        </View>
      ) : (
        <>
          <Text style={[s.cardRank, small && s.cardRankSmall, red && s.red]}>{value}</Text>
          <Text style={[s.cardSuit, small && s.cardSuitSmall, red && s.red]}>{suit}</Text>
          <Text style={[s.cardCorner, red && s.red]}>{suit}</Text>
        </>
      )}
    </AnimatedPressable>
  );
}

function Volume({
  title,
  value,
  onChange
}: {
  title: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{title}</Text>
      <View style={s.rowBetween}>
        <Button
          secondary
          small
          title="−"
          onPress={() => onChange(Math.max(0, value - 5))}
          disabled={value === 0}
        />
        <Text accessibilityLiveRegion="polite" style={s.sectionTitle}>
          {value}%
        </Text>
        <Button
          secondary
          small
          title="+"
          onPress={() => onChange(Math.min(100, value + 5))}
          disabled={value === 100}
        />
      </View>
    </View>
  );
}
function DurakApp() {
  const reducedMotion = useContext(ReducedMotion);
  const motionSignature = useRef('');
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const { language } = useLanguage();
  const localizedAlert: typeof Alert.alert = (title, description, buttons, options) =>
    Alert.alert(
      textFor(title || '', language),
      description ? textFor(description, language) : description,
      buttons?.map((button) => ({
        ...button,
        text: button.text ? textFor(button.text, language) : button.text
      })),
      options
    );
  const [sortOrder, setSortOrder] = useState('suit');
  useEffect(() => {
    AsyncStorage.getItem('durak.native.sort')
      .then((v) => {
        if (['suit', 'rank', 'deal'].includes(v || '')) setSortOrder(v!);
      })
      .catch(() => {});
  }, []);
  const [ready, setReady] = useState(false);
  const welcomePending = useRef(false);
  const [name, setName] = useState('Игрок');
  const [draftName, setDraftName] = useState('Игрок');
  const address = DEFAULT_SERVER;
  const [haptics, setHaptics] = useState(true);
  const [audio, setAudio] = useState<AudioSettings>(defaultAudio);
  const [skin, setSkin] = useState<Skin>('bicycle-classic');
  const [handWidth, setHandWidth] = useState(300);
  const [bodySize, setBodySize] = useState({ width: 360, height: 600 });
  const [boardSize, setBoardSize] = useState({ width: 300, height: 180 });
  const [tab, setTabState] = useState<'home' | 'rooms' | 'profile'>('home');
  function setTab(value: typeof tab) {
    animateLayout(reducedMotion);
    setTabState(value);
  }
  const [game, setGame] = useState<GameState | null>(null);
  const [resultClosed, setResultClosed] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [connected, setConnected] = useState(false);
  const [connectionIssue, setConnectionIssue] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [history, setHistory] = useState<ReturnType<typeof matchRecord>[]>([]);
  const [historyMessage, setHistoryMessage] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyWork = useRef(Promise.resolve());
  const accountId = useRef<string | null>(null);
  const [notice, setNotice] = useState('');
  const [options, setOptions] = useState<Options>(defaults);
  const [dialog, setDialog] = useState<
    | null
    | 'welcome'
    | 'local'
    | 'network'
    | 'rules'
    | 'account'
    | 'friends'
    | 'settings'
    | 'bluetooth'
    | 'bluetooth-host'
  >(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [phonesOnly, setPhonesOnly] = useState(true);
  const [btStatus, setBtStatus] = useState(
    'Один игрок создаёт стол, остальные находят его телефон рядом. Интернет не нужен.'
  );
  const bluetooth = useRef<BluetoothGame | null>(null);
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [register, setRegister] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const accountPage = dialog === 'welcome' || dialog === 'account';
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  useEffect(() => {
    setConfirmPassword('');
  }, [register, dialog]);
  const [busy, setBusy] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(Date.now());
  const session = useRef<Session | null>(null);
  const network = useRef<NetworkGame | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  function syncHistory(record: ReturnType<typeof matchRecord> = null) {
    const owner = accountId.current;
    const client = network.current;
    if (!owner || !client) return;
    historyWork.current = historyWork.current
      .catch(() => {})
      .then(async () => {
        const key = `durak.native.pendingMatches.${owner}`;
        let queue = readHistory(await AsyncStorage.getItem(key));
        queue = addMatch(queue, record);
        await AsyncStorage.setItem(key, JSON.stringify(queue));
        try {
          for (const entry of [...queue]) {
            if (accountId.current !== owner) return;
            await client.request('history', { userId: owner, record: entry });
            queue = queue.filter((item) => item.id !== entry.id);
            await AsyncStorage.setItem(key, JSON.stringify(queue));
          }
          const data = await client.request('history');
          if (accountId.current === owner) {
            setHistory(readHistory(JSON.stringify(data.history)));
            setHistoryMessage('');
          }
        } catch {
          if (accountId.current === owner)
            setHistoryMessage(
              'Нет связи. История загрузится при подключении; новые результаты ждут отправки.'
            );
        }
      })
      .catch(() => setHistoryMessage('Не удалось сохранить результат на телефоне.'));
  }
  useEffect(() => {
    if (user && (connected || tab === 'profile' || tab === 'home')) syncHistory();
  }, [user?.id, connected, tab]);
  useEffect(() => {
    if (user && game && (game.local || game.bluetooth)) {
      const record = matchRecord(game);
      if (record) syncHistory(record);
    }
  }, [game]);

  function notify(text: string) {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 7000);
  }
  async function save(key: string, value: string) {
    try {
      await AsyncStorage.setItem(`durak.native.${key}`, value);
    } catch {
      notify('Не удалось сохранить настройки на телефоне');
    }
  }
  useEffect(() => {
    AsyncStorage.multiGet([
      'durak.native.name',
      'durak.native.haptics',
      'durak.native.audio',
      'durak.native.skin',
      'durak.native.welcome.v1'
    ])
      .then((entries) => {
        if (!alive.current) return;
        const data = Object.fromEntries(entries);
        if (data['durak.native.welcome.v1'] !== 'done') {
          welcomePending.current = true;
          setDialog('welcome');
        }
        const stored = data['durak.native.name'] || 'Игрок';
        setName(stored);
        setDraftName(stored);
        setHaptics(data['durak.native.haptics'] !== 'off');
        const savedSkin = data['durak.native.skin'];
        if (skins.includes(savedSkin as Skin)) setSkin(savedSkin as Skin);
        try {
          const saved = JSON.parse(data['durak.native.audio'] || '{}');
          setAudio({
            music: typeof saved.music === 'boolean' ? saved.music : true,
            sounds: typeof saved.sounds === 'boolean' ? saved.sounds : true,
            musicVolume: Number.isFinite(saved.musicVolume)
              ? Math.max(0, Math.min(100, saved.musicVolume))
              : 3,
            soundVolume: Number.isFinite(saved.soundVolume)
              ? Math.max(0, Math.min(100, saved.soundVolume))
              : 100
          });
        } catch {
          setAudio(defaultAudio);
        }
      })
      .catch(() => {
        welcomePending.current = true;
        setDialog('welcome');
        notify('Настройки недоступны; можно продолжить как гость');
      })
      .finally(() => setReady(true));
    return () => {
      alive.current = false;
      stopAudio();
      session.current?.dispose();
      network.current?.dispose();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!game) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [!!game]);
  useEffect(() => {
    const event = BackHandler.addEventListener('hardwareBackPress', () => {
      if (dialog) {
        closeDialog();
        return true;
      }
      if (game) {
        leave();
        return true;
      }
      if (tab !== 'home') {
        setTab('home');
        return true;
      }
      return false;
    });
    return () => event.remove();
  }, [dialog, game, tab, busy]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (ready) configureAudio(audio);
  }, [ready, audio]);
  function changeAudio(patch: Partial<AudioSettings>) {
    const value = { ...audio, ...patch };
    setAudio(value);
    configureAudio(value);
    save('audio', JSON.stringify(value));
    if (patch.sounds === true || patch.soundVolume !== undefined) playSound('click');
  }
  function receive(state: GameState) {
    const signature = JSON.stringify([
      state.status,
      state.myHand.map((card) => card.code),
      state.table.map((pair) => [pair.attack.code, pair.defend?.code])
    ]);
    if (motionSignature.current !== signature) animateLayout(reducedMotionRef.current);
    motionSignature.current = signature;
    playSound(state.lastAction);
    if (state.status !== 'finished') setResultClosed(false);
    setGame(state);
    setPending(false);
    setTransfer(false);
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
  }
  function finishWelcome() {
    welcomePending.current = false;
    save('welcome.v1', 'done');
    setDialog((current) => (current === 'welcome' ? null : current));
  }
  function closeDialog() {
    if (busy) return;
    if (dialog === 'welcome') {
      finishWelcome();
      return;
    }
    if (dialog === 'account') {
      setPassword('');
      if (welcomePending.current) {
        setDialog('welcome');
        return;
      }
    }
    if (dialog === 'bluetooth' && !game) {
      bluetooth.current?.dispose();
      bluetooth.current = null;
    }
    setDialog(null);
  }
  async function startBluetooth(host: boolean) {
    setBusy(true);
    bluetooth.current?.dispose();
    session.current?.dispose();
    setDevices([]);
    try {
      const client = new BluetoothGame(name, {
        state: (state) => {
          receive(state);
          setDialog((current) =>
            current === 'bluetooth' || current === 'bluetooth-host' ? null : current
          );
        },
        device: (device) =>
          setDevices((current) => [...current.filter((item) => item.id !== device.id), device]),
        status: setBtStatus,
        closed: (text) => {
          setGame(null);
          setPending(false);
          setDialog('bluetooth');
          setBtStatus(text);
          notify(text);
        }
      });
      bluetooth.current = client;
      session.current = client;
      if (host) await client.host(options);
      else await client.scan();
    } catch (error) {
      bluetooth.current?.dispose();
      setBtStatus(message(error));
      notify(message(error));
    } finally {
      setBusy(false);
    }
  }
  function startLocal() {
    session.current?.dispose();
    session.current = createLocalGame({ ...options, name, onState: receive });
    setDialog(null);
  }
  useEffect(() => {
    if (ready && !game && !network.current) connect();
  }, [ready, tab, !!game, dialog]);
  function connect() {
    if (network.current) return;
    setConnected(false);
    setRooms([]);
    setUser(null);
    setConnectionIssue('');
    const client = new NetworkGame(
      DEFAULT_SERVER,
      name,
      {
        state: receive,
        rooms: setRooms,
        connection: (value) => {
          setConnected(value);
          if (value) setConnectionIssue('');
        },
        connectionIssue: setConnectionIssue,
        profile: (account, nickname) => {
          if (accountId.current !== (account?.id || null)) {
            setHistory([]);
            setHistoryMessage('');
          }
          accountId.current = account?.id || null;
          setUser(account);
          if (account) finishWelcome();
          if (nickname) {
            setName(nickname);
            setDraftName(nickname);
          }
        },
        error: (text) => {
          setPending(false);
          notify(text);
        },
        closed: () => {
          setGame(null);
          setPending(false);
        }
      },
      5000,
      secureSessionStore
    );
    network.current = client;
    client.start();
  }
  function send(event: string, payload?: unknown) {
    if (pending || (!game?.local && !game?.bluetooth && !connected)) return;
    setPending(true);
    pendingTimer.current = setTimeout(() => {
      setPending(false);
      if (!game?.local) notify('Ответ задерживается. Проверьте соединение.');
    }, 5000);
    if (game?.local || game?.bluetooth) session.current?.send(event, payload);
    else network.current?.send(event, payload);
    if (haptics) tapHaptic();
  }
  function leave() {
    if (
      game &&
      !['waiting', 'finished'].includes(game.status) &&
      !game.players.find((player) => player.isMe)?.surrendered
    ) {
      notify('Сначала нажмите «Сдаться», затем можно выйти.');
      return;
    }
    localizedAlert(
      'Выйти из партии?',
      game?.local
        ? user
          ? 'После выхода результат будет доступен в статистике аккаунта при подключении к серверу.'
          : 'Войдите в аккаунт перед следующей игрой, чтобы сохранять статистику.'
        : 'Выход закроет комнату для остальных игроков.',
      [
        { text: 'Остаться', style: 'cancel' },
        {
          text: 'Выйти',
          style: 'destructive',
          onPress: () => {
            if (game?.local || game?.bluetooth) {
              session.current?.dispose();
              session.current = null;
            } else network.current?.send('leaveRoom');
            setGame(null);
            setPending(false);
            setTransfer(false);
            setTab(game?.local || game?.bluetooth ? 'home' : 'rooms');
          }
        }
      ]
    );
  }
  async function rename() {
    const value = draftName.trim();
    if (!value || value.length > 20 || /[\x00-\x1f\x7f]/.test(value)) {
      notify('Ник должен содержать от 1 до 20 символов');
      return;
    }
    setBusy(true);
    try {
      if (game?.local || game?.bluetooth) session.current?.rename?.(value);
      else if (connected) await network.current?.rename(value);
      setName(value);
      await save('name', value);
      notify('Ник сохранён');
    } catch (error) {
      notify(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function account() {
    if (register && password !== confirmPassword) {
      notify('Пароли не совпадают');
      return;
    }
    if (!network.current || !connected) {
      notify('Нет связи с сервером. Подождите подключения или продолжите без аккаунта.');
      return;
    }
    setBusy(true);
    try {
      await network.current.account(register ? 'register' : 'login', {
        email: email.trim(),
        password,
        name
      });
      setPassword('');
      finishWelcome();
      setDialog(null);
      notify(register ? 'Аккаунт создан' : 'Вы вошли в аккаунт');
    } catch (error) {
      notify(message(error));
    } finally {
      setBusy(false);
    }
  }
  const canAct = !!game && !pending && (game.local || game.bluetooth || connected);
  const resultVisible = game?.status === 'finished' && !resultClosed;
  const canLeave =
    !game ||
    ['waiting', 'finished'].includes(game.status) ||
    !!game.players.find((player) => player.isMe)?.surrendered;
  const surrendered = game?.players.find((player) => player.isMe)?.surrendered;
  const lost = game?.loserIndex === game?.myIndex;
  const resultTitle = surrendered
    ? 'Вы сдались'
    : game?.loserIndex == null
      ? 'Ничья'
      : lost
        ? 'Поражение'
        : 'Победа!';
  const resultEmoji = surrendered ? '🏳️' : game?.loserIndex == null ? '🤝' : lost ? '💀' : '🏆';
  const deadline = game?.timeout.active ? game.timeout.deadline : game?.turnDeadline;
  const seconds = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

  const landscape = bodySize.width > bodySize.height;
  const handBudget = landscape
    ? Math.max(48, bodySize.height - 48)
    : Math.max(48, Math.min(176, bodySize.height * 0.26));
  const sortedHand: { card: Card; index: number }[] = orderedHand(
    game?.myHand || [],
    sortOrder,
    game?.trumpCard?.suit
  );
  const layout = handLayout(game?.myHand.length || 0, handWidth, handBudget);
  const board = tableLayout(game?.table.length || 0, boardSize.width, boardSize.height);
  function renderHistory() {
    return (
      <View style={s.panel}>
        <Text style={s.sectionTitle}>Статистика матчей</Text>
        {!user ? (
          <>
            <Text style={s.muted}>Войдите в аккаунт, чтобы смотреть статистику матчей.</Text>
            <Button
              title="ВОЙДИТЕ"
              onPress={() => {
                setHistoryOpen(false);
                connect();
                setRegister(false);
                setDialog('account');
              }}
            />
          </>
        ) : (
          <>
            <Text style={s.muted}>{historySummary(history)}</Text>
            <Text style={s.caption}>Последние 500 матчей аккаунта, включая игры с ботами.</Text>
            {!!historyMessage && <Text style={s.muted}>{historyMessage}</Text>}
            {!history.length && !historyMessage && (
              <Text style={s.muted}>Здесь появятся результаты новых матчей.</Text>
            )}
            {history.map(
              (entry) =>
                entry && (
                  <View
                    key={entry.id}
                    style={[
                      s.panel,
                      entry.result === 'win'
                        ? s.historyWin
                        : entry.result === 'loss'
                          ? s.historyLoss
                          : s.historyDraw
                    ]}
                  >
                    <Text
                      style={[
                        s.sectionTitle,
                        {
                          color:
                            entry.result === 'win'
                              ? '#9AE6B4'
                              : entry.result === 'loss'
                                ? '#FFAAAA'
                                : colors.cream
                        }
                      ]}
                    >
                      {resultLabels[entry.result as keyof typeof resultLabels]}
                      {entry.surrendered ? ' · Вы сдались' : ''}
                    </Text>
                    <Text style={s.caption}>
                      {new Date(entry.date).toLocaleString('ru-RU')} · {entry.mode}
                    </Text>
                    <Text style={s.muted}>Соперники: {entry.opponents}</Text>
                    <Text style={s.caption}>{entry.rules}</Text>
                  </View>
                )
            )}
          </>
        )}
      </View>
    );
  }

  return (
    <SkinContext.Provider value={skin}>
      <SafeAreaView style={s.root} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar barStyle="light-content" />
        {!ready ? (
          <View style={s.center}>
            <Text style={s.heroTitle}>Дурак</Text>
            <Text style={s.muted}>Раскладываем карты…</Text>
          </View>
        ) : game ? (
          <>
            <View style={s.gameHeader}>
              {canLeave && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Выйти из комнаты"
                  onPress={leave}
                  style={s.iconButton}
                >
                  <Text style={s.navIcon}>‹</Text>
                </Pressable>
              )}
              <View style={s.flex}>
                <Text style={s.eyebrow}>
                  {game.bluetooth
                    ? 'ИГРА ПО BLUETOOTH'
                    : game.local
                      ? 'ИГРА БЕЗ ИНТЕРНЕТА'
                      : `${game.roomName || 'КОМНАТА'} · ${game.roomCode}`}
                </Text>
                <Text style={s.sectionTitle}>{game.gameTypeLabel}</Text>
              </View>
              <Text style={s.roundBadge}>Раунд {game.roundNumber}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Настройки"
                onPress={() => setDialog('settings')}
                style={s.iconButton}
              >
                <Text style={s.navIcon}>⚙</Text>
              </Pressable>
            </View>
            {!game.local && !game.bluetooth && !connected && (
              <Text style={s.warning}>Связь потеряна. Переподключаемся…</Text>
            )}
            <View
              style={[s.gameBody, landscape && { flexDirection: 'row' }]}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                setBodySize({ width, height });
              }}
            >
              <View style={s.playArea}>
                <View style={s.players}>
                  {game.players
                    .filter((p) => !p.isMe)
                    .map((p) => (
                      <View
                        key={p.index}
                        style={[
                          s.player,
                          {
                            flexDirection: 'row',
                            maxWidth: game.players.length === 2 ? 190 : undefined
                          },
                          p.isDefender && s.playerDefender
                        ]}
                      >
                        <View style={[s.avatar, { width: 28, height: 28 }]}>
                          <Text style={s.avatarText}>{p.name.slice(0, 1).toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={s.playerName}>
                            {p.name}
                          </Text>
                          <Text numberOfLines={1} style={[s.caption, { fontSize: 10 }]}>
                            {!p.connected
                              ? 'Нет связи'
                              : p.surrendered
                                ? 'Наблюдает'
                                : p.cardCount + ' карт' + (p.isDefender ? ' · защита' : '')}
                          </Text>
                        </View>
                      </View>
                    ))}
                </View>
                <View style={s.table}>
                  <View style={s.tableTop}>
                    <Text style={s.tableLabel}>КОЛОДА · {game.deckCount}</Text>
                    <Text style={s.tableLabel}>ОТБОЙ · {game.discardCount}</Text>
                  </View>
                  <View style={s.trumpRow}>
                    <View
                      style={s.trumpBadge}
                      accessibilityLabel={
                        game.trumpCard
                          ? 'Козырь: ' + suitNames[game.trumpCard.suit]
                          : 'Козырь ещё не выбран'
                      }
                    >
                      <Text
                        style={[
                          s.trumpSymbol,
                          {
                            color:
                              game.trumpCard && ['H', 'D'].includes(game.trumpCard.suit)
                                ? '#A92732'
                                : '#12261A'
                          }
                        ]}
                      >
                        {game.trumpCard ? suits[game.trumpCard.suit] : '—'}
                      </Text>
                      <View>
                        <Text style={s.trumpLabel}>КОЗЫРЬ</Text>
                        <Text style={s.trumpName}>
                          {game.trumpCard ? suitNames[game.trumpCard.suit] : 'Ожидание'}
                        </Text>
                      </View>
                    </View>
                    <Text style={[s.caption, { fontSize: 10 }]}>{game.gameModeLabel}</Text>
                  </View>
                  <View
                    style={s.arena}
                    onLayout={(e) => {
                      const { width, height } = e.nativeEvent.layout;
                      setBoardSize({ width, height });
                    }}
                  >
                    {!game.table.length || game.status === 'finished' ? (
                      <View style={s.emptyTable}>
                        {boardSize.height > 70 && (
                          <Text style={[s.tableWatermark, { fontSize: 40 }]}>♠</Text>
                        )}
                        <Text
                          style={[s.muted, { fontSize: 12, textAlign: 'center' }]}
                          numberOfLines={Math.max(1, Math.floor(boardSize.height / 20))}
                        >
                          {game.status === 'waiting'
                            ? game.bluetooth
                              ? `${btStatus}\nЖдём остальных игроков. Раздача начнётся, когда все подключатся. Оставайтесь в приложении.`
                              : 'Ждём остальных игроков'
                            : game.status === 'finished'
                              ? game.resultText
                              : 'Карты на столе появятся здесь'}
                        </Text>
                      </View>
                    ) : (
                      game.table.map((pair, i) => (
                        <View
                          key={pair.attack.code + i}
                          style={{
                            position: 'absolute',
                            left:
                              (i % board.columns) * board.cellWidth +
                              (board.cellWidth - board.cardWidth * (pair.defend ? 1.3 : 1)) / 2,
                            top:
                              Math.floor(i / board.columns) * board.cellHeight +
                              (board.cellHeight - board.cardWidth * (pair.defend ? 1.7 : 1.44)) / 2,
                            width: board.cardWidth * 1.3,
                            height: board.cardWidth * 1.7
                          }}
                        >
                          <CardFace card={pair.attack} size={board.cardWidth} />
                          {pair.defend && (
                            <View
                              style={{
                                position: 'absolute',
                                left: board.cardWidth * 0.2,
                                top: board.cardWidth * 0.2,
                                transform: [{ rotate: '8deg' }]
                              }}
                            >
                              <CardFace card={pair.defend} size={board.cardWidth} />
                            </View>
                          )}
                        </View>
                      ))
                    )}
                  </View>
                  <View style={[s.tableBottom, { marginTop: 0 }]}>
                    <Text numberOfLines={2} style={[s.status, { fontSize: 12, lineHeight: 16 }]}>
                      {game.statusText.replace(/^[^А-Яа-яA-Za-z0-9]+/, '')}
                    </Text>
                    {seconds !== null && (
                      <Text style={[s.timer, seconds <= 5 && s.red]}>{seconds}с</Text>
                    )}
                  </View>
                </View>
              </View>
              <View style={[s.handArea, landscape && { width: '42%' }]}>
                <View style={s.handLabel}>
                  <Text style={[s.sectionTitle, { fontSize: 14 }]}>
                    Ваши карты · {game.myHand.length}
                  </Text>
                  <Text numberOfLines={1} style={[s.caption, { fontSize: 10 }]}>
                    {transfer ? 'Выберите карту' : game.role}
                  </Text>
                </View>
                <View
                  onLayout={(e) => setHandWidth(e.nativeEvent.layout.width)}
                  style={[s.hand, { gap: layout.rowGap }]}
                >
                  {layout.rows.map((row) => (
                    <View
                      key={row.start}
                      style={{ width: row.width, height: layout.cardHeight + layout.lift }}
                    >
                      {sortedHand
                        .slice(row.start, row.start + row.size)
                        .map(({ card, index: i }, offset) => {
                          const legal = (
                            transfer ? game.transferCardIndexes : game.playableCardIndexes || []
                          ).includes(i);
                          return (
                            <View
                              key={card.code}
                              style={{
                                position: 'absolute',
                                left: offset * row.step,
                                top: layout.lift,
                                zIndex: offset + 1
                              }}
                            >
                              <CardFace
                                card={card}
                                size={layout.cardWidth}
                                active={legal && !!canAct}
                                disabled={!canAct || !legal}
                                onPress={() => send(transfer ? 'transferCard' : 'playCard', i)}
                              />
                            </View>
                          );
                        })}
                    </View>
                  ))}
                  {!game.myHand.length && (
                    <Text style={[s.muted, { fontSize: 12 }]} numberOfLines={2}>
                      {game.status === 'waiting' ? 'Ожидаем раздачу' : 'Карт больше нет'}
                    </Text>
                  )}
                </View>
              </View>
            </View>
            <View style={s.actionBar}>
              {game.status === 'finished' ? (
                <Button
                  stretch
                  compact
                  title="Ещё партия"
                  small
                  onPress={() => send('restartGame')}
                  disabled={!canAct || !game.canRestart}
                />
              ) : game.status === 'waiting' ? (
                <Button
                  stretch
                  compact
                  title={
                    game.bluetooth ? 'Как подключиться' : 'Код: ' + game.roomCode + ' · Пригласить'
                  }
                  small
                  secondary
                  onPress={() =>
                    game.bluetooth
                      ? localizedAlert(
                          'Игра рядом',
                          'На другом телефоне откройте «По Bluetooth» → «Найти друга» и выберите телефон создателя. ' +
                            btStatus,
                          game.myIndex === 0
                            ? [
                                { text: 'Закрыть', style: 'cancel' },
                                {
                                  text: 'Продлить видимость',
                                  onPress: () =>
                                    bluetooth.current
                                      ?.advertise()
                                      .catch((error) => notify(message(error)))
                                }
                              ]
                            : [{ text: 'Понятно' }]
                        )
                      : Share.share({
                          message: 'Дурак: комната ' + game.roomCode + '. Сервер ' + address
                        }).catch(() => notify('Не удалось поделиться'))
                  }
                />
              ) : (
                <View style={s.actionRow}>
                  <Button
                    stretch
                    compact
                    small
                    title="Бито"
                    onPress={() => send('bito')}
                    disabled={!canAct || !game.canPass}
                  />
                  <Button
                    stretch
                    compact
                    small
                    secondary
                    title="Взять"
                    onPress={() => send('take')}
                    disabled={!canAct || !game.canTake}
                  />
                  {game.canTransfer && (
                    <Button
                      stretch
                      compact
                      small
                      secondary
                      title={transfer ? 'Отмена' : 'Перевести'}
                      onPress={() => setTransfer(!transfer)}
                      disabled={!canAct}
                    />
                  )}

                  <Button
                    stretch
                    compact
                    small
                    secondary
                    title={
                      game.timeout.active
                        ? 'Продолжить ' + game.timeout.votes + '/' + game.timeout.required
                        : `Тайм-аут ${game.timeout.votes}/${game.timeout.required}`
                    }
                    disabled={!canAct || !game.timeout.canVote || game.timeout.voted}
                    onPress={() => send(game.timeout.active ? 'voteResume' : 'voteTimeout')}
                  />
                  {game.canSurrender && (
                    <Button
                      stretch
                      compact
                      small
                      secondary
                      title="Сдаться"
                      onPress={() =>
                        localizedAlert('Сдаться?', 'Вы останетесь наблюдать за партией.', [
                          { text: 'Отмена' },
                          { text: 'Сдаться', onPress: () => send('surrender') }
                        ])
                      }
                    />
                  )}
                </View>
              )}
            </View>
          </>
        ) : (
          <>
            <View style={s.header}>
              <View style={[s.row, { flex: 1 }]}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 12,
                    backgroundColor: colors.accent,
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Text style={{ fontSize: 25, color: colors.bg }}>{'♠\uFE0E'}</Text>
                </View>
                <View style={{ flexShrink: 1 }}>
                  <Text style={[s.brand, { fontFamily: 'serif', letterSpacing: 0 }]}>ДУРАК</Text>
                  <Text style={s.caption}>Место для каждого</Text>
                </View>
              </View>
              <View style={s.row}>
                <PatreonButton />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Настройки"
                  onLongPress={() => setTab('profile')}
                  onPress={() => setDialog('settings')}
                  style={s.profileCircle}
                >
                  <Text style={s.avatarText}>⚙</Text>
                </Pressable>
              </View>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              style={s.flex}
              contentContainerStyle={s.page}
              keyboardShouldPersistTaps="handled"
            >
              {tab === 'home' && (
                <>
                  <View style={s.hero}>
                    <View style={s.pill}>
                      <View style={s.dot} />
                      <Text style={s.pillText}>ГОТОВА К ИГРЕ. ДАЖЕ ОФЛАЙН.</Text>
                    </View>
                    <Text style={s.heroTitle}>
                      Свой стол.{'\n'}
                      <Text
                        style={{ color: colors.accent, fontStyle: 'italic', fontWeight: '400' }}
                      >
                        Своя игра.
                      </Text>
                    </Text>
                    <Text style={s.heroDescription}>
                      Знакомые правила.{'\n'}Новый повод собраться.
                    </Text>
                    <View style={s.heroCards}>
                      <View style={s.heroCardLeft}>
                        <CardFace card={{ val: 'A', suit: 'H', code: 'AH' }} />
                      </View>
                      <View style={s.heroCardRight}>
                        <CardFace card={{ val: 'A', suit: 'S', code: 'AS' }} />
                      </View>
                    </View>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setDialog('local')}
                    style={({ pressed }) => [s.playTile, pressed && s.pressed]}
                  >
                    <View style={s.tileIcon}>
                      <Text style={s.tileSuit}>♣</Text>
                    </View>
                    <View style={s.flex}>
                      <Text style={s.playTitle}>Быстрая партия</Text>
                      <Text style={s.playDescription}>С ботами · без интернета</Text>
                    </View>
                    <Text style={s.playArrow}>↗</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setTab('rooms')}
                    style={({ pressed }) => [s.networkTile, pressed && s.pressed]}
                  >
                    <View style={s.flex}>
                      <Text style={s.sectionTitle}>За одним столом</Text>
                      <Text style={s.muted}>Комнаты с друзьями через интернет</Text>
                    </View>
                    <Text style={s.navIcon}>→</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setDialog('bluetooth')}
                    style={s.networkTile}
                  >
                    <View style={s.flex}>
                      <View style={s.row}>
                        <BluetoothIcon />
                        <Text style={s.sectionTitle}>По Bluetooth</Text>
                      </View>
                      <Text style={s.muted}>С друзьями рядом · без интернета</Text>
                    </View>
                    <Text style={s.navIcon}>→</Text>
                  </Pressable>
                  <Button
                    secondary
                    title="Статистика"
                    onPress={() => {
                      setHistoryOpen(true);
                      if (user) syncHistory();
                    }}
                  />
                  <View style={s.infoRow}>
                    <View style={s.infoItem}>
                      <Text style={s.infoNumber}>2–4</Text>
                      <Text style={s.caption}>игрока за столом</Text>
                    </View>
                    <View style={s.infoDivider} />
                    <View style={s.infoItem}>
                      <Text style={s.infoNumber}>24–54</Text>
                      <Text style={s.caption}>карты в колоде</Text>
                    </View>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setDialog('rules')}
                    style={s.rulesLink}
                  >
                    <Text style={s.muted}>Первый раз за столом?</Text>
                    <Text style={s.link}>Вспомнить правила →</Text>
                  </Pressable>
                </>
              )}
              {tab === 'rooms' && (
                <>
                  <Text style={s.eyebrow}>ИГРА С ДРУЗЬЯМИ</Text>
                  <Text style={s.title}>Общий стол</Text>
                  <Text style={s.muted}>
                    Играйте с друзьями через интернет. Подключение происходит автоматически.
                  </Text>
                  <View style={s.panel}>
                    <View style={s.row}>
                      <View style={[s.dot, !connected && { backgroundColor: colors.muted }]} />
                      <Text style={s.sectionTitle}>
                        {connected ? 'Сервер подключён' : 'Подключение к серверу'}
                      </Text>
                    </View>
                    <Text style={s.caption}>
                      {connected
                        ? 'Создайте комнату или присоединитесь к друзьям.'
                        : connectionIssue || 'Подключаемся к игре…'}
                    </Text>
                  </View>
                  {connected && (
                    <>
                      <Button title="+ Создать комнату" onPress={() => setDialog('network')} />
                      <View style={s.panel}>
                        <Field
                          label="Код комнаты"
                          value={code}
                          onChangeText={(v) =>
                            setCode(
                              v
                                .toUpperCase()
                                .replace(/[^A-Z0-9]/g, '')
                                .slice(0, 5)
                            )
                          }
                          placeholder="A1B2C"
                        />
                        <Button
                          secondary
                          title="Войти по коду"
                          disabled={code.length !== 5}
                          onPress={() => network.current?.join(code)}
                        />
                      </View>
                      <View style={s.rowBetween}>
                        <Text style={s.sectionTitle}>Открытые комнаты</Text>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => network.current?.send('getRooms')}
                          style={s.refresh}
                        >
                          <Text style={s.link}>Обновить</Text>
                        </Pressable>
                      </View>
                      {rooms.length ? (
                        rooms.map((room) => (
                          <View key={room.code} style={s.networkTile}>
                            <View style={s.flex}>
                              <Text translate={false} style={s.roomCode}>
                                {room.name || room.code}
                              </Text>
                              <Text style={s.caption}>{room.code}</Text>
                              <Text style={s.caption}>
                                {room.players}/{room.maxPlayers} · {room.modeLabel} ·{' '}
                                {room.gameTypeLabel}
                              </Text>
                            </View>
                            <Button
                              small
                              secondary
                              title="Войти"
                              onPress={() => network.current?.join(room.code)}
                            />
                          </View>
                        ))
                      ) : (
                        <Text style={s.emptyText}>
                          Пока пусто. Создайте свой стол и пригласите друзей.
                        </Text>
                      )}
                    </>
                  )}
                </>
              )}
              {tab === 'profile' && (
                <>
                  <Button title="Друзья" secondary onPress={() => setDialog('friends')} />
                  <LanguagePicker />
                  <Text style={s.eyebrow}>ВАШЕ МЕСТО В КЛУБЕ</Text>
                  <Button
                    secondary
                    title="⚙ Настройки игры"
                    onPress={() => setDialog('settings')}
                  />
                  <View style={s.profileHero}>
                    <View style={s.largeAvatar}>
                      <Text style={s.largeInitial}>{name.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <Text translate={false} style={s.title}>
                      {name}
                    </Text>
                    <Text style={s.muted}>
                      {user ? 'Аккаунт игрового сервера' : 'Локальный профиль · без регистрации'}
                    </Text>
                  </View>
                  <View style={s.panel}>
                    <Field label="Ник в игре" value={draftName} onChangeText={setDraftName} />
                    <Button title="Сохранить ник" onPress={rename} disabled={busy} />
                    <Text style={s.caption}>
                      Ник хранится на телефоне. При подключении также обновляется на сервере.
                    </Text>
                  </View>
                  <Button
                    secondary
                    title="Статистика"
                    onPress={() => {
                      setHistoryOpen(true);
                      if (user) syncHistory();
                    }}
                  />
                  <View style={s.networkTile}>
                    <View style={s.flex}>
                      <Text style={s.sectionTitle}>Тактильный отклик</Text>
                      <Text style={s.caption}>Лёгкая вибрация при ходе</Text>
                    </View>
                    <Switch
                      accessibilityLabel="Тактильный отклик"
                      value={haptics}
                      onValueChange={(value) => {
                        setHaptics(value);
                        if (value) tapHaptic();
                        save('haptics', value ? 'on' : 'off');
                      }}
                      trackColor={{ false: colors.line, true: colors.accent }}
                      thumbColor={colors.cream}
                    />
                  </View>
                  <View style={s.panel}>
                    <Text style={s.sectionTitle}>
                      {user ? 'Вы вошли в аккаунт' : 'Аккаунт для сетевой игры'}
                    </Text>
                    <Text style={s.muted}>
                      {connected
                        ? 'Используется выбранный игровой сервер.'
                        : 'Для входа подключитесь к серверу на вкладке «Комнаты». Для игры с ботами аккаунт не нужен.'}
                    </Text>
                    {user ? (
                      <Button
                        secondary
                        title="Выйти из аккаунта"
                        disabled={busy || !connected}
                        onPress={async () => {
                          setBusy(true);
                          try {
                            await network.current?.account('logout', {});
                          } catch (error) {
                            notify(message(error));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      />
                    ) : (
                      <Button
                        secondary
                        title={connected ? 'Вход / Регистрация' : 'К подключению'}
                        onPress={() => (connected ? setDialog('account') : setTab('rooms'))}
                      />
                    )}
                  </View>
                  <Text style={s.footer}>
                    ДУРАК / 3.3{'\n'}Интерфейс и локальная игра находятся в приложении.
                  </Text>
                </>
              )}
            </ScrollView>
            <View style={s.tabBar}>
              {(
                [
                  ['home', '♠', 'Игра'],
                  ['rooms', '▤', 'Комнаты'],
                  ['profile', '○', 'Профиль']
                ] as const
              ).map(([key, icon, label]) => (
                <Pressable
                  key={key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === key }}
                  onPress={() => setTab(key)}
                  style={[s.tab, tab === key && s.tabSelected]}
                >
                  <Text style={[s.tabIcon, tab === key && s.tabTextSelected]}>{icon}</Text>
                  <Text style={[s.tabText, tab === key && s.tabTextSelected]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {!!notice && (
          <Pressable onPress={() => setNotice('')} style={s.toast} accessibilityRole="alert">
            <Text style={s.toastText}>{notice}</Text>
          </Pressable>
        )}
        <Modal
          visible={historyOpen}
          transparent
          animationType={reducedMotion ? 'none' : 'fade'}
          onRequestClose={() => setHistoryOpen(false)}
        >
          <SafeAreaView style={s.timeoutShade}>
            <View style={s.historyModalWrap}>
              <View style={s.historyModal} accessibilityViewIsModal>
                <Button
                  secondary
                  title="Закрыть статистику"
                  onPress={() => setHistoryOpen(false)}
                />
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingTop: 12 }}
                >
                  {renderHistory()}
                </ScrollView>
              </View>
            </View>
          </SafeAreaView>
        </Modal>
        <Modal
          visible={resultVisible}
          transparent
          animationType={reducedMotion ? 'none' : 'fade'}
          onRequestClose={() => setResultClosed(true)}
        >
          <SafeAreaView style={s.timeoutShade}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.timeoutScroll}
            >
              <View
                style={[s.resultDialog, lost && !surrendered && s.resultDialogLost]}
                accessibilityViewIsModal
              >
                <Text style={s.resultEmoji}>{resultEmoji}</Text>
                <Text
                  style={[s.resultHeading, lost && !surrendered && s.resultHeadingLost]}
                  accessibilityRole="header"
                >
                  {resultTitle}
                </Text>
                <Text style={s.resultDescription}>{game?.resultText}</Text>
                <View style={s.resultButtons}>
                  {game?.canRestart && (
                    <Button
                      title="🔄 Новая игра"
                      disabled={!canAct}
                      onPress={() => send('restartGame')}
                    />
                  )}
                  <Button title="Выйти" secondary onPress={leave} />
                  <Button title="Закрыть" secondary onPress={() => setResultClosed(true)} />
                </View>
                {!!notice && (
                  <Text style={s.timeoutHelp} accessibilityRole="alert">
                    {notice}
                  </Text>
                )}
              </View>
            </ScrollView>
          </SafeAreaView>
        </Modal>
        <Modal
          visible={!!game?.timeout.active}
          transparent
          animationType={reducedMotion ? 'none' : 'fade'}
          onRequestClose={() => {}}
        >
          <SafeAreaView style={s.timeoutShade}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.timeoutScroll}
            >
              <View style={s.timeoutPanel} accessibilityViewIsModal>
                <Text style={s.timeoutTitle} accessibilityRole="header">
                  Тайм-аут
                </Text>
                <Text style={s.timeoutCountdown}>
                  {seconds === null
                    ? '—'
                    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
                </Text>
                <Text style={s.timeoutDescription}>
                  Игра приостановлена на одну минуту. Таймер хода сохранён.
                </Text>
                <Text style={s.timeoutDescription} accessibilityLiveRegion="polite">
                  За отмену тайм-аута: {game?.timeout.votes ?? 0} из {game?.timeout.required ?? 0}{' '}
                  необходимых голосов
                </Text>
                <Button
                  title={game?.timeout.voted ? 'Ваш голос учтён' : 'Голосовать за продолжение'}
                  disabled={!canAct || !game?.timeout.canVote || game.timeout.voted}
                  onPress={() => send('voteResume')}
                />
                <Text style={s.timeoutHelp}>
                  Голосование за отмену открыто весь тайм-аут. Нужно большинство голосов игроков.
                </Text>
                {!canAct && !pending && (
                  <Text style={s.timeoutHelp}>Нет связи. Ожидаем подключения…</Text>
                )}
                {!!notice && (
                  <Text style={s.timeoutHelp} accessibilityRole="alert">
                    {notice}
                  </Text>
                )}
              </View>
            </ScrollView>
          </SafeAreaView>
        </Modal>
        <Modal
          visible={!!dialog && !game?.timeout.active && !resultVisible}
          transparent={!accountPage}
          animationType={reducedMotion ? 'none' : 'slide'}
          onRequestClose={() => {
            closeDialog();
          }}
        >
          <KeyboardAvoidingView
            behavior="height"
            style={[s.modalShade, accountPage && s.accountPageShade]}
          >
            <SafeAreaView style={[s.modalSafe, accountPage && s.accountPageSafe]}>
              {accountPage && (
                <View style={s.brandHeader}>
                  <GameBrand />
                </View>
              )}
              <View style={[s.sheet, accountPage && s.accountPageSheet]}>
                {!accountPage && <View style={s.sheetHandle} />}
                <View
                  style={[s.rowBetween, accountPage && { marginTop: keyboardVisible ? 0 : 16 }]}
                >
                  <Text style={[s.title, accountPage && { fontSize: keyboardVisible ? 20 : 27 }]}>
                    {dialog === 'welcome'
                      ? 'Играйте под своим именем'
                      : dialog === 'bluetooth'
                        ? 'Игра рядом'
                        : dialog === 'friends'
                          ? 'Друзья'
                          : dialog === 'settings'
                            ? 'Настройки'
                            : dialog === 'account'
                              ? register
                                ? 'Создать аккаунт'
                                : 'С возвращением'
                              : dialog === 'rules'
                                ? 'Как играть'
                                : 'Новая партия'}
                  </Text>
                  {!accountPage && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Закрыть"
                      disabled={busy}
                      style={s.iconButton}
                      onPress={closeDialog}
                    >
                      <Text style={s.navIcon}>×</Text>
                    </Pressable>
                  )}
                </View>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  scrollEnabled={!accountPage}
                  bounces={!accountPage}
                  contentContainerStyle={[
                    s.sheetBody,
                    accountPage && { gap: keyboardVisible ? 6 : 12, paddingVertical: 12 }
                  ]}
                >
                  {dialog === 'welcome' && (
                    <WelcomeMotion compact>
                      <Text style={s.caption}>
                        Создайте аккаунт, чтобы ваши результаты оставались с вами.
                      </Text>
                      <View style={s.welcomeBenefit}>
                        <Text style={s.sectionTitle}>Ваш профиль</Text>
                        <Text style={s.caption}>
                          Ник сохраняется в аккаунте и доступен на сайте и в приложении.
                        </Text>
                      </View>
                      <View style={s.welcomeBenefit}>
                        <Text style={s.sectionTitle}>История матчей</Text>
                        <Text style={s.caption}>
                          Когда и против кого вы играли, победы, поражения и ничьи — в одном месте.
                        </Text>
                      </View>
                      <View style={s.welcomeBenefit}>
                        <Text style={s.sectionTitle}>Результаты на разных устройствах</Text>
                        <Text style={s.caption}>
                          Войдите в тот же аккаунт. Результаты игр с ботами и по Bluetooth
                          отправятся при подключении.
                        </Text>
                      </View>
                      <Button
                        small
                        title="Создать аккаунт"
                        onPress={() => {
                          setRegister(true);
                          setDialog('account');
                        }}
                      />
                      <Button
                        small
                        title="Продолжить без аккаунта"
                        secondary
                        onPress={finishWelcome}
                      />
                      <Button
                        small
                        title="Уже есть аккаунт? Войти"
                        secondary
                        onPress={() => {
                          setRegister(false);
                          setDialog('account');
                        }}
                      />
                      <Text style={s.caption}>
                        Можно зарегистрироваться позже. История аккаунта ведётся после входа.
                      </Text>
                    </WelcomeMotion>
                  )}
                  {(dialog === 'local' || dialog === 'network' || dialog === 'bluetooth-host') && (
                    <>
                      <Text style={s.muted}>
                        {dialog === 'local'
                          ? 'Выберите правила. Остальные места займут боты.'
                          : dialog === 'bluetooth-host'
                            ? 'Создайте Bluetooth-стол. Друзья выберут ваш телефон в поиске. Все места займут реальные игроки.'
                            : 'Создайте комнату и пригласите друзей по коду.'}
                      </Text>
                      {dialog === 'network' && (
                        <Field
                          label="Название комнаты"
                          value={options.name || ''}
                          onChangeText={(name) =>
                            setOptions({ ...options, name: name.slice(0, 40) })
                          }
                        />
                      )}
                      <Text style={s.label}>Колода</Text>
                      <View style={s.chips}>
                        {['24', '36', '52', '54'].map((mode) => (
                          <Pressable
                            accessibilityRole="radio"
                            accessibilityState={{ checked: options.mode === mode }}
                            key={mode}
                            onPress={() => setOptions({ ...options, mode })}
                            style={[s.chip, options.mode === mode && s.chipSelected]}
                          >
                            <Text style={[s.chipText, options.mode === mode && s.chipTextSelected]}>
                              {mode}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      <Text style={s.label}>Игроков за столом</Text>
                      <View style={s.chips}>
                        {[2, 3, 4].map((maxPlayers) => (
                          <Pressable
                            accessibilityRole="radio"
                            accessibilityState={{ checked: options.maxPlayers === maxPlayers }}
                            key={maxPlayers}
                            onPress={() => setOptions({ ...options, maxPlayers })}
                            style={[s.chip, options.maxPlayers === maxPlayers && s.chipSelected]}
                          >
                            <Text
                              style={[
                                s.chipText,
                                options.maxPlayers === maxPlayers && s.chipTextSelected
                              ]}
                            >
                              {maxPlayers}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      <Text style={s.label}>Правила</Text>
                      <View style={s.chips}>
                        {[
                          ['throwIn', 'Подкидной'],
                          ['transfer', 'Переводной']
                        ].map(([gameType, label]) => (
                          <Pressable
                            accessibilityRole="radio"
                            accessibilityState={{ checked: options.gameType === gameType }}
                            key={gameType}
                            onPress={() => setOptions({ ...options, gameType })}
                            style={[s.chip, options.gameType === gameType && s.chipSelected]}
                          >
                            <Text
                              style={[
                                s.chipText,
                                options.gameType === gameType && s.chipTextSelected
                              ]}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      <Button
                        disabled={busy}
                        title={
                          busy
                            ? 'Подготовка…'
                            : dialog === 'local'
                              ? 'Раздать карты'
                              : 'Создать комнату'
                        }
                        onPress={() => {
                          if (dialog === 'local') startLocal();
                          else if (dialog === 'bluetooth-host') startBluetooth(true);
                          else {
                            network.current?.create(options);
                            setDialog(null);
                          }
                        }}
                      />
                    </>
                  )}
                  {dialog === 'bluetooth' && (
                    <>
                      <Text style={s.muted}>{btStatus}</Text>
                      <Button
                        title="Создать стол"
                        disabled={busy}
                        onPress={() => {
                          bluetooth.current?.dispose();
                          setDialog('bluetooth-host');
                        }}
                      />
                      <Button
                        title={busy ? 'Подготовка…' : 'Найти друга / повторить поиск'}
                        disabled={busy}
                        secondary
                        onPress={() => startBluetooth(false)}
                      />
                      <Text style={s.caption}>
                        Сначала друг должен создать стол. Список показывает устройства, а не только
                        открытые комнаты. На Android 11 и ниже включите геолокацию для поиска.
                      </Text>
                      <View style={s.rowBetween}>
                        <Text style={s.sectionTitle}>Только телефоны</Text>
                        <Switch
                          accessibilityLabel="Только телефоны"
                          value={phonesOnly}
                          onValueChange={setPhonesOnly}
                          trackColor={{ true: colors.accent, false: colors.panel }}
                        />
                      </View>
                      {phonesOnly && (
                        <Text style={s.caption}>
                          Нет телефона друга? Выключите фильтр: некоторые телефоны не сообщают свой
                          тип.
                        </Text>
                      )}
                      {devices
                        .filter((device) => !phonesOnly || device.isPhone)
                        .map((device) => (
                          <Button
                            key={device.id}
                            secondary
                            disabled={busy}
                            title={
                              device.name.slice(0, 40) +
                              (device.name.length > 40 ? '…' : '') +
                              ' · ' +
                              device.id.slice(-5)
                            }
                            onPress={async () => {
                              setBusy(true);
                              try {
                                await bluetooth.current?.join(device.id);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          />
                        ))}
                    </>
                  )}
                  {dialog === 'friends' && <FriendsPanel client={network.current} user={user} />}
                  {dialog === 'settings' && (
                    <>
                      <LanguagePicker />
                      <Text style={s.label}>Сортировка карт</Text>
                      <View style={s.chips}>
                        {[
                          ['suit', 'По масти'],
                          ['rank', 'По значению'],
                          ['deal', 'Как раздали']
                        ].map(([id, label]) => (
                          <Button
                            key={id}
                            title={label}
                            small
                            secondary={sortOrder !== id}
                            onPress={() => {
                              setSortOrder(id);
                              AsyncStorage.setItem('durak.native.sort', id).catch(() =>
                                setNotice('Не удалось сохранить настройки')
                              );
                            }}
                          />
                        ))}
                      </View>
                      <Field label="Ник в игре" value={draftName} onChangeText={setDraftName} />
                      <Button title="Сохранить ник" onPress={rename} disabled={busy} />
                      <View style={s.rowBetween}>
                        <Text style={s.sectionTitle}>Музыка</Text>
                        <Switch
                          accessibilityLabel="Музыка"
                          value={audio.music}
                          onValueChange={(music) => changeAudio({ music })}
                          trackColor={{ false: colors.line, true: colors.accent }}
                          thumbColor={colors.cream}
                        />
                      </View>
                      <Volume
                        title="Громкость музыки"
                        value={audio.musicVolume}
                        onChange={(musicVolume) => changeAudio({ musicVolume })}
                      />
                      <View style={s.rowBetween}>
                        <Text style={s.sectionTitle}>Звуки карт</Text>
                        <Switch
                          accessibilityLabel="Звуки карт"
                          value={audio.sounds}
                          onValueChange={(sounds) => changeAudio({ sounds })}
                          trackColor={{ false: colors.line, true: colors.accent }}
                          thumbColor={colors.cream}
                        />
                      </View>
                      <Volume
                        title="Громкость эффектов"
                        value={audio.soundVolume}
                        onChange={(soundVolume) => changeAudio({ soundVolume })}
                      />
                      <View style={s.rowBetween}>
                        <Text style={s.sectionTitle}>Вибрация</Text>
                        <Switch
                          accessibilityLabel="Вибрация"
                          value={haptics}
                          onValueChange={(value) => {
                            setHaptics(value);
                            if (value) tapHaptic();
                            save('haptics', value ? 'on' : 'off');
                          }}
                          trackColor={{ false: colors.line, true: colors.accent }}
                          thumbColor={colors.cream}
                        />
                      </View>
                      <Text style={s.sectionTitle}>Оформление колоды</Text>
                      {skins.map((id, i) => (
                        <Pressable
                          key={id}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: skin === id }}
                          accessibilityLabel={skinNames[i]}
                          onPress={() => {
                            setSkin(id);
                            save('skin', id);
                            playSound('click');
                          }}
                          style={[s.networkTile, skin === id && { borderColor: colors.accent }]}
                        >
                          <Image
                            source={faces[id].QH}
                            style={{ width: 42, height: 60 }}
                            resizeMode="contain"
                          />
                          <Image
                            source={backs[id]}
                            style={{ width: 42, height: 60 }}
                            resizeMode="contain"
                          />
                          <Text style={[s.sectionTitle, { flex: 1 }]}>
                            {skinNames[i]}
                            {skin === id ? ' ✓' : ''}
                          </Text>
                        </Pressable>
                      ))}
                      <Text style={s.caption}>
                        Настройки сохраняются на этом телефоне. Музыка приостанавливается, когда
                        игра свёрнута.
                      </Text>
                      <PatreonButton label />
                      <Button title="Готово" onPress={closeDialog} />
                    </>
                  )}
                  {dialog === 'account' && (
                    <>
                      {!keyboardVisible && (
                        <Text style={s.caption}>
                          Почта и пароль игрового аккаунта. Пароль от почты не нужен.
                        </Text>
                      )}
                      <Field
                        label="Почта"
                        email
                        compact
                        value={email}
                        onChangeText={setEmail}
                        placeholder="name@example.com"
                      />
                      <Field
                        label="Пароль"
                        password
                        compact
                        value={password}
                        onChangeText={setPassword}
                      />
                      {register && (
                        <Field
                          label="Повторите пароль"
                          password
                          compact
                          value={confirmPassword}
                          onChangeText={setConfirmPassword}
                        />
                      )}
                      {register && !keyboardVisible && (
                        <Text style={s.caption}>
                          Ваш ник: <Text translate={false}>{name}</Text>. Пароль — от 8 до 128
                          символов.
                        </Text>
                      )}
                      {register && !!confirmPassword && password !== confirmPassword && (
                        <Text accessibilityRole="alert" style={s.caption}>
                          Пароли не совпадают
                        </Text>
                      )}
                      <Button
                        title={busy ? 'Подождите…' : register ? 'Создать аккаунт' : 'Войти'}
                        compact={keyboardVisible}
                        disabled={
                          busy ||
                          !connected ||
                          !email.trim() ||
                          password.length < 8 ||
                          password.length > 128 ||
                          (register && password !== confirmPassword)
                        }
                        onPress={account}
                      />
                      {!keyboardVisible && (
                        <>
                          <Button
                            secondary
                            title={register ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт'}
                            disabled={busy}
                            onPress={() => setRegister(!register)}
                          />
                          <Button secondary title="Назад" disabled={busy} onPress={closeDialog} />
                          {!connected && (
                            <Text style={s.caption}>
                              Нет связи с сервером. Подключаемся автоматически…
                            </Text>
                          )}
                        </>
                      )}
                    </>
                  )}
                  {dialog === 'rules' && (
                    <>
                      <Text style={s.ruleNumber}>01 / ЦЕЛЬ</Text>
                      <Text style={s.muted}>
                        Избавьтесь от карт раньше остальных. Последний игрок с картами проигрывает.
                      </Text>
                      <Text style={s.ruleNumber}>02 / АТАКА И ЗАЩИТА</Text>
                      <Text style={s.muted}>
                        Защищайтесь старшей картой той же масти или козырем. Козырь бьётся только
                        старшим козырем. Подкидывайте значения, которые уже есть на столе.
                      </Text>
                      <Text style={s.ruleNumber}>03 / ВАШ ВЫБОР</Text>
                      <Text style={s.muted}>
                        Не можете отбиться — нажмите «Взять». Когда все карты покрыты, атакующий
                        нажимает «Бито». Первый отбой — до 5 карт, затем до 6.
                      </Text>
                      <Text style={s.ruleNumber}>04 / ПЕРЕВОДНОЙ</Text>
                      <Text style={s.muted}>
                        До первой защиты атаку можно перевести картой того же значения, если
                        следующему игроку хватает карт. Нажмите «Перевести» и выберите подсвеченную
                        карту.
                      </Text>
                      <Text style={s.ruleNumber}>05 / ДЖОКЕРЫ</Text>
                      <Text style={s.muted}>
                        В колоде 54 карты красный джокер защищает красные масти, чёрный — чёрные.
                        Атаковать и переводить джокером нельзя.
                      </Text>
                    </>
                  )}
                </ScrollView>
              </View>
              {!!notice && (
                <Text style={s.modalNotice} accessibilityRole="alert">
                  {notice}
                </Text>
              )}
            </SafeAreaView>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </SkinContext.Provider>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <MotionProvider>
        <LanguageProvider>
          <DurakApp />
        </LanguageProvider>
      </MotionProvider>
    </SafeAreaProvider>
  );
}
