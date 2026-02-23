import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { InteractionManager } from 'react-native';
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
    // Wrap in startTransition so React treats the re-render as non-urgent.
    // This prevents the massive cascading re-render from blocking the UI
    // thread, which caused the intermittent NavigationContainer teardown.
    startTransition(() => {
      setThemeModeState((prev) => {
        const next = prev === 'dark' ? 'light' : 'dark';
        console.debug(`[Theme] transitioning ${prev} → ${next}`);
        // Persist outside the updater to avoid side-effects in render
        AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch((e) =>
          console.warn('[Theme] Failed to persist theme mode:', e),
        );
        return next;
      });
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
