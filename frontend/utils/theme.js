import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const THEME_STORAGE_KEY = '@waterops:theme';

const ThemeContext = createContext({
  themeMode: 'dark',
  isDark: true,
  setThemeMode: () => {},
  toggleTheme: () => {},
});

export const ThemeProvider = ({ children }) => {
  const [themeMode, setThemeModeState] = useState('dark');
  const renderCount = useRef(0);

  useEffect(() => {
    renderCount.current += 1;
    console.debug(`[Theme] Provider rendered (#${renderCount.current}), mode=${themeMode}`);
  });

  useEffect(() => {
    let mounted = true;
    const loadTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (!mounted) return;
        if (savedTheme === 'light' || savedTheme === 'dark') {
          console.debug('[Theme] Loaded persisted theme:', savedTheme);
          setThemeModeState(savedTheme);
        }
      } catch (error) {
        console.warn('[Theme] Failed to load theme mode:', error);
      }
    };

    loadTheme();
    return () => {
      mounted = false;
    };
  }, []);

  const setThemeMode = useCallback(async (nextMode) => {
    const normalized = nextMode === 'light' ? 'light' : 'dark';
    console.debug('[Theme] setThemeMode →', normalized);
    setThemeModeState(normalized);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, normalized);
    } catch (error) {
      console.warn('[Theme] Failed to persist theme mode:', error);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    console.debug('[Theme] toggleTheme called');
    // Plain synchronous state update — do NOT use startTransition here.
    // startTransition creates a concurrent-like render that can expose
    // React Navigation's internal context before it has fully propagated,
    // especially on freshly mounted NavigationContainers (e.g. right
    // after login).  The BottomTabBar's deferred-action pattern already
    // ensures the Modal is fully unmounted before this fires, so the
    // original performance concern is addressed without concurrent mode.
    setThemeModeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      console.debug(`[Theme] transitioning ${prev} → ${next}`);
      AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch((e) =>
        console.warn('[Theme] Failed to persist theme mode:', e),
      );
      return next;
    });
  }, []);

  const contextValue = useMemo(
    () => ({
      themeMode,
      isDark: themeMode === 'dark',
      setThemeMode,
      toggleTheme,
    }),
    [themeMode, setThemeMode, toggleTheme],
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
};

export const useAppTheme = () => useContext(ThemeContext);
