import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Animated,
  ScrollView,
  TextInput,
  Dimensions,
} from 'react-native';
import LottieView from 'lottie-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import PredictButton from '../components/PredictButton';
import { supabase } from '../utils/supabaseClient';
import { useAppTheme } from '../utils/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Icon-prefixed input with optional eye-toggle ────────────────────────────
const IconInput = ({ icon, label, secure, value, onChangeText, placeholder, keyboardType, autoCapitalize, isDark }) => {
  const [visible, setVisible] = useState(false);
  const focusAnim = useRef(new Animated.Value(0)).current;

  const onFocus = () =>
    Animated.timing(focusAnim, { toValue: 1, duration: 180, useNativeDriver: false }).start();
  const onBlur = () =>
    Animated.timing(focusAnim, { toValue: 0, duration: 180, useNativeDriver: false }).start();

  const borderColor = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isDark ? ['rgba(30,58,138,0.55)', 'rgba(56,189,248,0.9)'] : ['#cbd5e1', '#38bdf8'],
  });

  return (
    <View className="w-full">
      {label ? (
        <Text className={`mb-1.5 text-[12px] font-semibold tracking-wide uppercase ${isDark ? 'text-sky-400/80' : 'text-slate-500'}`}>
          {label}
        </Text>
      ) : null}
      <Animated.View
        style={{ borderColor, borderWidth: 1.5, borderRadius: 16 }}
        className={`flex-row items-center px-3.5 ${isDark ? 'bg-sky-950/20' : 'bg-slate-50'}`}
      >
        <MaterialCommunityIcons
          name={icon}
          size={18}
          color={isDark ? '#38bdf8' : '#64748b'}
          style={{ marginRight: 10 }}
        />
        <TextInput
          className={`flex-1 py-3 text-[14px] ${isDark ? 'text-slate-100' : 'text-slate-800'}`}
          placeholder={placeholder}
          placeholderTextColor={isDark ? '#334155' : '#94a3b8'}
          secureTextEntry={secure && !visible}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize || 'none'}
          onFocus={onFocus}
          onBlur={onBlur}
          autoCorrect={false}
        />
        {secure ? (
          <TouchableOpacity onPress={() => setVisible((v) => !v)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialCommunityIcons
              name={visible ? 'eye-off-outline' : 'eye-outline'}
              size={18}
              color={isDark ? '#475569' : '#94a3b8'}
            />
          </TouchableOpacity>
        ) : null}
      </Animated.View>
    </View>
  );
};

