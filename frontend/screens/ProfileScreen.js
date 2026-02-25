import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Animated,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { useFocusEffect } from '@react-navigation/native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import InputField from '../components/InputField';
import PredictButton from '../components/PredictButton';
import { supabase } from '../utils/supabaseClient';
import { useAppTheme } from '../utils/theme';

const SUPABASE_PROFILES_TABLE = process.env.EXPO_PUBLIC_SUPABASE_PROFILES_TABLE || 'profiles';
const SUPABASE_AVATAR_BUCKET = process.env.EXPO_PUBLIC_SUPABASE_AVATAR_BUCKET || 'avatars';

const getExtensionFromMimeType = (mimeType) => {
  if (!mimeType || typeof mimeType !== 'string') return 'jpg';
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('heic')) return 'heic';
  if (normalized.includes('heif')) return 'heif';
  return 'jpg';
};

const getAvatarPathFromUrl = (url) => {
  if (!url) return '';
  const marker = `/${SUPABASE_AVATAR_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return '';
  return url.slice(index + marker.length);
};

const ProfileScreen = ({ onNavigate }) => {
  const { isDark } = useAppTheme();
  const [profile, setProfile] = useState({
    name: '',
    email: '',
    organization: '',
    avatarUrl: '',
  });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const screenAnim = useRef(new Animated.Value(0)).current;

  const handleChange = (key, value) => {
    setProfile((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setStatus('');
    setLoading(true);
    try {
      const sessionResult = await supabase.auth.getSession();
      const user = sessionResult?.data?.session?.user || null;
      if (!user) {
        setStatus('Please sign in to update your profile.');
        return;
      }

      const updates = {
        id: user.id,
        display_name: profile.name || null,
        organization: profile.organization || null,
        avatar_url: profile.avatarUrl || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .upsert(updates, { onConflict: 'id' });

      if (error) {
        console.warn('[Supabase] profile update failed:', error.message || error);
        setStatus('Unable to save profile right now.');
        return;
      }

      setStatus('Profile saved.');
    } catch (error) {
      console.warn('[Supabase] profile update error:', error?.message || error);
      setStatus('Unable to save profile right now.');
    } finally {
      setLoading(false);
    }
  };

  const handlePickAvatar = async () => {
    setStatus('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setStatus('Media library permission is required to upload a photo.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const asset = result.assets[0];
      const sessionResult = await supabase.auth.getSession();
      const user = sessionResult?.data?.session?.user || null;
      if (!user) {
        setStatus('Please sign in to update your profile.');
        return;
      }

      setLoading(true);
      const previousPath = getAvatarPathFromUrl(profile.avatarUrl);
      const extension = getExtensionFromMimeType(asset.mimeType);
      const filePath = `${user.id}/${Date.now()}.${extension}`;
      const base64Data = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType?.Base64 || 'base64',
      });
      const fileBody = decode(base64Data);
      const contentType = asset.mimeType || 'image/jpeg';

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_AVATAR_BUCKET)
        .upload(filePath, fileBody, {
          contentType,
        });

      if (uploadError) {
        console.warn('[Supabase] avatar upload failed:', {
          message: uploadError.message || uploadError,
          statusCode: uploadError.statusCode,
          error: uploadError,
          bucket: SUPABASE_AVATAR_BUCKET,
          filePath,
          contentType,
          userId: user.id,
        });
        setStatus('Unable to upload avatar.');
        return;
      }

      const { data: publicData } = supabase.storage
        .from(SUPABASE_AVATAR_BUCKET)
        .getPublicUrl(filePath);
      const avatarUrl = publicData?.publicUrl || '';

      if (previousPath && previousPath !== filePath) {
        const { error: removeError } = await supabase.storage
          .from(SUPABASE_AVATAR_BUCKET)
          .remove([previousPath]);
        if (removeError) {
          console.warn('[Supabase] previous avatar remove failed:', {
            message: removeError.message || removeError,
            statusCode: removeError.statusCode,
            path: previousPath,
          });
        }
      }

      setProfile((prev) => ({ ...prev, avatarUrl }));
      setStatus('Photo updated. Tap Save changes to confirm.');
    } catch (error) {
      console.warn('[Supabase] avatar upload error:', error?.message || error);
      setStatus('Unable to upload avatar.');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setStatus('');
    setLoading(true);
    try {
      const sessionResult = await supabase.auth.getSession();
      const user = sessionResult?.data?.session?.user || null;
      if (!user) {
        setStatus('Please sign in to update your profile.');
        return;
      }

      const storedPath = getAvatarPathFromUrl(profile.avatarUrl) || `${user.id}.jpg`;
      await supabase.storage.from(SUPABASE_AVATAR_BUCKET).remove([storedPath]);

      const updates = {
        id: user.id,
        avatar_url: null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .upsert(updates, { onConflict: 'id' });

      if (error) {
        console.warn('[Supabase] profile update failed:', error.message || error);
        setStatus('Unable to remove avatar right now.');
        return;
      }

      setProfile((prev) => ({ ...prev, avatarUrl: '' }));
      setStatus('Photo removed.');
    } catch (error) {
      console.warn('[Supabase] avatar remove error:', error?.message || error);
      setStatus('Unable to remove avatar right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      setLoading(true);
      try {
        const sessionResult = await supabase.auth.getSession();
        const user = sessionResult?.data?.session?.user || null;
        if (!user) {
          if (isMounted) {
            setProfile({ name: '', email: '', organization: '', avatarUrl: '' });
          }
          return;
        }

        const { data, error } = await supabase
          .from(SUPABASE_PROFILES_TABLE)
          .select('display_name, organization, avatar_url')
          .eq('id', user.id)
          .single();

        if (error && error.code !== 'PGRST116') {
          console.warn('[Supabase] profile fetch failed:', error.message || error);
        }

        if (isMounted) {
          setProfile({
            name: data?.display_name || '',
            email: user.email || '',
            organization: data?.organization || '',
            avatarUrl: data?.avatar_url || '',
          });
        }
      } catch (error) {
        console.warn('[Supabase] profile fetch error:', error?.message || error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      screenAnim.setValue(0);
      const animation = Animated.timing(screenAnim, {
        toValue: 1,
        duration: 320,
        delay: 0,
        useNativeDriver: true,
      });
      animation.start();

      return () => {
        animation.stop();
      };
    }, [screenAnim])
  );

  return (
    <Animated.View
      style={{
        flex: 1,
        backgroundColor: isDark ? '#020617' : '#f1f5f9',
        opacity: screenAnim,
        transform: [
          {
            translateY: screenAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [18, 0],
            }),
          },
        ],
      }}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* ── Top navigation bar ── */}
        <View className="flex-row items-center justify-between px-5 pt-10 pb-2">
          <TouchableOpacity
            activeOpacity={0.8}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              borderRadius: 999,
              borderWidth: 1,
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderColor: isDark ? 'rgba(14,165,233,0.3)' : '#cbd5e1',
              backgroundColor: isDark ? 'rgba(14,165,233,0.08)' : '#f1f5f9',
            }}
            onPress={() => onNavigate && onNavigate('home')}
          >
            <Feather name="arrow-left" size={13} color={isDark ? '#7dd3fc' : '#475569'} />
            <Text style={{ fontSize: 12, fontWeight: '500', color: isDark ? '#bae6fd' : '#334155' }}>
              Dashboard
            </Text>
          </TouchableOpacity>

          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            borderRadius: 999,
            borderWidth: 1,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderColor: isDark ? 'rgba(51,65,85,0.6)' : '#cbd5e1',
            backgroundColor: isDark ? 'rgba(2,6,23,0.6)' : '#f8fafc',
          }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' }} />
            <Text style={{ fontSize: 10, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', color: isDark ? '#94a3b8' : '#64748b' }}>
              Ops Live
            </Text>
          </View>
        </View>

        {/* ── Hero avatar section ── */}
        <View style={{ alignItems: 'center', paddingTop: 20, paddingBottom: 16 }}>
          {/* Avatar circle with camera overlay */}
          <View style={{ position: 'relative', marginBottom: 12 }}>
            <View style={{
              width: 96,
              height: 96,
              borderRadius: 48,
              overflow: 'hidden',
              borderWidth: 3,
              borderColor: isDark ? '#0369a1' : '#bae6fd',
              backgroundColor: isDark ? '#0c1a2e' : '#dbeafe',
            }}>
              {profile.avatarUrl ? (
                <Image
                  source={{ uri: profile.avatarUrl }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons
                    name="account"
                    size={52}
                    color={isDark ? '#38bdf8' : '#93c5fd'}
                  />
                </View>
              )}
            </View>

            {/* Camera edit button */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handlePickAvatar}
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isDark ? '#0284c7' : '#0ea5e9',
                borderWidth: 2,
                borderColor: isDark ? '#020617' : '#f1f5f9',
              }}
            >
              <Feather name="camera" size={14} color="#ffffff" />
            </TouchableOpacity>

            {/* Remove avatar button (only when avatar exists) */}
            {profile.avatarUrl ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleRemoveAvatar}
                style={{
                  position: 'absolute',
                  top: 0,
                  right: -2,
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isDark ? '#be123c' : '#f43f5e',
                  borderWidth: 2,
                  borderColor: isDark ? '#020617' : '#f1f5f9',
                }}
              >
                <Feather name="x" size={11} color="#ffffff" />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Name + email under avatar */}
          <Text style={{ fontSize: 18, fontWeight: '700', color: isDark ? '#e0f2fe' : '#0f172a', marginBottom: 2 }}>
            {profile.name || 'Analyst profile'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Feather name="mail" size={11} color={isDark ? '#64748b' : '#94a3b8'} />
            <Text style={{ fontSize: 12, color: isDark ? '#64748b' : '#94a3b8' }}>
              {profile.email || 'Not signed in'}
            </Text>
          </View>
        </View>

        <ScrollView
          className="px-5"
          contentContainerStyle={{ paddingBottom: 112, gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Account details card ── */}
          <View style={{
            borderRadius: 20,
            borderWidth: 1,
            padding: 16,
            borderColor: isDark ? 'rgba(14,165,233,0.2)' : '#e2e8f0',
            backgroundColor: isDark ? 'rgba(2,15,40,0.6)' : '#ffffff',
          }}>
            {/* Card header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <View style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isDark ? 'rgba(14,165,233,0.15)' : '#e0f2fe',
              }}>
                <Feather name="user" size={13} color={isDark ? '#38bdf8' : '#0284c7'} />
              </View>
              <Text style={{ fontSize: 13, fontWeight: '600', color: isDark ? '#7dd3fc' : '#0284c7' }}>
                Account details
              </Text>
            </View>
            <Text style={{ fontSize: 11, color: isDark ? '#475569' : '#94a3b8', marginBottom: 14 }}>
              Used across reports, exports and shared views.
            </Text>

            {/* Display name field */}
            <View style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <Feather name="user" size={12} color={isDark ? '#475569' : '#94a3b8'} />
                <Text style={{ fontSize: 11, fontWeight: '500', color: isDark ? '#94a3b8' : '#64748b' }}>
                  Display name
                </Text>
              </View>
              <InputField
                value={profile.name}
                onChangeText={(v) => handleChange('name', v)}
                placeholder="e.g. Lake operations team"
              />
            </View>

            {/* Email field */}
            <View style={{ marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <Feather name="mail" size={12} color={isDark ? '#475569' : '#94a3b8'} />
                <Text style={{ fontSize: 11, fontWeight: '500', color: isDark ? '#94a3b8' : '#64748b' }}>
                  Email
                </Text>
                <View style={{
                  borderRadius: 4,
                  paddingHorizontal: 5,
                  paddingVertical: 1,
                  backgroundColor: isDark ? 'rgba(51,65,85,0.6)' : '#f1f5f9',
                }}>
                  <Text style={{ fontSize: 9, color: isDark ? '#64748b' : '#94a3b8' }}>read-only</Text>
                </View>
              </View>
              <InputField
                value={profile.email}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={false}
                onChangeText={(v) => handleChange('email', v)}
                placeholder="you@example.com"
              />
            </View>

            {/* Organization field */}
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <Feather name="briefcase" size={12} color={isDark ? '#475569' : '#94a3b8'} />
                <Text style={{ fontSize: 11, fontWeight: '500', color: isDark ? '#94a3b8' : '#64748b' }}>
                  Organization / lab
                </Text>
              </View>
              <InputField
                value={profile.organization}
                onChangeText={(v) => handleChange('organization', v)}
                placeholder="e.g. City water laboratory"
              />
            </View>

            {/* Save button + status */}
            <PredictButton title={loading ? 'Saving…' : 'Save changes'} onPress={handleSave} />
            {status ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 }}>
                <Feather
                  name={status.toLowerCase().includes('unable') ? 'alert-circle' : 'check-circle'}
                  size={11}
                  color={status.toLowerCase().includes('unable')
                    ? (isDark ? '#fca5a5' : '#dc2626')
                    : (isDark ? '#4ade80' : '#16a34a')}
                />
                <Text style={{ fontSize: 11, color: status.toLowerCase().includes('unable') ? (isDark ? '#fca5a5' : '#dc2626') : (isDark ? '#4ade80' : '#16a34a') }}>
                  {status}
                </Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 }}>
                <Feather name="cloud" size={11} color={isDark ? '#334155' : '#94a3b8'} />
                <Text style={{ fontSize: 11, color: isDark ? '#334155' : '#94a3b8' }}>
                  Changes sync to Supabase when saved.
                </Text>
              </View>
            )}
          </View>

          {/* ── My data summary card ── */}
          <View style={{
            borderRadius: 20,
            borderWidth: 1,
            padding: 16,
            borderColor: isDark ? 'rgba(14,165,233,0.2)' : '#e2e8f0',
            backgroundColor: isDark ? 'rgba(2,15,40,0.6)' : '#ffffff',
          }}>
            {/* Card header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <View style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isDark ? 'rgba(14,165,233,0.15)' : '#e0f2fe',
              }}>
                <Feather name="bar-chart-2" size={13} color={isDark ? '#38bdf8' : '#0284c7'} />
              </View>
              <Text style={{ fontSize: 13, fontWeight: '600', color: isDark ? '#7dd3fc' : '#0284c7' }}>
                My data
              </Text>
            </View>
            <Text style={{ fontSize: 11, color: isDark ? '#475569' : '#94a3b8', marginBottom: 14 }}>
              Quick snapshot of your recent system activity.
            </Text>

            {/* Stat rows */}
            {[
              {
                icon: 'droplet',
                label: 'Samples logged',
                sub: 'Physicochemical entries — last 7 days',
                value: '24',
                accent: false,
              },
              {
                icon: 'aperture',
                label: 'Container analyses',
                sub: 'Imaging-based container checks run',
                value: '9',
                accent: false,
              },
              {
                icon: 'alert-triangle',
                label: 'Alerts reviewed',
                sub: 'Flagged runs inspected from history',
                value: '3',
                accent: true,
              },
            ].map((item, idx) => (
              <View
                key={idx}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingVertical: 10,
                  borderTopWidth: idx === 0 ? 0 : 1,
                  borderTopColor: isDark ? 'rgba(30,41,59,0.8)' : '#f1f5f9',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <View style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: item.accent
                      ? (isDark ? 'rgba(239,68,68,0.1)' : '#fee2e2')
                      : (isDark ? 'rgba(14,165,233,0.1)' : '#f0f9ff'),
                  }}>
                    <Feather
                      name={item.icon}
                      size={15}
                      color={item.accent ? (isDark ? '#fca5a5' : '#dc2626') : (isDark ? '#38bdf8' : '#0284c7')}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '500', color: isDark ? '#e0f2fe' : '#0f172a' }}>
                      {item.label}
                    </Text>
                    <Text style={{ fontSize: 10, color: isDark ? '#475569' : '#94a3b8', marginTop: 1 }}>
                      {item.sub}
                    </Text>
                  </View>
                </View>
                <View style={{
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  backgroundColor: item.accent
                    ? (isDark ? 'rgba(239,68,68,0.12)' : '#fee2e2')
                    : (isDark ? 'rgba(14,165,233,0.12)' : '#e0f2fe'),
                }}>
                  <Text style={{
                    fontSize: 13,
                    fontWeight: '700',
                    color: item.accent ? (isDark ? '#fca5a5' : '#dc2626') : (isDark ? '#38bdf8' : '#0284c7'),
                  }}>
                    {item.value}
                  </Text>
                </View>
              </View>
            ))}

            {/* Action row */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  borderRadius: 12,
                  borderWidth: 1,
                  paddingVertical: 10,
                  borderColor: isDark ? 'rgba(14,165,233,0.3)' : '#bae6fd',
                  backgroundColor: isDark ? 'rgba(14,165,233,0.06)' : '#f0f9ff',
                }}
                onPress={() => onNavigate && onNavigate('predictionHistory')}
              >
                <Feather name="clock" size={13} color={isDark ? '#38bdf8' : '#0284c7'} />
                <Text style={{ fontSize: 12, fontWeight: '500', color: isDark ? '#7dd3fc' : '#0284c7' }}>
                  Prediction history
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.85}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  borderRadius: 12,
                  borderWidth: 1,
                  paddingVertical: 10,
                  borderColor: isDark ? 'rgba(51,65,85,0.6)' : '#e2e8f0',
                  backgroundColor: isDark ? 'rgba(15,23,42,0.6)' : '#f8fafc',
                }}
                onPress={() => onNavigate && onNavigate('dataInput')}
              >
                <Feather name="plus-circle" size={13} color={isDark ? '#94a3b8' : '#475569'} />
                <Text style={{ fontSize: 12, fontWeight: '500', color: isDark ? '#94a3b8' : '#475569' }}>
                  New sample
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Animated.View>
  );
};

export default ProfileScreen;
