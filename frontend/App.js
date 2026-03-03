import React, { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { enableScreens } from 'react-native-screens';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
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
import { ThemeProvider, useAppTheme } from './utils/theme';
import { AuthProvider, useAuth } from './utils/AuthContext';
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
    (route, params) => {
      const target = ROUTE_MAP[route] || route;
      navigation.navigate(target, params);
    },
    [navigation],
  );
}

/* ── Tab-screen wrappers (stable component refs) ── */

function HomeTab({ navigation, route }) {
  const onNavigate = useOnNavigate(navigation);
  return <HomeScreen onNavigate={onNavigate} openChatSignal={route?.params?.openChatSignal} />;
}

function ForumTab({ navigation, route }) {
  const onNavigate = useOnNavigate(navigation);
  return <CommunityForumScreen onNavigate={onNavigate} openNotificationsSignal={route?.params?.openNotificationsSignal} />;
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

function LoginWithTheme() {
  const { isDark } = useAppTheme();
  return <View className={`flex-1 ${isDark ? 'bg-aquadark' : 'bg-slate-100'}`}><LoginScreen /></View>;
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

/* ── Main app content ── */
// React.memo prevents re-renders triggered by ThemeProvider state changes.
// In React 19 + React Navigation v7 the "children-as-props" bailout is no
// longer guaranteed, so without memo the NavigationContainer remounts on
// every theme toggle and tears down the navigation context.

const AppContent = React.memo(function AppContent() {
  const { isDark } = useAppTheme();
  const { isAuthenticated, loading } = useAuth();

  const navigationTheme = useMemo(() => {
    if (isDark) {
      return {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: '#020617',
          card: '#020617',
        },
      };
    }

    return {
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        background: '#f1f5f9',
        card: '#f1f5f9',
      },
    };
  }, [isDark]);

  // Wait for auth context to resolve before rendering navigator
  if (loading) return null;

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navigationTheme}>
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
              {() => <LoginWithTheme />}
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
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}
