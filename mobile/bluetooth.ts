import { NativeModules, NativeEventEmitter, PermissionsAndroid, Platform } from 'react-native';
import { createBluetoothHost } from './bluetooth-host';
import type { GameState, Options, Session } from './types';
const native = NativeModules.GameBluetooth;
type Event = { type: string; id: string; value: string; isPhone?: boolean };
export type Device = { id: string; name: string; isPhone: boolean };
export class BluetoothGame implements Session {
  private disposed = false;
  private hostGame: ReturnType<typeof createBluetoothHost> | null = null;
  private peer = '';
  private isHost = false;
  private devicesFound = new Set<string>();
  private accepting = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sub;
  constructor(
    private name: string,
    private callbacks: {
      state: (state: GameState) => void;
      device: (device: Device) => void;
      status: (text: string) => void;
      closed: (text: string) => void;
    }
  ) {
    if (!native) throw new Error('Bluetooth доступен в новой Android-сборке приложения');
    this.sub = new NativeEventEmitter(native).addListener('durakBluetooth', (raw) => {
      const event = raw as Event;
      if (this.disposed) return;
      if (event.type === 'device' && !this.peer && !this.isHost) {
        this.devicesFound.add(event.id);
        callbacks.device({ id: event.id, name: event.value, isPhone: event.isPhone === true });
      }
      if (event.type === 'scanStatus' && !this.peer && !this.isHost) callbacks.status(event.value);
      if (event.type === 'scanEnd' && !this.peer && !this.isHost)
        callbacks.status(
          this.devicesFound.size
            ? 'Поиск завершён. Выберите телефон друга, на котором создан стол.'
            : 'Устройства не найдены. Пусть друг создаст стол и включит видимость, затем повторите поиск.'
        );
      if (event.type === 'error') this.close(event.value);
      if (event.type === 'disconnected') {
        if (this.isHost) this.hostGame?.disconnected(event.id);
        else if (event.id === this.peer)
          this.close('Связь с создателем стола потеряна. Подключитесь заново.');
      }
      if (event.type === 'message') {
        try {
          const packet = JSON.parse(event.value);
          if (this.isHost) this.hostGame?.receive(event.id, packet);
          else if (event.id === this.peer) {
            if (
              packet.type === 'state' &&
              packet.state?.bluetooth &&
              Array.isArray(packet.state.myHand) &&
              Array.isArray(packet.state.players) &&
              packet.state.timeout
            ) {
              clearTimeout(this.timer);
              const offset = Number.isFinite(packet.sentAt) ? Date.now() - packet.sentAt : 0;
              if (packet.state.turnDeadline) packet.state.turnDeadline += offset;
              if (packet.state.timeout.deadline) packet.state.timeout.deadline += offset;
              callbacks.status('Вы подключены к столу по Bluetooth.');
              callbacks.state(packet.state);
            }
            if (packet.type === 'closed') this.close(packet.message || 'Стол закрыт');
          }
        } catch {
          /* Ignore malformed or incompatible packets. */
        }
      }
    });
  }
  private close(text: string) {
    if (this.disposed) return;
    this.dispose();
    this.callbacks.closed(text);
  }
  private async prepare(discoverable = false): Promise<string> {
    const permissions =
      Number(Platform.Version) >= 31
        ? [
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE
          ]
        : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const granted = await PermissionsAndroid.requestMultiple(permissions);
    if (
      permissions.some((permission) => granted[permission] !== PermissionsAndroid.RESULTS.GRANTED)
    )
      throw new Error(
        'Разрешите доступ к Bluetooth в настройках приложения. На Android 11 и ниже для поиска нужна геолокация.'
      );
    if (this.disposed) throw new Error('Поиск отменён');
    const deviceName = await native.prepare(discoverable);
    if (this.disposed) throw new Error('Поиск отменён');
    return deviceName;
  }
  async scan() {
    await this.prepare();
    this.devicesFound.clear();
    this.callbacks.status('Ищем телефоны рядом… Выберите телефон друга, на котором создан стол.');
    await native.scan();
  }
  async host(options: Options) {
    const deviceName = await this.prepare(true);
    this.isHost = true;
    await native.host();
    this.accepting = true;
    if (this.disposed) {
      native.stop();
      return;
    }
    this.hostGame = createBluetoothHost({
      ...options,
      name: this.name,
      onState: (state: GameState) => {
        if (this.accepting && state.status !== 'waiting') {
          this.accepting = false;
          native.stopHosting();
        }
        this.callbacks.state(state);
      },
      send: (id: string, packet: unknown) => native.send(id, JSON.stringify(packet)),
      close: (text: string) => this.close(text)
    });
    this.callbacks.status(`Ваш телефон: ${deviceName}. Видимость включена на 5 минут.`);
  }
  async advertise() {
    if (!this.isHost || this.disposed) return;
    const deviceName = await this.prepare(true);
    this.callbacks.status(`Ваш телефон: ${deviceName}. Видимость включена на 5 минут.`);
  }
  async join(id: string) {
    this.peer = id;
    this.callbacks.status(
      'Подключаемся… Подтвердите сопряжение на обоих телефонах, если Android попросит.'
    );
    this.timer = setTimeout(
      () =>
        this.close(
          'Время подключения истекло. Убедитесь, что друг создал стол в этой версии приложения.'
        ),
      35000
    );
    try {
      await native.connect(id);
      if (this.disposed) return;
      native.send(id, JSON.stringify({ type: 'hello', version: 1, name: this.name }));
    } catch (error) {
      if (!this.disposed)
        this.close(error instanceof Error ? error.message : 'Не удалось подключиться');
    }
  }
  send(event: string, payload?: unknown) {
    if (this.disposed) return;
    if (this.hostGame) this.hostGame.send(event, payload);
    else native.send(this.peer, JSON.stringify({ type: 'command', event, payload }));
  }
  rename(name: string) {
    if (this.hostGame) this.hostGame.rename(name);
    else native.send(this.peer, JSON.stringify({ type: 'rename', name }));
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.hostGame?.dispose();
    this.sub.remove();
    native.stop();
  }
}
