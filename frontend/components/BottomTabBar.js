import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, Animated, Modal, PanResponder, InteractionManager } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../utils/theme';
import { supabase } from '../utils/supabaseClient';

const SWIPE_UP_THRESHOLD = 30; // px the finger must travel upward to trigger

/**
 * Tabs rendered in the visible bar.
 * DataInput and Profile are registered as tab screens but hidden from the bar;
 * they're reachable via navigation.navigate() from within other screens.
 */
const VISIBLE_TABS = [
  { name: 'Forum', label: 'Forum', iconLib: 'Feather', icon: 'message-circle' },
  { name: 'DataInput', label: 'Quality', iconLib: 'MCI', icon: 'text-recognition' },
  { name: 'Home', label: 'Ask AI', iconLib: 'MCI', icon: 'robot-happy-outline', isCenter: true },
  { name: 'Container', label: 'Container', iconLib: 'MCI', icon: 'package-variant-closed' },
  { name: 'Analytics', label: 'Analytics', iconLib: 'Feather', icon: 'trending-up' },
];

const BottomTabBar = ({ state, navigation }) => {
  const { isDark, toggleTheme } = useAppTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnim = useRef(new Animated.Value(0)).current;
  // Pending action to run after the menu modal finishes closing
  const pendingAction = useRef(null);

  useEffect(() => {
    Animated.timing(menuAnim, {
      toValue: menuOpen ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [menuOpen, menuAnim]);

  /**
   * Close the menu and optionally schedule a callback for AFTER the
   * Modal has fully unmounted.  This prevents the "navigation context"
   * crash that occurred when setMenuOpen(false) + toggleTheme() (or
   * navigation.navigate) fired in the same synchronous tick — the Modal
   * teardown raced with the cascading theme re-render.
   */
  const closeMenu = useCallback((afterClose) => {
    if (afterClose) {
      pendingAction.current = afterClose;
    }
    setMenuOpen(false);
  }, []);

  // Fire pending action after Modal unmounts (onDismiss / onRequestClose path)
  useEffect(() => {
    if (!menuOpen && pendingAction.current) {
      const action = pendingAction.current;
      pendingAction.current = null;
      // Wait until the current interaction (Modal fade, layout) completes
      const handle = InteractionManager.runAfterInteractions(() => {
        action();
      });
      return () => handle.cancel();
    }
  }, [menuOpen]);

  const handleLogout = useCallback(() => {
    closeMenu(() => {
      supabase.auth
        .signOut()
        .catch((e) => console.warn('[Supabase] signOut error:', e));
    });
  }, [closeMenu]);

  const handleThemeToggle = useCallback(() => {
    closeMenu(() => {
      toggleTheme();
    });
  }, [closeMenu, toggleTheme]);

  const handleMenuNavigate = useCallback(
    (routeName) => {
      closeMenu(() => {
        navigation.navigate(routeName);
      });
    },
    [closeMenu, navigation],
  );

  /* ── Drag-up gesture on centre button to reveal extra menu ── */
  const dragY = useRef(new Animated.Value(0)).current;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8,
        onPanResponderMove: (_, g) => {
          // Only track upward movement (negative dy)
          if (g.dy < 0) dragY.setValue(g.dy);
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy < -SWIPE_UP_THRESHOLD) {
            setMenuOpen(true);
          }
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            friction: 7,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            friction: 7,
          }).start();
        },
      }),
    [dragY],
  );

  return (
    <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
      {/* ── Pull-up extended bar (History / Profile / Dashboard / Dark Mode / Logout) ── */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => closeMenu()}
      >
        <TouchableOpacity
          style={{ flex: 1 }}
          activeOpacity={1}
          onPress={() => closeMenu()}
        >
          <Animated.View
            style={{
              position: 'absolute',
              left: 16,
              right: 16,
              bottom: 106,
              borderRadius: 28,
              paddingVertical: 8,
              paddingHorizontal: 8,
              backgroundColor: isDark ? 'rgba(2,8,23,0.93)' : 'rgba(255,255,255,0.97)',
              borderWidth: 1,
              borderColor: isDark ? 'rgba(14,165,233,0.22)' : '#e2e8f0',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 0.14,
              shadowRadius: 12,
              elevation: 12,
              opacity: menuAnim,
              transform: [
                {
                  translateY: menuAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [16, 0],
                  }),
                },
              ],
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* History */}
            <TouchableOpacity
              style={menuActionStyle}
              activeOpacity={0.8}
              onPress={() => handleMenuNavigate('History')}
            >
              <Feather name="clock" size={16} color={isDark ? '#e0f2fe' : '#334155'} />
              <Text style={menuActionLabelStyle(isDark)}>History</Text>
            </TouchableOpacity>

            {/* Profile */}
            <TouchableOpacity
              style={menuActionStyle}
              activeOpacity={0.8}
              onPress={() => handleMenuNavigate('Profile')}
            >
              <Feather name="user" size={16} color={isDark ? '#e0f2fe' : '#334155'} />
              <Text style={menuActionLabelStyle(isDark)}>Profile</Text>
            </TouchableOpacity>

            {/* Dashboard */}
            <TouchableOpacity
              style={menuActionStyle}
              activeOpacity={0.8}
              onPress={() => handleMenuNavigate('Home')}
            >
              <Feather name="grid" size={16} color={isDark ? '#e0f2fe' : '#334155'} />
              <Text style={menuActionLabelStyle(isDark)}>Dashboard</Text>
            </TouchableOpacity>

            {/* Dark mode (toggle) */}
            <TouchableOpacity
              style={menuActionStyle}
              activeOpacity={0.8}
              onPress={handleThemeToggle}
            >
              <Feather
                name={isDark ? 'sun' : 'moon'}
                size={16}
                color={isDark ? '#e0f2fe' : '#334155'}
              />
              <Text style={menuActionLabelStyle(isDark)}>Dark mode</Text>
            </TouchableOpacity>

            {/* Logout */}
            <TouchableOpacity
              style={menuActionStyle}
              activeOpacity={0.8}
              onPress={handleLogout}
            >
              <Feather
                name="log-out"
                size={16}
                color={isDark ? '#fca5a5' : '#dc2626'}
              />
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '700',
                  color: isDark ? '#fca5a5' : '#dc2626',
                }}
              >
                Logout
              </Text>
            </TouchableOpacity>
            </View>
          </Animated.View>
        </TouchableOpacity>
      </Modal>

      {/* ── Floating tab bar ── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-around',
          marginHorizontal: 16,
          marginBottom: 20,
          paddingVertical: 6,
          paddingHorizontal: 4,
          borderRadius: 28,
          backgroundColor: isDark ? 'rgba(2,8,23,0.93)' : 'rgba(255,255,255,0.97)',
          borderWidth: 1,
          borderColor: isDark ? 'rgba(14,165,233,0.22)' : '#e2e8f0',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 0.14,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        {VISIBLE_TABS.map((tab) => {
          const routeIndex = state.routes.findIndex((r) => r.name === tab.name);
          const isFocused = state.index === routeIndex;

          /* ── Centre "Ask AI" button — drag up to reveal extra menu ── */
          if (tab.isCenter) {
            return (
              <Animated.View
                key={tab.name}
                style={{
                  alignItems: 'center',
                  marginTop: -16,
                  transform: [
                    {
                      translateY: dragY.interpolate({
                        inputRange: [-60, 0],
                        outputRange: [-10, 0],
                        extrapolate: 'clamp',
                      }),
                    },
                  ],
                }}
                {...panResponder.panHandlers}
              >
                {/* Drag-handle bar (visual hint) */}
                <View
                  style={{
                    width: 28,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: isDark ? 'rgba(103,232,249,0.45)' : 'rgba(8,145,178,0.35)',
                    marginBottom: 4,
                  }}
                />

                <TouchableOpacity
                  activeOpacity={0.88}
                  style={{
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingVertical: 8,
                    paddingHorizontal: 18,
                    borderRadius: 22,
                    backgroundColor: '#22d3ee',
                    shadowColor: '#22d3ee',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.4,
                    shadowRadius: 8,
                    elevation: 5,
                  }}
                  onPress={() => {
                    navigation.navigate(tab.name, { openChatSignal: Date.now() });
                  }}
                >
                  <MaterialCommunityIcons
                    name={tab.icon}
                    size={20}
                    color="#0c4a6e"
                  />
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: '800',
                      color: '#0c4a6e',
                      marginTop: 2,
                    }}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            );
          }

          /* ── Normal tab button (icon on top, label below) ── */
          const color = isFocused
            ? isDark
              ? '#38bdf8'
              : '#0284c7'
            : isDark
              ? '#64748b'
              : '#94a3b8';

          const IconComponent =
            tab.iconLib === 'MCI' ? MaterialCommunityIcons : Feather;

          return (
            <TouchableOpacity
              key={tab.name}
              activeOpacity={0.82}
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 6,
                paddingHorizontal: 6,
                flex: 1,
              }}
              onPress={() => {
                if (!isFocused) navigation.navigate(tab.name);
              }}
            >
              <IconComponent name={tab.icon} size={20} color={color} />
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: isFocused ? '700' : '500',
                  color,
                  marginTop: 3,
                }}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

/* ── Shared pull-up action styles ── */
const menuActionStyle = {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  paddingVertical: 8,
  gap: 5,
  borderRadius: 12,
};

const menuActionLabelStyle = (isDark) => ({
  fontSize: 10,
  fontWeight: '700',
  color: isDark ? '#e0f2fe' : '#334155',
});

export default BottomTabBar;
