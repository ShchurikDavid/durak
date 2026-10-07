import React, { createContext, useContext, useEffect, useState } from 'react';
import { Text, View, Pressable, type TextProps } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { localize } from '../public/js/translations';
import { s } from './styles';
type Language = 'ru' | 'uk' | 'en';
const Context = createContext({ language: 'ru' as Language, setLanguage: (_: Language) => {} });
export const useLanguage = () => useContext(Context);
export function textFor(text: string, language: Language): string {
  return localize(text, language);
}
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, set] = useState<Language>('ru');
  useEffect(() => {
    AsyncStorage.getItem('durak.native.language')
      .then((value) => {
        if (value === 'en' || value === 'uk') set(value);
      })
      .catch(() => {});
  }, []);
  return (
    <Context.Provider
      value={{
        language,
        setLanguage: (value) => {
          set(value);
          AsyncStorage.setItem('durak.native.language', value).catch(() => {});
        }
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function LocalText({
  children,
  translate = true,
  ...props
}: TextProps & { translate?: boolean }) {
  const { language } = useLanguage();
  const localize = (node: React.ReactNode): React.ReactNode =>
    typeof node === 'string'
      ? textFor(node, language)
      : Array.isArray(node)
        ? node.map(localize)
        : node;
  return <Text {...props}>{translate ? localize(children) : children}</Text>;
}
export function LanguagePicker() {
  const { language, setLanguage } = useLanguage();
  return (
    <View style={{ gap: 10 }}>
      <LocalText style={s.label}>Язык</LocalText>
      <View style={s.chips}>
        {(['ru', 'uk', 'en'] as Language[]).map((id, i) => (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ checked: language === id }}
            onPress={() => setLanguage(id)}
            style={[s.chip, language === id && s.chipSelected]}
          >
            <Text style={[s.chipText, language === id && s.chipTextSelected]}>
              {['Русский', 'Українська', 'English'][i]}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
