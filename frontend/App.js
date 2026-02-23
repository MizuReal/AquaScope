import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { enableScreens } from 'react-native-screens';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import './global.css';

enableScreens(true);

import LoginScreen from './screens/LoginScreen';
import HomeScreen from './screens/HomeScreen';
import DataInputScreen from './screens/DataInputScreen';
import ContainerAnalysisScreen from './screens/ContainerAnalysisScreen';
import PredictionHistoryScreen from './screens/PredictionHistoryScreen';
import AnalysisScreen from './screens/AnalysisScreen';
import ProfileScreen from './screens/ProfileScreen';
import CommunityForumScreen from './screens/CommunityForumScreen';
import { supabase } from './utils/supabaseClient';
import { ThemeProvider, useAppTheme } from './utils/theme';
import BottomTabBar from './components/BottomTabBar';

const Tab = createBottomTabNavigator();

/**
 * Map legacy route keys (used by onNavigate inside screens) to
 * the tab-screen names registered in the navigator.
 */
const ROUTE_MAP = {
  home: 'Home',
  dataInput: 'DataInput',
  containerAnalysis: 'Container',
  predictionHistory: 'History',
  analysis: 'Analytics',
  profile: 'Profile',
  community: 'Forum',
};

/**
 * Bridge hook: returns an onNavigate(legacyKey) callback so existing
 * screens that call onNavigate('home') etc. continue to work unchanged.
 */
function useOnNavigate(navigation) {
  return useCallback(
    (route) => {
      const target = ROUTE_MAP[route] || route;
      navigation.navigate(target);
    },
    [navigation],
  );
}

/* ── Tab-screen wrappers (stable component refs) ── */

function HomeTab({ navigation }) {
  const onNavigate = useOnNavigate(navigation);
  return <HomeScreen onNavigate={onNavigate} />;
}

function ForumTab({ navigation }) {
  const onNavigate = useOnNavigate(navigation);
  return <CommunityForumScreen onNavigate={onNavigate} />;
}

function HistoryTab({ navigation }) {
  const onNavigate = useOnNavigate(navigation);
  return <PredictionHistoryScreen onNavigate={onNavigate} />;
}

function ContainerTab({ navigation }) {
  const onNavigate = useOnNavigate(navigation);
  return <ContainerAnalysisScreen onNavigate={onNavigate} />;
}

function AnalyticsTab({ navigation }) {
  const onNavigate = useOnNavigate(navigation);
  return <AnalysisScreen onNavigate={onNavigate} />;
}

function DataInputTab({ navigation }) {
  const onNavigate = useOnNavigate(navigation);
  return <DataInputScreen onNavigate={onNavigate} />;
}

function ProfileTab({ navigation }) {
  const onNavigate = useOnNavigate(navigation);
  return <ProfileScreen onNavigate={onNavigate} />;
}

/* ── Small themed helpers (subscribe to theme individually) ── */

function LoginWithTheme({ onLoginSuccess }) {
  const { isDark } = useAppTheme();
  return <View className={`flex-1 ${isDark ? 'bg-aquadark' : 'bg-slate-100'}`}><LoginScreen onLoginSuccess={onLoginSuccess} /></View>;
}

function ThemedStatusBar() {
  const { isDark } = useAppTheme();
  return <StatusBar style={isDark ? 'light' : 'dark'} />;
}

/* ── Stable tabBar renderer (created once, outside any component) ── */
function renderTabBar(props) {
  return <BottomTabBar {...props} />;
}

function renderHiddenTabBar() {
  return null;
}

/* ── Stable screen options (created once, outside any component) ── */
const TAB_SCREEN_OPTIONS = {
  headerShown: false,
  freezeOnBlur: false,
  animationEnabled: false,
};

const LOGIN_SCREEN_OPTIONS = {
  headerShown: false,
  animationEnabled: false,
};

/* ── Navigation state logger — helps diagnose intermittent context errors ── */
function onNavStateChange(state) {
  if (__DEV__) {
    const route = state?.routes?.[state.index];
    console.debug('[Nav] state →', route?.name ?? 'unknown', `(index ${state?.index})`);
  }
}

function onNavReady() {
  console.debug('[Nav] NavigationContainer ready');
}

/* ── Main app content ── */
// React.memo prevents re-renders triggered by ThemeProvider state changes.
// In React 19 + React Navigation v7 the "children-as-props" bailout is no
// longer guaranteed, so without memo the NavigationContainer remounts on
// every theme toggle and tears down the navigation context.

const AppContent = React.memo(function AppContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.warn('[Supabase] getSession error:', error.message);
        }
        if (isMounted) {
          setIsAuthenticated(!!data?.session);
        }
      } catch (e) {
        console.warn('[Supabase] Unexpected getSession error:', e);
      }
    };

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setIsAuthenticated(!!session);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer onStateChange={onNavStateChange} onReady={onNavReady}>
        <Tab.Navigator
          key={isAuthenticated ? 'auth-on' : 'auth-off'}
          tabBar={isAuthenticated ? renderTabBar : renderHiddenTabBar}
          screenOptions={isAuthenticated ? TAB_SCREEN_OPTIONS : LOGIN_SCREEN_OPTIONS}
          initialRouteName={isAuthenticated ? 'Home' : 'Login'}
          detachInactiveScreens={false}
        >
          {isAuthenticated ? (
            <>
              {/* Visible in the tab bar */}
              <Tab.Screen name="Forum" component={ForumTab} />
              <Tab.Screen name="History" component={HistoryTab} />
              <Tab.Screen name="Home" component={HomeTab} />
              <Tab.Screen name="Container" component={ContainerTab} />
              <Tab.Screen name="Analytics" component={AnalyticsTab} />

              {/* Hidden tabs — reachable via navigation.navigate() only */}
              <Tab.Screen name="DataInput" component={DataInputTab} />
              <Tab.Screen name="Profile" component={ProfileTab} />
            </>
          ) : (
            <Tab.Screen name="Login">
              {() => <LoginWithTheme onLoginSuccess={() => setIsAuthenticated(true)} />}
            </Tab.Screen>
          )}
        </Tab.Navigator>
        <ThemedStatusBar />
      </NavigationContainer>
    </SafeAreaProvider>
  );
});

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
