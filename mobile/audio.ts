import { NativeModules } from 'react-native';

export type AudioSettings = {
  music: boolean;
  sounds: boolean;
  musicVolume: number;
  soundVolume: number;
};
export const defaultAudio: AudioSettings = {
  music: true,
  sounds: true,
  musicVolume: 3,
  soundVolume: 100
};
const native = NativeModules.GameAudio;
export function configureAudio(value: AudioSettings) {
  native?.configure(value.music, value.sounds, value.musicVolume / 100, value.soundVolume / 100);
}
export function playSound(action?: string) {
  if (
    action &&
    [
      'play',
      'defend',
      'transfer',
      'take',
      'bito',
      'start',
      'gameOver',
      'click',
      'timeout-take',
      'timeout-bito'
    ].includes(action)
  )
    native?.play(action);
}
export function stopAudio() {
  native?.stop();
}