// ─── Animated feedback banner (error / notice) ───────────────────────────────
const FeedbackBanner = ({ error, notice, isDark }) => {
  const slideAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const msg = error || notice;
  const isError = !!error;

  useEffect(() => {
    if (msg) {
      slideAnim.setValue(-6);
      opacityAnim.setValue(0);
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, damping: 16, stiffness: 200 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.timing(opacityAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    }
  }, [msg]);

  if (!msg) return null;

  return (
    <Animated.View
      style={{ opacity: opacityAnim, transform: [{ translateY: slideAnim }] }}
      className={`mt-3 flex-row items-start gap-2.5 rounded-2xl px-3.5 py-3 ${
        isError
          ? isDark ? 'bg-red-950/60 border border-red-800/50' : 'bg-red-50 border border-red-200'
          : isDark ? 'bg-emerald-950/60 border border-emerald-800/50' : 'bg-emerald-50 border border-emerald-200'
      }`}
    >
      <MaterialCommunityIcons
        name={isError ? 'alert-circle-outline' : 'check-circle-outline'}
        size={16}
        color={isError ? (isDark ? '#f87171' : '#ef4444') : (isDark ? '#34d399' : '#10b981')}
        style={{ marginTop: 1 }}
      />
      <Text className={`flex-1 text-[12.5px] leading-[18px] ${isError ? (isDark ? 'text-red-300' : 'text-red-700') : (isDark ? 'text-emerald-300' : 'text-emerald-700')}`}>
        {msg}
      </Text>
    </Animated.View>
  );
};

// ─── Trust badge row ──────────────────────────────────────────────────────────
const TrustBadge = ({ icon, label, isDark }) => (
  <View className="items-center gap-1">
    <View className={`h-9 w-9 items-center justify-center rounded-full ${isDark ? 'bg-sky-900/40' : 'bg-sky-100'}`}>
      <MaterialCommunityIcons name={icon} size={16} color={isDark ? '#7dd3fc' : '#0369a1'} />
    </View>
    <Text className={`text-[10px] font-medium text-center ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{label}</Text>
  </View>
);

// ─── Main screen ─────────────────────────────────────────────────────────────
const LoginScreen = ({ onLoginSuccess }) => {
  const { isDark } = useAppTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [canResend, setCanResend] = useState(false);
  const [resending, setResending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('login'); // 'login' | 'register'

  // Entrance animations
  const heroAnim = useRef(new Animated.Value(0)).current;
  const card1Anim = useRef(new Animated.Value(0)).current;
  const card2Anim = useRef(new Animated.Value(0)).current;
  const badgeAnim = useRef(new Animated.Value(0)).current;

  // Tab slider
  const tabSlide = useRef(new Animated.Value(0)).current;
  const TAB_W = (SCREEN_WIDTH - 40 - 32 - 8) / 2; // screen - px - card padding - gap

  useEffect(() => {
    Animated.stagger(80, [
      Animated.spring(heroAnim, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 120 }),
      Animated.spring(card1Anim, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 120 }),
      Animated.spring(card2Anim, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 120 }),
      Animated.spring(badgeAnim, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 120 }),
    ]).start();
  }, []);

  const animBlock = (anim, delay = 0) => ({
    opacity: anim,
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
  });

  // ── handlers ──────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    setError('');
    setNotice('');
    setCanResend(false);

    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      setError('Please enter both email and password.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (trimmedPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password: trimmedPassword,
      });

      if (signInError) {
        const msg = (signInError.message || '').toLowerCase();
        if (msg.includes('invalid login credentials')) {
          setError('Invalid email or password.');
        } else if (msg.includes('email not confirmed') || msg.includes('confirm your email')) {
          setError('Your email is not verified yet. You can resend the confirmation email below.');
          setCanResend(true);
        } else {
          setError(signInError.message || 'Unable to sign in. Please try again.');
        }
        return;
      }

      setError('');
      setCanResend(false);
      if (onLoginSuccess) onLoginSuccess();
    } catch (e) {
      setError('Unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setError('');
    setNotice('');
    setCanResend(false);

    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword || !confirmPassword.trim()) {
      setError('Please fill in all fields.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (trimmedPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (trimmedPassword !== confirmPassword.trim()) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password: trimmedPassword,
      });

      if (signUpError) {
        const msg = (signUpError.message || '').toLowerCase();
        if (msg.includes('user already registered') || msg.includes('already registered')) {
          setError('An account with this email already exists. Try signing in instead.');
        } else {
          setError(signUpError.message || 'Unable to register. Please try again.');
        }
        return;
      }

      if (!data.session) {
        setNotice('Check your inbox — a verification link has been sent.');
        setCanResend(true);
        return;
      }

      setError('');
      if (onLoginSuccess) onLoginSuccess();
    } catch (e) {
      setError('Unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = useCallback((nextMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setError('');
    setNotice('');
    setCanResend(false);
    setPassword('');
    setConfirmPassword('');
    Animated.spring(tabSlide, {
      toValue: nextMode === 'login' ? 0 : 1,
      useNativeDriver: true,
      damping: 20,
      stiffness: 200,
    }).start();
  }, [mode, tabSlide]);

  const handleResend = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) { setError('Please enter your email first.'); setNotice(''); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) { setError('Please enter a valid email.'); setNotice(''); return; }

    setError('');
    setNotice('');
    setResending(true);
    try {
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: trimmedEmail });
      if (resendError) {
        setError(resendError.message || 'Unable to resend email.');
      } else {
        setNotice('Email sent. Check your inbox to verify your account.');
      }
    } catch (e) {
      setError('Unexpected error occurred. Please try again.');
    } finally {
      setResending(false);
    }
  };

  // ── derived ───────────────────────────────────────────────────────────────
  const isLogin = mode === 'login';
  const sliderX = tabSlide.interpolate({ inputRange: [0, 1], outputRange: [0, TAB_W + 4] });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: isDark ? '#06101a' : '#f1f5f9' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        className="flex-1 px-5"
        contentContainerStyle={{ paddingTop: 52, paddingBottom: 40, gap: 16 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero card ── */}
        <Animated.View style={animBlock(heroAnim)}>
          <View
            className={`rounded-[28px] px-5 pt-5 pb-4 border ${
              isDark
                ? 'bg-transparent border-sky-900/50'
                : 'bg-white border-slate-200'
            }`}
            style={{ shadowColor: '#94a3b8', shadowOpacity: isDark ? 0 : 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: 6 }, elevation: isDark ? 0 : 4 }}
          >
            <View className="items-center">
              {/* Avatar ring */}
              <View className={`h-[80px] w-[80px] items-center justify-center rounded-full border-2 ${isDark ? 'border-sky-700/50' : 'border-sky-200 bg-sky-50'}`}>
                <LottieView source={require('../assets/public/AI.json')} autoPlay loop style={{ width: 90, height: 90 }} />
              </View>

              {/* Pill badge */}
              <View className={`mt-3 flex-row items-center gap-1.5 rounded-full px-3 py-0.5 ${isDark ? 'bg-sky-900/30 border border-sky-800/40' : 'bg-sky-100 border border-sky-200'}`}>
                <View className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <Text className={`text-[10.5px] font-semibold tracking-wide ${isDark ? 'text-sky-300' : 'text-sky-700'}`}>
                  AquaScope
                </Text>
              </View>

              <Text className={`mt-2.5 text-[15px] font-bold text-center tracking-tight ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>
                Edge intelligence for water labs
              </Text>
              <Text className={`mt-1.5 px-3 text-center text-[12.5px] leading-[18px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Physicochemical capture, forecasting &amp; disease-risk prediction.
              </Text>
            </View>

            {/* Trust badges */}
            <Animated.View style={[animBlock(badgeAnim), { marginTop: 16, flexDirection: 'row', justifyContent: 'space-around' }]}>
              <TrustBadge icon="shield-check-outline" label={'End-to-end\nencrypted'} isDark={isDark} />
              <View className={`w-px ${isDark ? 'bg-sky-900/50' : 'bg-slate-200'}`} />
              <TrustBadge icon="molecule" label={'AI-backed\ndiagnostics'} isDark={isDark} />
              <View className={`w-px ${isDark ? 'bg-sky-900/50' : 'bg-slate-200'}`} />
              <TrustBadge icon="chart-line" label={'Real-time\nforecasting'} isDark={isDark} />
            </Animated.View>
          </View>
        </Animated.View>

        {/* ── Auth card ── */}
        <Animated.View style={animBlock(card1Anim)}>
          <View
            className={`rounded-[32px] p-6 border ${
              isDark
                ? 'bg-transparent border-sky-900/50'
                : 'bg-white border-slate-200'
            }`}
            style={{ shadowColor: '#94a3b8', shadowOpacity: isDark ? 0 : 0.14, shadowRadius: 20, shadowOffset: { width: 0, height: 6 }, elevation: isDark ? 0 : 4 }}
          >
            {/* Mode heading */}
            <View className="items-center mb-5">
              <Animated.View
                style={{
                  opacity: tabSlide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                  transform: [{ translateY: tabSlide.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }],
                  position: isLogin ? 'relative' : 'absolute',
                }}
                pointerEvents={isLogin ? 'auto' : 'none'}
              >
                <Text className={`text-[16px] font-bold text-center ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>
                  Welcome back
                </Text>
                <Text className={`mt-1 text-[13px] text-center ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Sign in to resume your workspace.
                </Text>
              </Animated.View>

              <Animated.View
                style={{
                  opacity: tabSlide.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
                  transform: [{ translateY: tabSlide.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
                  position: isLogin ? 'absolute' : 'relative',
                }}
                pointerEvents={isLogin ? 'none' : 'auto'}
              >
                <Text className={`text-[16px] font-bold text-center ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>
                  Create an account
                </Text>
                <Text className={`mt-1 text-[13px] text-center ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Secure access to predictions &amp; capture cards.
                </Text>
              </Animated.View>
            </View>

            {/* ── Tab toggle with sliding pill ── */}
            <View
              className={`relative flex-row items-center rounded-2xl p-1 mb-6 ${isDark ? 'bg-sky-950/30 border border-sky-900/30' : 'bg-slate-100'}`}
            >
              {/* Sliding pill */}
              <Animated.View
                style={{
                  position: 'absolute',
                  left: 4,
                  width: TAB_W,
                  top: 4,
                  bottom: 4,
                  borderRadius: 12,
                  backgroundColor: isDark ? '#0c4a6e' : '#bfdbfe',
                  transform: [{ translateX: sliderX }],
                  shadowColor: '#0ea5e9',
                  shadowOpacity: isDark ? 0.3 : 0.2,
                  shadowRadius: 6,
                  elevation: 2,
                }}
              />
              <TouchableOpacity
                style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 1 }}
                activeOpacity={0.9}
                onPress={() => switchMode('login')}
              >
                <View className="flex-row items-center gap-1.5">
                  <MaterialCommunityIcons
                    name="login-variant"
                    size={14}
                    color={isLogin ? (isDark ? '#7dd3fc' : '#1d4ed8') : (isDark ? '#475569' : '#94a3b8')}
                  />
                  <Animated.Text
                    style={{
                      fontSize: 13,
                      fontWeight: '600',
                      color: isDark
                        ? tabSlide.interpolate({ inputRange: [0, 1], outputRange: ['#7dd3fc', '#475569'] })
                        : tabSlide.interpolate({ inputRange: [0, 1], outputRange: ['#1d4ed8', '#94a3b8'] }),
                    }}
                  >
                    Sign in
                  </Animated.Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, alignItems: 'center', paddingVertical: 8, zIndex: 1 }}
                activeOpacity={0.9}
                onPress={() => switchMode('register')}
              >
                <View className="flex-row items-center gap-1.5">
                  <MaterialCommunityIcons
                    name="account-plus-outline"
                    size={14}
                    color={!isLogin ? (isDark ? '#7dd3fc' : '#1d4ed8') : (isDark ? '#475569' : '#94a3b8')}
                  />
                  <Animated.Text
                    style={{
                      fontSize: 13,
                      fontWeight: '600',
                      color: isDark
                        ? tabSlide.interpolate({ inputRange: [0, 1], outputRange: ['#475569', '#7dd3fc'] })
                        : tabSlide.interpolate({ inputRange: [0, 1], outputRange: ['#94a3b8', '#1d4ed8'] }),
                    }}
                  >
                    Register
                  </Animated.Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* ── Inputs ── */}
            <IconInput
              icon="email-outline"
              label="Email address"
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              isDark={isDark}
            />

            <View className="h-3" />

            <IconInput
              icon="lock-outline"
              label="Password"
              placeholder="Enter password"
              secure
              value={password}
              onChangeText={setPassword}
              isDark={isDark}
            />

            {mode === 'register' && (
              <>
                <View className="h-3" />
                <IconInput
                  icon="lock-check-outline"
                  label="Confirm password"
                  placeholder="Re-enter password"
                  secure
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  isDark={isDark}
                />
              </>
            )}

            {/* Feedback banner */}
            <FeedbackBanner error={error} notice={notice} isDark={isDark} />

            {/* Resend link */}
            {canResend && (
              <TouchableOpacity
                className="mt-3 flex-row items-center gap-1.5 self-start"
                activeOpacity={0.75}
                onPress={handleResend}
                disabled={resending}
              >
                <MaterialCommunityIcons
                  name="email-sync-outline"
                  size={14}
                  color={resending ? (isDark ? '#334155' : '#94a3b8') : '#38bdf8'}
                />
                <Text className={`text-[12px] font-semibold ${resending ? (isDark ? 'text-slate-600' : 'text-slate-400') : 'text-sky-400'}`}>
                  {resending ? 'Sending…' : 'Resend confirmation email'}
                </Text>
              </TouchableOpacity>
            )}

            <View className="h-5" />

            {/* CTA button */}
            <PredictButton
              title={
                isLogin
                  ? loading ? 'Signing in…' : 'Continue'
                  : loading ? 'Creating account…' : 'Create account'
              }
              icon={loading ? 'loading' : isLogin ? 'arrow-right' : 'account-check-outline'}
              iconRight
              onPress={isLogin ? handleLogin : handleRegister}
              disabled={loading}
            />
          </View>
        </Animated.View>

        {/* ── Help card ── */}
        <Animated.View style={animBlock(card2Anim)}>
          <View
            className={`rounded-[24px] px-4 py-4 border flex-row items-center gap-3 ${
              isDark ? 'bg-transparent border-sky-900/40' : 'bg-white border-slate-200'
            }`}
          >
            <View className={`h-11 w-11 items-center justify-center rounded-2xl ${isDark ? 'bg-sky-900/40' : 'bg-sky-100'}`}>
              <MaterialCommunityIcons name="account-key-outline" size={22} color={isDark ? '#7dd3fc' : '#0369a1'} />
            </View>
            <View className="flex-1">
              <Text className={`text-[13px] font-semibold ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>
                Need access?
              </Text>
              <Text className={`mt-0.5 text-[11.5px] leading-[17px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Contact your lab administrator to enable secure sign-in for your workspace.
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={18} color={isDark ? '#334155' : '#cbd5e1'} />
          </View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default LoginScreen;
