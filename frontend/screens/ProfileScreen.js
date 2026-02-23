import React, { useEffect, useRef, useState } from 'react';
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
import InputField from '../components/InputField';
import PredictButton from '../components/PredictButton';
import { supabase } from '../utils/supabaseClient';
import { useAppTheme } from '../utils/theme';

const SUPABASE_PROFILES_TABLE = process.env.EXPO_PUBLIC_SUPABASE_PROFILES_TABLE || 'profiles';
const SUPABASE_AVATAR_BUCKET = process.env.EXPO_PUBLIC_SUPABASE_AVATAR_BUCKET || 'avatars';

const getAvatarPathFromUrl = (url) => {
  if (!url) return '';
  const marker = `/${SUPABASE_AVATAR_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return '';
  return url.slice(index + marker.length);
};

const getInitials = (value) => {
  if (!value) return 'NA';
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'NA';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return `${first}${last}`.toUpperCase();
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
      const filePath = `${user.id}.jpg`;
      const base64Data = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType?.Base64 || 'base64',
      });
      const fileBody = decode(base64Data);
      const contentType = asset.mimeType || 'image/jpeg';

      // Remove existing file first to avoid upsert RLS conflicts
      await supabase.storage.from(SUPABASE_AVATAR_BUCKET).remove([filePath]);

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

  useEffect(() => {
    Animated.timing(screenAnim, {
      toValue: 1,
      duration: 450,
      delay: 50,
      useNativeDriver: true,
    }).start();
  }, [screenAnim]);

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
      <View className="px-5 pt-10 pb-3">
        <View className="mb-2 flex-row items-center justify-between">
          <TouchableOpacity
            activeOpacity={0.8}
            className={`rounded-full border px-3 py-1.5 ${isDark ? 'border-sky-900/70 bg-aquadark/80' : 'border-slate-300 bg-slate-100'}`}
            onPress={() => onNavigate && onNavigate('home')}
          >
            <Text className={`text-[12px] font-medium ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>⟵ Dashboard</Text>
          </TouchableOpacity>
          <View className={`rounded-full border px-3 py-1 ${isDark ? 'border-slate-800/70 bg-slate-950/70' : 'border-slate-300 bg-slate-100'}`}>
            <Text className={`text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
              Ops Live
            </Text>
          </View>
        </View>

        <View className="mt-1 flex-row items-center">
          <View className="mr-3 h-10 w-10 overflow-hidden rounded-full bg-sky-900/80">
            {profile.avatarUrl ? (
              <Image
                source={{ uri: profile.avatarUrl }}
                className="h-full w-full"
                resizeMode="cover"
              />
            ) : (
              <View className="h-full w-full items-center justify-center">
                <Text className={`text-[14px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-700'}`}>
                  {getInitials(profile.name || profile.email)}
                </Text>
              </View>
            )}
          </View>
          <View className="flex-1">
            <Text className={`text-[18px] font-semibold ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>
              {profile.name || 'Analyst profile'}
            </Text>
            <Text className={`mt-0.5 text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Profile, preferences and personal data footprint.
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        className="px-5"
        contentContainerClassName="pb-28 gap-4"
        showsVerticalScrollIndicator={false}
      >
        {/* Update account */}
        <View className={`mt-1 rounded-2xl border p-4 ${isDark ? 'border-sky-900/70 bg-sky-950/40' : 'border-slate-300 bg-sky-50'}`}>
          <Text className={`text-[11px] font-medium uppercase tracking-wide ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
            Account
          </Text>
          <Text className={`mt-1 text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Basic profile details used across reports and exports.
          </Text>

          <View className="mt-3">
            <InputField
              label="Display name"
              value={profile.name}
              onChangeText={(v) => handleChange('name', v)}
              placeholder="e.g. Lake operations team"
            />
          </View>
          <View className="mt-3">
            <InputField
              label="Email"
              value={profile.email}
              keyboardType="email-address"
              autoCapitalize="none"
              editable={false}
              onChangeText={(v) => handleChange('email', v)}
              placeholder="you@example.com"
            />
          </View>
          <View className="mt-3">
            <InputField
              label="Organization / lab"
              value={profile.organization}
              onChangeText={(v) => handleChange('organization', v)}
              placeholder="e.g. City water laboratory"
            />
          </View>

          <View className="mt-4">
            {profile.avatarUrl ? (
              <View className="mb-3">
                <View className={`h-24 w-24 overflow-hidden rounded-2xl border ${isDark ? 'border-sky-900/60 bg-slate-950/60' : 'border-slate-300 bg-slate-100'}`}>
                  <Image
                    source={{ uri: profile.avatarUrl }}
                    className="h-full w-full"
                    resizeMode="cover"
                  />
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={handleRemoveAvatar}
                    className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full border border-rose-500/50 bg-rose-500/20"
                  >
                    <Text className={`text-[12px] font-semibold ${isDark ? 'text-rose-100' : 'text-rose-600'}`}>X</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              <TouchableOpacity
                activeOpacity={0.85}
                className={`rounded-full border px-4 py-2 ${isDark ? 'border-sky-800 bg-slate-950/60' : 'border-slate-300 bg-slate-100'}`}
                onPress={handlePickAvatar}
              >
                <Text className={`text-[12px] font-semibold ${isDark ? 'text-sky-100' : 'text-slate-700'}`}>📷 Upload photo</Text>
              </TouchableOpacity>
            </View>
            <View className="mt-3">
              <PredictButton title={loading ? 'Saving...' : 'Save changes'} onPress={handleSave} />
              <Text className={`mt-2 text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
                {status || 'Changes sync to Supabase when saved.'}
              </Text>
            </View>
          </View>
        </View>

        {/* My data summary */}
        <View className={`rounded-2xl border p-4 ${isDark ? 'border-sky-900/80 bg-aquadark/80' : 'border-slate-300 bg-white'}`}>
          <Text className={`text-[11px] font-medium uppercase tracking-wide ${isDark ? 'text-sky-300' : 'text-sky-600'}`}>
            My data
          </Text>
          <Text className={`mt-1 text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
            Quick snapshot of how you have used the system recently.
          </Text>

          <View className="mt-3 gap-3">
            <View className="flex-row items-center justify-between">
              <View>
                <Text className={`text-[13px] ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>Samples logged</Text>
                <Text className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Physicochemical entries captured in the last week.
                </Text>
              </View>
              <View className={`rounded-full px-3 py-1 ${isDark ? 'bg-sky-900/80' : 'bg-sky-100'}`}>
                <Text className={`text-[12px] font-semibold ${isDark ? 'text-sky-50' : 'text-sky-700'}`}>24</Text>
              </View>
            </View>

            <View className="flex-row items-center justify-between">
              <View>
                <Text className={`text-[13px] ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>Container analyses</Text>
                <Text className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Imaging-based container checks you have run.
                </Text>
              </View>
              <View className={`rounded-full px-3 py-1 ${isDark ? 'bg-sky-900/80' : 'bg-sky-100'}`}>
                <Text className={`text-[12px] font-semibold ${isDark ? 'text-sky-50' : 'text-sky-700'}`}>9</Text>
              </View>
            </View>

            <View className="flex-row items-center justify-between">
              <View>
                <Text className={`text-[13px] ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>Alerts reviewed</Text>
                <Text className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Flagged runs you have inspected from history.
                </Text>
              </View>
              <View className={`rounded-full px-3 py-1 ${isDark ? 'bg-rose-500/10' : 'bg-rose-100'}`}>
                <Text className={`text-[12px] font-semibold ${isDark ? 'text-rose-200' : 'text-rose-600'}`}>3</Text>
              </View>
            </View>
          </View>

          <View className="mt-4 flex-row justify-between">
            <TouchableOpacity
              activeOpacity={0.85}
              className={`rounded-full border px-3 py-1.5 ${isDark ? 'border-aquaprimary/70 bg-aquaprimary/10' : 'border-sky-400 bg-sky-50'}`}
              onPress={() => onNavigate && onNavigate('predictionHistory')}
            >
              <Text className={`text-[11px] font-medium ${isDark ? 'text-sky-50' : 'text-sky-700'}`}>
                View prediction history
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.85}
              className={`rounded-full border px-3 py-1.5 ${isDark ? 'border-sky-800 bg-aquadark' : 'border-slate-300 bg-slate-100'}`}
              onPress={() => onNavigate && onNavigate('dataInput')}
            >
              <Text className={`text-[11px] font-medium ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>
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
