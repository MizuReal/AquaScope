import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import Filter from 'bad-words';
import LottieView from 'lottie-react-native';
import { useFocusEffect } from '@react-navigation/native';
import forumAnim from '../assets/public/forumanim.json';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../utils/supabaseClient';
import { useAppTheme } from '../utils/theme';
import ForumNotificationsModal from '../components/forum/ForumNotificationsModal';
import { useForumNotifications } from '../hooks/useForumNotifications';

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList);
const SUPABASE_PROFILES_TABLE = process.env.EXPO_PUBLIC_SUPABASE_PROFILES_TABLE || 'profiles';

// ── Category icon map (Ionicons names) ─────────────────────────────────────
const CATEGORY_ICONS = {
  all: 'globe-outline',
  mine: 'person-outline',
  general: 'chatbubble-outline',
  'water-quality': 'water-outline',
  water_quality: 'water-outline',
  waterquality: 'water-outline',
  water: 'water-outline',
  analysis: 'bar-chart-outline',
  bacteria: 'bug-outline',
  microbial: 'bug-outline',
  chemical: 'flask-outline',
  chemicals: 'flask-outline',
  treatment: 'construct-outline',
  field: 'leaf-outline',
  alert: 'warning-outline',
  alerts: 'warning-outline',
  safety: 'shield-outline',
  ph: 'flask-outline',
  contamination: 'nuclear-outline',
  regulations: 'clipboard-outline',
  tech: 'settings-outline',
  technology: 'settings-outline',
  news: 'newspaper-outline',
  research: 'search-outline',
  help: 'help-circle-outline',
  discussion: 'chatbubbles-outline',
  announcement: 'megaphone-outline',
  announcements: 'megaphone-outline',
  report: 'document-text-outline',
  reports: 'document-text-outline',
  tips: 'bulb-outline',
  community: 'people-outline',
};

const getCategoryIcon = (slug, label) => {
  const raw = (slug || label || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (CATEGORY_ICONS[slug?.toLowerCase()]) return CATEGORY_ICONS[slug.toLowerCase()];
  if (CATEGORY_ICONS[raw]) return CATEGORY_ICONS[raw];
  const key = Object.keys(CATEGORY_ICONS).find((k) => raw.includes(k.replace(/[^a-z0-9]/g, '')) || k.replace(/[^a-z0-9]/g, '').includes(raw));
  return key ? CATEGORY_ICONS[key] : 'pricetag-outline';
};
const SUPABASE_AVATAR_BUCKET = process.env.EXPO_PUBLIC_SUPABASE_AVATAR_BUCKET || 'avatars';
const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const MAX_CATEGORIES = 5;
const THREADS_BATCH_SIZE = 5;
const BOTTOM_TAB_BAR_HEIGHT = 56;
const BOTTOM_TAB_BAR_MARGIN = 20;
const FAB_HEIGHT_ESTIMATE = 48;
const FAB_CLEARANCE = 12;
const FAB_TAB_GAP = 12;

const normalizeAvatarUrl = (value) => {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:image/')) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (!SUPABASE_URL) return trimmed;
  if (trimmed.startsWith('/storage/')) return `${SUPABASE_URL}${trimmed}`;
  if (trimmed.startsWith('storage/')) return `${SUPABASE_URL}/${trimmed}`;
  if (trimmed.startsWith(`${SUPABASE_AVATAR_BUCKET}/`)) {
    return `${SUPABASE_URL}/storage/v1/object/public/${trimmed}`;
  }
  if (!trimmed.includes('/')) {
    return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_AVATAR_BUCKET}/${trimmed}`;
  }
  if (trimmed.startsWith('/')) return `${SUPABASE_URL}${trimmed}`;
  return trimmed;
};

const buildInitials = (value) => {
  if (!value) return 'NA';
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'NA';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return `${first}${last}`.toUpperCase();
};

const formatRelativeTime = (value) => {
  if (!value) return '';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '';
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

const dedupeById = (items) => {
  if (!Array.isArray(items) || items.length <= 1) return Array.isArray(items) ? items : [];
  const seen = new Set();
  return items.filter((item) => {
    const id = item?.id;
    if (!id) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

const Avatar = memo(function Avatar({ avatarUrl, name, isDark, size = 44 }) {
  const containerStyle = {
    width: size,
    height: size,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(30,64,175,0.65)' : '#cbd5e1',
    backgroundColor: isDark ? 'rgba(2,6,23,0.75)' : '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };

  return (
    <View style={containerStyle}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={{ width: size, height: size }} />
      ) : (
        <Text style={[styles.avatarText, { color: isDark ? '#dbeafe' : '#1e293b' }]}>{buildInitials(name)}</Text>
      )}
    </View>
  );
});

const PostCard = memo(function PostCard({
  post,
  index,
  stats,
  onOpenThread,
  onToggleLike,
  likeBusyId,
  canLike,
  canDelete,
  onDeleteThread,
  deleteBusyId,
  isDark,
  colors,
}) {
  const fade = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    const itemDelay = 40 + Math.min(index, 5) * 24;
    Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      delay: itemDelay,
      useNativeDriver: true,
    }).start();
    Animated.timing(translate, {
      toValue: 0,
      duration: 220,
      delay: itemDelay,
      useNativeDriver: true,
    }).start();
  }, [fade, index, translate]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: fade,
          transform: [{ translateY: translate }],
          backgroundColor: colors.card,
          borderColor: colors.cardBorder,
        },
      ]}
    >
      <View style={styles.rowBetweenStart}>
        <View style={styles.rowStart}>
          <Avatar avatarUrl={post.authorAvatar} name={post.authorName} isDark={isDark} size={48} />
          <View>
            <Text style={[styles.authorName, { color: colors.title }]}>{post.authorName}</Text>
            <Text style={[styles.mutedText, { color: colors.muted }]}>{post.authorOrg || 'Community'}</Text>
          </View>
        </View>
        <Text style={[styles.mutedText, { color: colors.subtle }]}>{formatRelativeTime(post.created_at)}</Text>
      </View>

      <Text style={[styles.threadTitle, { color: colors.title }]}>{post.title}</Text>
      <Text style={[styles.threadBody, { color: colors.text }]}>
        {post.body?.length > 180 ? `${post.body.slice(0, 180)}...` : post.body}
      </Text>

      <View style={styles.tagWrap}>
        {(post.categories || []).map((tag) => (
          <View
            key={tag.id}
            style={[
              styles.tag,
              {
                borderColor: isDark ? 'rgba(56,189,248,0.45)' : '#7dd3fc',
                backgroundColor: isDark ? 'rgba(14,116,144,0.3)' : '#e0f2fe',
              },
            ]}
          >
            <Text style={[styles.tagText, { color: isDark ? '#bae6fd' : '#0369a1' }]}>#{tag.label}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.statsRow, { borderTopColor: colors.divider }]}>
        <View style={styles.rowStartGapLarge}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => onToggleLike(post)}
            disabled={!canLike || likeBusyId === post.id}
            style={styles.rowStartGapSmall}
          >
            <Text
              style={[
                styles.statLabel,
                {
                  color: stats?.userLiked
                    ? isDark
                      ? '#fecdd3'
                      : '#be123c'
                    : isDark
                    ? '#fda4af'
                    : '#e11d48',
                },
              ]}
            >
              {stats?.userLiked ? '♥' : '♡'}
            </Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{stats?.likes || 0}</Text>
          </TouchableOpacity>
          <View style={styles.rowStartGapSmall}>
            <Text style={[styles.statLabel, { color: '#38bdf8' }]}>↩</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{stats?.replies || 0}</Text>
          </View>
        </View>
        <View style={styles.rowStartGapLarge}>
          {canDelete && (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => onDeleteThread(post)}
              disabled={deleteBusyId === post.id}
            >
              <Text style={styles.deleteThreadText}>{deleteBusyId === post.id ? 'Deleting...' : 'Delete'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity activeOpacity={0.85} onPress={() => onOpenThread(post)}>
            <Text style={styles.openThreadText}>Open thread {'->'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}, (prev, next) => (
  prev.post === next.post
  && prev.index === next.index
  && prev.stats === next.stats
  && prev.likeBusyId === next.likeBusyId
  && prev.deleteBusyId === next.deleteBusyId
  && prev.canLike === next.canLike
  && prev.canDelete === next.canDelete
  && prev.isDark === next.isDark
));

const CommunityForumScreen = ({ onNavigate, openNotificationsSignal }) => {
  const { isDark } = useAppTheme();
  const screenAnim = useRef(new Animated.Value(0)).current;
  const filter = useMemo(() => new Filter(), []);

  const [sessionUser, setSessionUser] = useState(null);
  const [myAvatarUrl, setMyAvatarUrl] = useState('');
  const [myDisplayName, setMyDisplayName] = useState('');
  const [categories, setCategories] = useState([]);
  const [threads, setThreads] = useState([]);
  const [myThreads, setMyThreads] = useState([]);
  const [threadStats, setThreadStats] = useState({});
  const [selectedMode, setSelectedMode] = useState('all'); // 'all' | 'mine'
  const [selectedTopics, setSelectedTopics] = useState([]); // array of category IDs
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreThreads, setHasMoreThreads] = useState(true);
  const [feedError, setFeedError] = useState('');
  const [myThreadsLoading, setMyThreadsLoading] = useState(false);
  const [myThreadsError, setMyThreadsError] = useState('');

  const [threadModalVisible, setThreadModalVisible] = useState(false);
  const [activeThread, setActiveThread] = useState(null);
  const [threadPosts, setThreadPosts] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyError, setReplyError] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);

  const [composeVisible, setComposeVisible] = useState(false);
  const [composeTitle, setComposeTitle] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeCategories, setComposeCategories] = useState([]);
  const [composeError, setComposeError] = useState('');
  const [composeLoading, setComposeLoading] = useState(false);

  const [likeBusyId, setLikeBusyId] = useState('');
  const [threadLikeBusyId, setThreadLikeBusyId] = useState('');
  const [categoriesOpen, setCategoriesOpen] = useState(true);
  const [threadDeleteBusyId, setThreadDeleteBusyId] = useState('');
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [highlightedPostId, setHighlightedPostId] = useState('');
  const fabBottomOffset = BOTTOM_TAB_BAR_MARGIN + BOTTOM_TAB_BAR_HEIGHT + FAB_TAB_GAP;
  const feedBottomPadding = fabBottomOffset + FAB_HEIGHT_ESTIMATE + FAB_CLEARANCE;

  const {
    notifications,
    notificationsLoading,
    notificationsError,
    notificationsBusyId,
    unreadNotificationsCount,
    refreshNotifications,
    markNotificationAsRead,
    setNotificationsError,
  } = useForumNotifications({
    sessionUserId: sessionUser?.id || '',
    profilesTable: SUPABASE_PROFILES_TABLE,
    normalizeAvatarUrl,
  });

  const applyProfileToForumState = useCallback((userId, profile) => {
    if (!userId) return;
    const nextAuthorName = profile?.display_name || 'Community member';
    const nextAuthorOrg = profile?.organization || '';
    const nextAuthorAvatar = normalizeAvatarUrl(profile?.avatar_url);

    setThreads((prev) =>
      prev.map((thread) =>
        thread.user_id === userId
          ? {
              ...thread,
              authorName: nextAuthorName,
              authorOrg: nextAuthorOrg,
              authorAvatar: nextAuthorAvatar,
            }
          : thread
      )
    );

    setMyThreads((prev) =>
      prev.map((thread) =>
        thread.user_id === userId
          ? {
              ...thread,
              authorName: nextAuthorName,
              authorOrg: nextAuthorOrg,
              authorAvatar: nextAuthorAvatar,
            }
          : thread
      )
    );

    setActiveThread((prev) => {
      if (!prev || prev.user_id !== userId) return prev;
      return {
        ...prev,
        authorName: nextAuthorName,
        authorOrg: nextAuthorOrg,
        authorAvatar: nextAuthorAvatar,
      };
    });

    setThreadPosts((prev) =>
      prev.map((post) =>
        post.user_id === userId
          ? {
              ...post,
              authorName: nextAuthorName,
              authorOrg: nextAuthorOrg,
              authorAvatar: nextAuthorAvatar,
            }
          : post
      )
    );
  }, []);

  const fetchMyProfile = useCallback(async (user) => {
    if (!user?.id) return;
    try {
      const { data } = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .select('display_name, organization, avatar_url')
        .eq('id', user.id)
        .maybeSingle();

      const normalizedAvatar = normalizeAvatarUrl(data?.avatar_url);
      const profileVersion = data?.updated_at ? new Date(data.updated_at).getTime() : Date.now();
      const avatarWithVersion = normalizedAvatar
        ? `${normalizedAvatar}${normalizedAvatar.includes('?') ? '&' : '?'}v=${profileVersion}`
        : '';

      setMyAvatarUrl(avatarWithVersion);
      setMyDisplayName(data?.display_name || '');

      applyProfileToForumState(user.id, {
        display_name: data?.display_name,
        organization: data?.organization,
        avatar_url: avatarWithVersion,
      });
    } catch (_err) {
      // non-critical
    }
  }, [applyProfileToForumState]);

  const colors = useMemo(() => {
    if (isDark) {
      return {
        screen: '#020617',
        card: 'rgba(2,6,23,0.68)',
        cardBorder: 'rgba(12,74,110,0.7)',
        title: '#f0f9ff',
        text: '#cbd5e1',
        muted: '#94a3b8',
        subtle: '#64748b',
        divider: 'rgba(12,74,110,0.65)',
        inputBg: 'rgba(2,6,23,0.7)',
        inputBorder: 'rgba(12,74,110,0.65)',
        inputText: '#e2e8f0',
        modalBg: 'rgba(2,6,23,0.95)',
        chipBg: 'rgba(2,6,23,0.6)',
        chipBorder: 'rgba(12,74,110,0.65)',
      };
    }

    return {
      screen: '#f1f5f9',
      card: '#ffffff',
      cardBorder: '#cbd5e1',
      title: '#0f172a',
      text: '#334155',
      muted: '#475569',
      subtle: '#64748b',
      divider: '#e2e8f0',
      inputBg: '#ffffff',
      inputBorder: '#cbd5e1',
      inputText: '#1e293b',
      modalBg: 'rgba(241,245,249,0.95)',
      chipBg: '#f1f5f9',
      chipBorder: '#cbd5e1',
    };
  }, [isDark]);

  useFocusEffect(
    useCallback(() => {
      screenAnim.setValue(0);

      const animation = Animated.timing(screenAnim, {
        toValue: 1,
        duration: 300,
        delay: 10,
        useNativeDriver: true,
      });

      animation.start();

      return () => {
        animation.stop();
      };
    }, [screenAnim])
  );

  useEffect(() => {
    let isMounted = true;

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (isMounted) {
        const user = data?.session?.user || null;
        setSessionUser(user);
        await fetchMyProfile(user);
      }
    };

    loadSession();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        const user = session?.user || null;
        setSessionUser(user);
        fetchMyProfile(user);
      }
    });

    return () => {
      isMounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, [fetchMyProfile]);

  useFocusEffect(
    useCallback(() => {
      if (sessionUser?.id) {
        fetchMyProfile(sessionUser);
      }
    }, [fetchMyProfile, sessionUser])
  );

  useEffect(() => {
    if (!sessionUser?.id) return undefined;

    const profileChannel = supabase
      .channel(`forum-profile-sync-${sessionUser.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: SUPABASE_PROFILES_TABLE,
          filter: `id=eq.${sessionUser.id}`,
        },
        (payload) => {
          const next = payload?.new || {};
          const normalizedAvatar = normalizeAvatarUrl(next.avatar_url);
          const profileVersion = next.updated_at ? new Date(next.updated_at).getTime() : Date.now();
          const avatarWithVersion = normalizedAvatar
            ? `${normalizedAvatar}${normalizedAvatar.includes('?') ? '&' : '?'}v=${profileVersion}`
            : '';

          setMyAvatarUrl(avatarWithVersion);
          setMyDisplayName(next.display_name || '');

          applyProfileToForumState(sessionUser.id, {
            display_name: next.display_name,
            organization: next.organization,
            avatar_url: avatarWithVersion,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
    };
  }, [applyProfileToForumState, sessionUser?.id]);

  const fetchThreadsBatch = useCallback(async (offset, limit) => {
    const toIndex = offset + limit - 1;
    const threadResult = await supabase
      .from('forum_threads')
      .select('id, user_id, title, body, created_at, updated_at, forum_thread_categories(category_id, forum_categories(id, slug, label))')
      .order('created_at', { ascending: false })
      .range(offset, toIndex);

    if (threadResult.error) throw threadResult.error;

    const rawThreads = threadResult.data || [];
    const userIds = Array.from(new Set(rawThreads.map((thread) => thread.user_id).filter(Boolean)));
    const profilesResult = userIds.length
      ? await supabase
          .from(SUPABASE_PROFILES_TABLE)
          .select('id, display_name, organization, avatar_url')
          .in('id', userIds)
      : { data: [] };

    if (profilesResult.error) throw profilesResult.error;

    const profileMap = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));

    const hydratedThreads = rawThreads.map((thread) => {
      const profile = profileMap.get(thread.user_id) || {};
      const categoryLinks = thread.forum_thread_categories || [];
      const mappedCategories = dedupeById(categoryLinks.map((link) => link.forum_categories).filter(Boolean));
      return {
        ...thread,
        categories: mappedCategories,
        authorName: profile.display_name || 'Community member',
        authorOrg: profile.organization || '',
        authorAvatar: normalizeAvatarUrl(profile.avatar_url),
      };
    });

    const threadIds = hydratedThreads.map((thread) => thread.id);
    let postsData = [];
    if (threadIds.length) {
      const postsResult = await supabase
        .from('forum_posts')
        .select('id, thread_id')
        .in('thread_id', threadIds);
      if (postsResult.error) throw postsResult.error;
      postsData = postsResult.data || [];
    }

    const repliesCount = postsData.reduce((acc, post) => {
      acc[post.thread_id] = (acc[post.thread_id] || 0) + 1;
      return acc;
    }, {});

    let likesCount = {};
    const userLikedThreadIds = new Set();
    if (threadIds.length) {
      const likesResult = await supabase
        .from('forum_thread_likes')
        .select('thread_id, user_id')
        .in('thread_id', threadIds);

      if (likesResult.error) throw likesResult.error;

      (likesResult.data || []).forEach((row) => {
        const threadId = row.thread_id;
        if (!threadId) return;
        likesCount[threadId] = (likesCount[threadId] || 0) + 1;
        if (sessionUser?.id && row.user_id === sessionUser.id) {
          userLikedThreadIds.add(threadId);
        }
      });
    }

    const stats = hydratedThreads.reduce((acc, thread) => {
      acc[thread.id] = {
        replies: repliesCount[thread.id] || 0,
        likes: likesCount[thread.id] || 0,
        userLiked: userLikedThreadIds.has(thread.id),
      };
      return acc;
    }, {});

    return { hydratedThreads, stats };
  }, [sessionUser?.id]);

  const loadForumData = useCallback(async () => {
    setLoading(true);
    setFeedError('');

    try {
      const [categoryResult, batchResult] = await Promise.all([
        supabase
          .from('forum_categories')
          .select('id, slug, label, is_active')
          .eq('is_active', true)
          .order('label', { ascending: true }),
        fetchThreadsBatch(0, THREADS_BATCH_SIZE),
      ]);

      if (categoryResult.error) throw categoryResult.error;

      const activeCategories = dedupeById(categoryResult.data || []);

      setCategories(activeCategories);
      setThreads(dedupeById(batchResult.hydratedThreads));
      setThreadStats(batchResult.stats);
      setHasMoreThreads(batchResult.hydratedThreads.length === THREADS_BATCH_SIZE);
    } catch (error) {
      console.warn('[Supabase] forum load failed:', error?.message || error);
      setFeedError('Unable to load forum right now.');
    } finally {
      setLoading(false);
    }
  }, [fetchThreadsBatch]);

  const loadMoreThreads = useCallback(async () => {
    if (loading || loadingMore || !hasMoreThreads) return;

    setLoadingMore(true);
    setFeedError('');

    try {
      const batchResult = await fetchThreadsBatch(threads.length, THREADS_BATCH_SIZE);
      if (!batchResult.hydratedThreads.length) {
        setHasMoreThreads(false);
        return;
      }

      setThreads((prev) => dedupeById([...prev, ...batchResult.hydratedThreads]));
      setThreadStats((prev) => ({
        ...prev,
        ...batchResult.stats,
      }));
      setHasMoreThreads(batchResult.hydratedThreads.length === THREADS_BATCH_SIZE);
    } catch (error) {
      console.warn('[Supabase] forum load more failed:', error?.message || error);
      setFeedError('Unable to load more threads right now.');
    } finally {
      setLoadingMore(false);
    }
  }, [fetchThreadsBatch, hasMoreThreads, loading, loadingMore, threads.length]);

  const fetchMyThreads = useCallback(async () => {
    if (!sessionUser?.id) {
      setMyThreads([]);
      setMyThreadsError('');
      return;
    }

    setMyThreadsLoading(true);
    setMyThreadsError('');

    try {
      const threadResult = await supabase
        .from('forum_threads')
        .select('id, user_id, title, body, created_at, updated_at, forum_thread_categories(category_id, forum_categories(id, slug, label))')
        .eq('user_id', sessionUser.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (threadResult.error) throw threadResult.error;

      const rawThreads = threadResult.data || [];
      const userIds = Array.from(new Set(rawThreads.map((thread) => thread.user_id).filter(Boolean)));
      const profilesResult = userIds.length
        ? await supabase
            .from(SUPABASE_PROFILES_TABLE)
            .select('id, display_name, organization, avatar_url')
            .in('id', userIds)
        : { data: [] };

      if (profilesResult.error) throw profilesResult.error;

      const profileMap = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));

      const hydratedThreads = rawThreads.map((thread) => {
        const profile = profileMap.get(thread.user_id) || {};
        const categoryLinks = thread.forum_thread_categories || [];
        const mappedCategories = dedupeById(categoryLinks.map((link) => link.forum_categories).filter(Boolean));
        return {
          ...thread,
          categories: mappedCategories,
          authorName: profile.display_name || 'Community member',
          authorOrg: profile.organization || '',
          authorAvatar: normalizeAvatarUrl(profile.avatar_url),
        };
      });

      const threadIds = hydratedThreads.map((thread) => thread.id);
      let postsData = [];
      if (threadIds.length) {
        const postsResult = await supabase
          .from('forum_posts')
          .select('id, thread_id')
          .in('thread_id', threadIds);
        if (postsResult.error) throw postsResult.error;
        postsData = postsResult.data || [];
      }

      const repliesCount = postsData.reduce((acc, post) => {
        acc[post.thread_id] = (acc[post.thread_id] || 0) + 1;
        return acc;
      }, {});

      let likesCount = {};
      const userLikedThreadIds = new Set();
      if (threadIds.length) {
        const likesResult = await supabase
          .from('forum_thread_likes')
          .select('thread_id, user_id')
          .in('thread_id', threadIds);

        if (likesResult.error) throw likesResult.error;

        (likesResult.data || []).forEach((row) => {
          const threadId = row.thread_id;
          if (!threadId) return;
          likesCount[threadId] = (likesCount[threadId] || 0) + 1;
          if (row.user_id === sessionUser.id) {
            userLikedThreadIds.add(threadId);
          }
        });
      }

      const stats = hydratedThreads.reduce((acc, thread) => {
        acc[thread.id] = {
          replies: repliesCount[thread.id] || 0,
          likes: likesCount[thread.id] || 0,
          userLiked: userLikedThreadIds.has(thread.id),
        };
        return acc;
      }, {});

      setMyThreads(dedupeById(hydratedThreads));
      setThreadStats((prev) => ({
        ...prev,
        ...stats,
      }));
    } catch (error) {
      console.warn('[Supabase] my threads load failed:', error?.message || error);
      setMyThreadsError('Unable to load your threads right now.');
    } finally {
      setMyThreadsLoading(false);
    }
  }, [sessionUser?.id]);

  useEffect(() => {
    loadForumData();
  }, [loadForumData]);

  useEffect(() => {
    fetchMyThreads();
  }, [fetchMyThreads]);

  useEffect(() => {
    const channel = supabase
      .channel('forum-thread-likes-feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'forum_thread_likes' },
        () => {
          loadForumData();
          fetchMyThreads();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchMyThreads, loadForumData]);

  const tagFilters = useMemo(() => {
    const dynamic = categories.map((category) => ({
      id: category.id,
      label: category.label,
      slug: category.slug,
    }));
    const base = [{ id: 'all', label: 'All' }];
    if (sessionUser?.id) {
      base.push({ id: 'mine', label: 'My threads' });
    }
    return [...base, ...dynamic];
  }, [categories, sessionUser?.id]);

  const loggedInAs = useMemo(() => {
    if (myDisplayName) return myDisplayName;
    const metaName = sessionUser?.user_metadata?.display_name
      || sessionUser?.user_metadata?.name
      || sessionUser?.user_metadata?.username;
    const emailName = sessionUser?.email ? sessionUser.email.split('@')[0] : '';
    return metaName || emailName || 'user';
  }, [myDisplayName, sessionUser]);

  const filteredThreads = useMemo(() => {
    if (selectedMode === 'mine') return dedupeById(myThreads);
    if (selectedTopics.length === 0) return dedupeById(threads);
    return dedupeById(threads.filter((thread) =>
      (thread.categories || []).some((cat) => selectedTopics.includes(cat.id))
    ));
  }, [myThreads, selectedMode, selectedTopics, threads]);

  const containsBadWords = useCallback((text) => {
    if (!text) return false;
    try {
      return filter.isProfane(text);
    } catch (error) {
      console.warn('[Forum] bad-words filter failed:', error?.message || error);
      return false;
    }
  }, [filter]);

  const fetchThreadById = useCallback(async (threadId) => {
    if (!threadId) return null;

    const threadResult = await supabase
      .from('forum_threads')
      .select('id, user_id, title, body, created_at, updated_at, forum_thread_categories(category_id, forum_categories(id, slug, label))')
      .eq('id', threadId)
      .maybeSingle();

    if (threadResult.error) throw threadResult.error;
    if (!threadResult.data) return null;

    const thread = threadResult.data;
    const profileResult = await supabase
      .from(SUPABASE_PROFILES_TABLE)
      .select('id, display_name, organization, avatar_url')
      .eq('id', thread.user_id)
      .maybeSingle();

    if (profileResult.error) throw profileResult.error;

    const categoryLinks = thread.forum_thread_categories || [];
    const mappedCategories = dedupeById(categoryLinks.map((link) => link.forum_categories).filter(Boolean));
    const profile = profileResult.data || {};

    return {
      ...thread,
      categories: mappedCategories,
      authorName: profile.display_name || 'Community member',
      authorOrg: profile.organization || '',
      authorAvatar: normalizeAvatarUrl(profile.avatar_url),
    };
  }, []);

  const openThread = useCallback(async (thread, options = {}) => {
    setActiveThread(thread);
    setThreadModalVisible(true);
    setReplyText('');
    setReplyTarget(null);
    setReplyError('');
    setThreadLoading(true);

    try {
      const postsResult = await supabase
        .from('forum_posts')
        .select('id, thread_id, user_id, parent_post_id, body, created_at')
        .eq('thread_id', thread.id)
        .order('created_at', { ascending: true });

      if (postsResult.error) throw postsResult.error;

      const posts = postsResult.data || [];
      const userIds = Array.from(new Set(posts.map((post) => post.user_id).filter(Boolean)));
      const profilesResult = userIds.length
        ? await supabase
            .from(SUPABASE_PROFILES_TABLE)
            .select('id, display_name, organization, avatar_url')
            .in('id', userIds)
        : { data: [] };

      if (profilesResult.error) throw profilesResult.error;

      const profileMap = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
      const postIds = posts.map((post) => post.id);
      const likesResult = postIds.length
        ? await supabase
            .from('forum_post_likes')
            .select('post_id, user_id')
            .in('post_id', postIds)
        : { data: [] };

      const likesMap = (likesResult.data || []).reduce((acc, like) => {
        if (!acc[like.post_id]) {
          acc[like.post_id] = new Set();
        }
        acc[like.post_id].add(like.user_id);
        return acc;
      }, {});

      const enrichedPosts = posts.map((post) => {
        const profile = profileMap.get(post.user_id) || {};
        const likedBy = likesMap[post.id] || new Set();
        return {
          ...post,
          authorName: profile.display_name || 'Community member',
          authorOrg: profile.organization || '',
          authorAvatar: normalizeAvatarUrl(profile.avatar_url),
          likeCount: likedBy.size,
          userLiked: sessionUser?.id ? likedBy.has(sessionUser.id) : false,
        };
      });

      const dedupedPosts = dedupeById(enrichedPosts);
      setThreadPosts(dedupedPosts);
      setHighlightedPostId(options?.focusPostId || '');
    } catch (error) {
      console.warn('[Supabase] thread load failed:', error?.message || error);
      setReplyError('Unable to load thread replies.');
      setHighlightedPostId('');
    } finally {
      setThreadLoading(false);
    }
  }, [sessionUser?.id]);

  const closeThread = useCallback(() => {
    setThreadModalVisible(false);
    setActiveThread(null);
    setThreadPosts([]);
    setReplyText('');
    setReplyTarget(null);
    setReplyError('');
    setHighlightedPostId('');
  }, []);

  const handleOpenNotification = useCallback(async (notification) => {
    if (!notification?.id || !notification?.thread_id) return;
    if (!sessionUser?.id) return;

    setNotificationsError('');

    try {
      if (!notification.is_read) {
        await markNotificationAsRead(notification.id);
      }

      const localThread = dedupeById([activeThread, ...threads, ...myThreads]).find(
        (thread) => thread?.id === notification.thread_id
      );
      const threadToOpen = localThread || await fetchThreadById(notification.thread_id);

      if (!threadToOpen) {
        throw new Error('Thread not found');
      }

      setNotificationsVisible(false);
      await openThread(threadToOpen, { focusPostId: notification.post_id || '' });
    } catch (error) {
      console.warn('[Supabase] notification open failed:', error?.message || error);
      setNotificationsError('Unable to open this notification right now.');
    }
  }, [activeThread, fetchThreadById, markNotificationAsRead, myThreads, openThread, sessionUser?.id, setNotificationsError, threads]);

  const handleSendReply = useCallback(async () => {
    const trimmed = replyText.trim();
    if (!trimmed) {
      setReplyError('Reply cannot be empty.');
      return;
    }
    if (!activeThread) {
      setReplyError('Select a thread first.');
      return;
    }
    if (!sessionUser) {
      setReplyError('Please sign in to reply.');
      return;
    }
    if (containsBadWords(trimmed)) {
      setReplyError('Please remove blocked words before posting.');
      return;
    }

    setReplyLoading(true);
    setReplyError('');
    try {
      const insertPayload = {
        thread_id: activeThread.id,
        user_id: sessionUser.id,
        body: trimmed,
        parent_post_id: replyTarget?.id || null,
      };

      const insertResult = await supabase
        .from('forum_posts')
        .insert(insertPayload)
        .select('id, thread_id, user_id, parent_post_id, body, created_at')
        .single();

      if (insertResult.error) throw insertResult.error;

      const profileResult = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .select('id, display_name, organization, avatar_url')
        .eq('id', sessionUser.id)
        .maybeSingle();

      const profile = profileResult.data || {};
      const newPost = {
        ...insertResult.data,
        authorName: profile.display_name || 'You',
        authorOrg: profile.organization || '',
        authorAvatar: normalizeAvatarUrl(profile.avatar_url),
        likeCount: 0,
        userLiked: false,
      };

      setThreadPosts((prev) => dedupeById([...prev, newPost]));
      setReplyText('');
      setReplyTarget(null);
      setThreadStats((prev) => {
        const current = prev[activeThread.id] || { replies: 0, likes: 0 };
        return {
          ...prev,
          [activeThread.id]: {
            ...current,
            replies: current.replies + 1,
          },
        };
      });
    } catch (error) {
      const debugReason = error?.message || error?.details || error?.hint || 'Unknown error';
      console.warn('[Supabase] reply insert failed:', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
        debugReason,
        threadId: activeThread?.id || null,
        parentPostId: replyTarget?.id || null,
        userId: sessionUser?.id || null,
        replyLength: trimmed.length,
      });
      setReplyError(__DEV__ ? `Unable to post reply right now. (${debugReason})` : 'Unable to post reply right now.');
    } finally {
      setReplyLoading(false);
    }
  }, [activeThread, containsBadWords, replyTarget?.id, replyText, sessionUser]);

  const toggleLike = useCallback(async (post) => {
    if (!sessionUser) {
      setReplyError('Please sign in to like a reply.');
      return;
    }
    if (likeBusyId === post.id) return;

    setLikeBusyId(post.id);
    setReplyError('');
    try {
      if (post.userLiked) {
        const { error } = await supabase
          .from('forum_post_likes')
          .delete()
          .eq('post_id', post.id)
          .eq('user_id', sessionUser.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('forum_post_likes')
          .insert({ post_id: post.id, user_id: sessionUser.id });
        if (error) throw error;
      }

      setThreadPosts((prev) =>
        prev.map((item) => {
          if (item.id !== post.id) return item;
          const nextLiked = !item.userLiked;
          const nextCount = Math.max(0, item.likeCount + (nextLiked ? 1 : -1));
          return { ...item, userLiked: nextLiked, likeCount: nextCount };
        })
      );
    } catch (error) {
      console.warn('[Supabase] like toggle failed:', error?.message || error);
      setReplyError('Unable to update like right now.');
    } finally {
      setLikeBusyId('');
    }
  }, [likeBusyId, sessionUser]);

  const syncThreadLikeState = useCallback(async (threadId) => {
    if (!threadId) return;
    const { data, error } = await supabase
      .from('forum_thread_likes')
      .select('user_id')
      .eq('thread_id', threadId);

    if (error) throw error;

    const likes = (data || []).length;
    const userLiked = !!sessionUser?.id && (data || []).some((row) => row.user_id === sessionUser.id);

    setThreadStats((prev) => {
      const current = prev[threadId] || { replies: 0, likes: 0, userLiked: false };
      return {
        ...prev,
        [threadId]: {
          ...current,
          likes,
          userLiked,
        },
      };
    });
  }, [sessionUser?.id]);

  const toggleThreadLike = useCallback(async (thread) => {
    if (!sessionUser) {
      setFeedError('Please sign in to like a thread.');
      return;
    }
    if (threadLikeBusyId === thread.id) return;

    const currentStats = threadStats[thread.id] || { likes: 0, replies: 0, userLiked: false };
    const currentlyLiked = !!currentStats.userLiked;

    setThreadLikeBusyId(thread.id);
    setFeedError('');
    try {
      if (currentlyLiked) {
        const { error } = await supabase
          .from('forum_thread_likes')
          .delete()
          .eq('thread_id', thread.id)
          .eq('user_id', sessionUser.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('forum_thread_likes')
          .upsert(
            { thread_id: thread.id, user_id: sessionUser.id },
            { onConflict: 'thread_id,user_id', ignoreDuplicates: true }
          );
        if (error) throw error;
      }

      await syncThreadLikeState(thread.id);
    } catch (error) {
      console.warn('[Supabase] thread like toggle failed:', error?.message || error);
      try {
        await syncThreadLikeState(thread.id);
      } catch (_syncError) {
        setFeedError('Unable to update thread like right now.');
      }
    } finally {
      setThreadLikeBusyId('');
    }
  }, [sessionUser, syncThreadLikeState, threadLikeBusyId, threadStats]);

  const deleteThread = useCallback(async (thread) => {
    if (!sessionUser?.id) {
      setFeedError('Please sign in to delete a thread.');
      return;
    }
    if (!thread?.id) return;
    if (thread.user_id !== sessionUser.id) {
      setFeedError('You can only delete your own thread.');
      return;
    }
    if (threadDeleteBusyId === thread.id) return;

    const performDelete = async () => {
      setThreadDeleteBusyId(thread.id);
      setFeedError('');
      try {
        const { error } = await supabase
          .from('forum_threads')
          .delete()
          .eq('id', thread.id)
          .eq('user_id', sessionUser.id);

        if (error) throw error;

        setThreads((prev) => prev.filter((item) => item.id !== thread.id));
        setMyThreads((prev) => prev.filter((item) => item.id !== thread.id));
        setThreadStats((prev) => {
          const next = { ...prev };
          delete next[thread.id];
          return next;
        });

        if (activeThread?.id === thread.id) {
          closeThread();
        }
      } catch (error) {
        console.warn('[Supabase] thread delete failed:', error?.message || error);
        setFeedError('Unable to delete this thread right now.');
      } finally {
        setThreadDeleteBusyId('');
      }
    };

    Alert.alert(
      'Delete thread?',
      'This will permanently remove the thread and all replies.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: performDelete },
      ]
    );
  }, [activeThread?.id, closeThread, sessionUser?.id, threadDeleteBusyId]);

  const handleCreateThread = useCallback(async () => {
    const trimmedTitle = composeTitle.trim();
    const trimmedBody = composeBody.trim();

    if (!trimmedTitle || !trimmedBody) {
      setComposeError('Title and details are required.');
      return;
    }
    if (!sessionUser) {
      setComposeError('Please sign in to start a thread.');
      return;
    }
    if (containsBadWords(`${trimmedTitle} ${trimmedBody}`)) {
      setComposeError('Please remove blocked words before posting.');
      return;
    }
    if (composeCategories.length === 0) {
      setComposeError('Select at least one category.');
      return;
    }

    setComposeLoading(true);
    setComposeError('');

    try {
      const insertResult = await supabase
        .from('forum_threads')
        .insert({
          user_id: sessionUser.id,
          title: trimmedTitle,
          body: trimmedBody,
        })
        .select('id, user_id, title, body, created_at, updated_at')
        .single();

      if (insertResult.error) throw insertResult.error;

      const threadId = insertResult.data.id;
      const categoryPayload = composeCategories.map((categoryId) => ({
        thread_id: threadId,
        category_id: categoryId,
      }));

      if (categoryPayload.length) {
        const { error } = await supabase.from('forum_thread_categories').insert(categoryPayload);
        if (error) throw error;
      }

      const profileResult = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .select('id, display_name, organization, avatar_url')
        .eq('id', sessionUser.id)
        .maybeSingle();

      const profile = profileResult.data || {};
      const selectedCategories = categories.filter((category) => composeCategories.includes(category.id));

      const newThread = {
        ...insertResult.data,
        categories: selectedCategories,
        authorName: profile.display_name || 'You',
        authorOrg: profile.organization || '',
        authorAvatar: normalizeAvatarUrl(profile.avatar_url),
      };

      setThreads((prev) => dedupeById([newThread, ...prev]));
      setMyThreads((prev) => dedupeById([newThread, ...prev]));
      setThreadStats((prev) => ({
        ...prev,
        [threadId]: { replies: 0, likes: 0 },
      }));
      setComposeTitle('');
      setComposeBody('');
      setComposeCategories([]);
      setComposeVisible(false);
    } catch (error) {
      console.warn('[Supabase] create thread failed:', error?.message || error);
      setComposeError('Unable to start the thread right now.');
    } finally {
      setComposeLoading(false);
    }
  }, [categories, composeBody, composeCategories, composeTitle, containsBadWords, sessionUser]);

  const toggleComposeCategory = useCallback((categoryId) => {
    setComposeCategories((prev) => {
      if (prev.includes(categoryId)) {
        return prev.filter((id) => id !== categoryId);
      }
      if (prev.length >= MAX_CATEGORIES) {
        setComposeError(`Select up to ${MAX_CATEGORIES} categories.`);
        return prev;
      }
      setComposeError('');
      return [...prev, categoryId];
    });
  }, []);

  const selectMode = useCallback((mode) => {
    setSelectedMode(mode);
    if (mode === 'mine') setSelectedTopics([]);
  }, []);

  const toggleTopic = useCallback((catId) => {
    setSelectedMode('all');
    setSelectedTopics((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  }, []);

  const clearTopics = useCallback(() => {
    setSelectedTopics([]);
  }, []);

  const toggleCategoriesSection = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCategoriesOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!sessionUser?.id && selectedMode === 'mine') {
      setSelectedMode('all');
      setSelectedTopics([]);
    }
  }, [selectedMode, sessionUser?.id]);

  useEffect(() => {
    if (!openNotificationsSignal) return;
    setNotificationsVisible(true);
    refreshNotifications();
  }, [openNotificationsSignal, refreshNotifications]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      loadForumData(),
      fetchMyThreads(),
      refreshNotifications(),
    ]);
  }, [fetchMyThreads, loadForumData, refreshNotifications]);

  const keyExtractor = useCallback((item) => item.id, []);

  const renderFeedItem = useCallback(({ item, index }) => {
    const canDelete = !!sessionUser?.id && item.user_id === sessionUser.id;
    return (
      <PostCard
        post={item}
        index={index}
        stats={threadStats[item.id]}
        onOpenThread={openThread}
        onToggleLike={toggleThreadLike}
        likeBusyId={threadLikeBusyId}
        canLike={!!sessionUser}
        canDelete={canDelete}
        onDeleteThread={deleteThread}
        deleteBusyId={threadDeleteBusyId}
        isDark={isDark}
        colors={colors}
      />
    );
  }, [colors, deleteThread, isDark, openThread, sessionUser, threadDeleteBusyId, threadLikeBusyId, threadStats, toggleThreadLike]);

  const listHeader = useMemo(() => (
    <View style={styles.headerWrap}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={[
            styles.iconButton,
            { borderColor: colors.chipBorder, backgroundColor: colors.chipBg },
          ]}
          activeOpacity={0.85}
          onPress={() => onNavigate?.('home')}
        >
          <Text style={[styles.iconButtonText, { color: isDark ? '#dbeafe' : '#334155' }]}>{'<'}</Text>
        </TouchableOpacity>

        <Text style={styles.kicker}>Community</Text>

        {sessionUser?.id ? (
          <TouchableOpacity
            style={[
              styles.iconButton,
              { borderColor: colors.chipBorder, backgroundColor: colors.chipBg },
            ]}
            activeOpacity={0.85}
            onPress={() => {
              setNotificationsVisible(true);
              refreshNotifications();
            }}
          >
            <Ionicons name="notifications-outline" size={18} color={isDark ? '#dbeafe' : '#334155'} />
            {unreadNotificationsCount > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>
                  {unreadNotificationsCount > 99 ? '99+' : unreadNotificationsCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.iconButtonSpacer} />
        )}
      </View>

      <View style={[
        styles.greetingRow,
        {
          borderColor: isDark ? 'rgba(12,74,110,0.55)' : '#e2e8f0',
          backgroundColor: isDark ? 'rgba(2,6,23,0.55)' : '#ffffff',
        }
      ]}>
        <View style={[
          styles.greetingAvatar,
          {
            borderColor: isDark ? 'rgba(30,64,175,0.65)' : '#cbd5e1',
            backgroundColor: isDark ? 'rgba(2,6,23,0.75)' : '#f1f5f9',
          }
        ]}>
          {myAvatarUrl ? (
            <Image source={{ uri: myAvatarUrl }} style={styles.greetingAvatarImage} />
          ) : (
            <Text style={[styles.greetingAvatarInitials, { color: isDark ? '#dbeafe' : '#1e293b' }]}>
              {buildInitials(loggedInAs)}
            </Text>
          )}
        </View>
        <View style={styles.greetingTextWrap}>
          <Text style={[styles.greetingHi, { color: isDark ? '#94a3b8' : '#64748b' }]}>Hi there 👋</Text>
          <Text style={[styles.greetingName, { color: colors.title }]} numberOfLines={1}>{loggedInAs}</Text>
        </View>
        <View style={[
          styles.greetingBadge,
          {
            borderColor: isDark ? 'rgba(14,165,233,0.4)' : '#7dd3fc',
            backgroundColor: isDark ? 'rgba(14,165,233,0.1)' : '#e0f2fe',
          }
        ]}>
          <Text style={[styles.greetingBadgeText, { color: isDark ? '#7dd3fc' : '#0369a1' }]}>Forum Feed</Text>
        </View>
      </View>

      {/* ── Quick filter row: All + Mine ─────────────────────────── */}
      <View style={styles.quickFiltersRow}>
        {[
          { id: 'all', label: 'All Threads', iconName: 'globe-outline' },
          ...(tagFilters.some((t) => t.id === 'mine') ? [{ id: 'mine', label: 'My Threads', iconName: 'person-outline' }] : []),
        ].map((tag) => {
          const isActive = tag.id === 'all'
            ? selectedMode === 'all' && selectedTopics.length === 0
            : selectedMode === tag.id;
          return (
            <TouchableOpacity
              key={tag.id}
              activeOpacity={0.85}
              onPress={() => selectMode(tag.id)}
              style={[
                styles.quickFilterBtn,
                isActive
                  ? { borderColor: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.15)' }
                  : { borderColor: colors.chipBorder, backgroundColor: colors.chipBg },
              ]}
            >
              <Ionicons
                name={tag.iconName}
                size={15}
                color={isActive ? '#22d3ee' : (isDark ? '#94a3b8' : '#475569')}
              />
              <Text style={[styles.quickFilterLabel, { color: isActive ? '#22d3ee' : colors.text }]}>{tag.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Collapsable topics section ────────────────────────────── */}
      {tagFilters.filter((t) => t.id !== 'all' && t.id !== 'mine').length > 0 && (
        <View
          style={[
            styles.topicsCard,
            {
              borderColor: isDark ? 'rgba(12,74,110,0.7)' : '#e2e8f0',
              backgroundColor: isDark ? 'rgba(2,6,23,0.55)' : '#ffffff',
            },
          ]}
        >
          {/* Section header / toggle */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={toggleCategoriesSection}
            style={styles.topicsHeader}
          >
            <View style={styles.topicsHeaderLeft}>
              <Ionicons name="pricetags-outline" size={15} color={isDark ? '#94a3b8' : '#475569'} />
              <Text style={[styles.topicsHeaderTitle, { color: colors.title }]}>Browse Topics</Text>
              {selectedTopics.length > 0 && (
                <View
                  style={[
                    styles.topicsActivePill,
                    {
                      borderColor: isDark ? 'rgba(34,211,238,0.5)' : '#7dd3fc',
                      backgroundColor: isDark ? 'rgba(34,211,238,0.12)' : '#e0f2fe',
                    },
                  ]}
                >
                  <Text style={{ fontSize: 10, fontWeight: '700', color: isDark ? '#22d3ee' : '#0369a1' }}>
                    {selectedTopics.length} active
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.topicsHeaderRight}>
              {selectedTopics.length > 0 && (
                <TouchableOpacity
                  onPress={clearTopics}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.topicsClearBtn}
                >
                  <Ionicons name="close-circle-outline" size={16} color={isDark ? '#94a3b8' : '#64748b'} />
                  <Text style={[styles.topicsClearText, { color: isDark ? '#94a3b8' : '#64748b' }]}>Clear</Text>
                </TouchableOpacity>
              )}
              <Ionicons
                name={categoriesOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
                size={14}
                color={isDark ? '#64748b' : '#94a3b8'}
              />
            </View>
          </TouchableOpacity>

          {/* Expandable grid */}
          {categoriesOpen && (
            <View style={styles.topicsGrid}>
              {tagFilters
                .filter((t) => t.id !== 'all' && t.id !== 'mine')
                .map((tag) => {
                  const isActive = selectedTopics.includes(tag.id);
                  const iconName = getCategoryIcon(tag.slug, tag.label);
                  const iconColor = isActive ? '#22d3ee' : (isDark ? '#94a3b8' : '#64748b');
                  return (
                    <TouchableOpacity
                      key={tag.id}
                      activeOpacity={0.85}
                      onPress={() => toggleTopic(tag.id)}
                      style={[
                        styles.topicChip,
                        isActive
                          ? { borderColor: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.18)' }
                          : { borderColor: colors.chipBorder, backgroundColor: isDark ? 'rgba(2,6,23,0.45)' : '#f8fafc' },
                      ]}
                    >
                      <Ionicons name={iconName} size={13} color={iconColor} />
                      <Text style={[styles.topicChipLabel, { color: isActive ? '#22d3ee' : colors.text }]} numberOfLines={1}>
                        {tag.label}
                      </Text>
                      {isActive && <Ionicons name="checkmark" size={11} color="#22d3ee" />}
                    </TouchableOpacity>
                  );
                })}
            </View>
          )}
        </View>
      )}

      {!!feedError && (
        <View
          style={[
            styles.errorCard,
            {
              borderColor: isDark ? 'rgba(190,24,93,0.5)' : '#fda4af',
              backgroundColor: isDark ? 'rgba(136,19,55,0.28)' : '#ffe4e6',
            },
          ]}
        >
          <Text style={[styles.errorText, { color: isDark ? '#fecdd3' : '#be123c' }]}>{feedError}</Text>
        </View>
      )}

      {selectedMode === 'mine' && !!myThreadsError && (
        <View
          style={[
            styles.errorCard,
            {
              borderColor: isDark ? 'rgba(190,24,93,0.5)' : '#fda4af',
              backgroundColor: isDark ? 'rgba(136,19,55,0.28)' : '#ffe4e6',
            },
          ]}
        >
          <Text style={[styles.errorText, { color: isDark ? '#fecdd3' : '#be123c' }]}>{myThreadsError}</Text>
        </View>
      )}
    </View>
  ), [categoriesOpen, clearTopics, colors, feedError, isDark, loggedInAs, myAvatarUrl, myThreadsError, onNavigate, refreshNotifications, selectMode, selectedMode, selectedTopics, sessionUser?.id, tagFilters, toggleCategoriesSection, toggleTopic, unreadNotificationsCount]);

  const emptyComponent = useMemo(() => {
    if (loading || (selectedMode === 'mine' && myThreadsLoading)) {
      return (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color="#5eead4" />
        </View>
      );
    }

    return (
      <View style={[styles.emptyCard, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}>
        <Text style={[styles.emptyTitle, { color: colors.title }]}>
          {selectedMode === 'mine' ? 'No threads posted yet' : 'No threads yet'}
        </Text>
        <Text style={[styles.emptyText, { color: colors.text }]}>
          {selectedMode === 'mine'
            ? 'Start your first thread to see it listed here.'
            : selectedTopics.length > 0
            ? 'No threads match the selected topics. Try clearing some filters.'
            : 'Start a thread and share what your team is seeing in the field.'}
        </Text>
      </View>
    );
  }, [colors, loading, myThreadsLoading, selectedMode, selectedTopics.length]);

  const feedContentStyle = useMemo(
    () => ({
      ...styles.feedContent,
      paddingBottom: feedBottomPadding,
    }),
    [feedBottomPadding]
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.screen }}>
    <Animated.View
      style={[
        styles.screen,
        {
          opacity: screenAnim,
          transform: [
            {
              translateY: screenAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [14, 0],
              }),
            },
          ],
        },
      ]}
    >
      <AnimatedFlatList
        data={filteredThreads}
        keyExtractor={keyExtractor}
        renderItem={renderFeedItem}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={emptyComponent}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.feedFooterLoader} color="#5eead4" /> : null}
        contentContainerStyle={feedContentStyle}
        showsVerticalScrollIndicator={false}
        refreshing={(loading && !loadingMore) || (selectedMode === 'mine' && myThreadsLoading)}
        onRefresh={handleRefresh}
        onEndReached={selectedMode === 'all' && selectedTopics.length === 0 ? loadMoreThreads : undefined}
        onEndReachedThreshold={0.35}
        initialNumToRender={5}
        maxToRenderPerBatch={6}
        windowSize={7}
        updateCellsBatchingPeriod={16}
        removeClippedSubviews={Platform.OS === 'android'}
      />

      <TouchableOpacity
        activeOpacity={0.88}
        onPress={() => setComposeVisible(true)}
        style={[styles.fab, { bottom: fabBottomOffset }]}
      >
        <LottieView source={forumAnim} autoPlay loop style={styles.fabAnim} />
        <Text style={styles.fabLabel}>Start a thread</Text>
      </TouchableOpacity>

      <ForumNotificationsModal
        visible={notificationsVisible}
        onClose={() => setNotificationsVisible(false)}
        notifications={notifications}
        notificationsLoading={notificationsLoading}
        notificationsError={notificationsError}
        notificationsBusyId={notificationsBusyId}
        onOpenNotification={handleOpenNotification}
        colors={colors}
        isDark={isDark}
      />

      <Modal visible={composeVisible} animationType="slide" transparent={false} presentationStyle="fullScreen" onRequestClose={() => setComposeVisible(false)}>
        <SafeAreaView style={[styles.flex1, { backgroundColor: colors.modalBg }]}>
          <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

            {/* ── Compose hero header ────────────────────────────────── */}
            <View
              style={[
                styles.composeHeader,
                {
                  borderBottomColor: isDark ? 'rgba(12,74,110,0.6)' : '#e2e8f0',
                  backgroundColor: isDark ? 'rgba(2,6,23,0.92)' : '#ffffff',
                },
              ]}
            >
              {/* Slim top bar: title + close */}
              <View style={styles.composeHeaderTopRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.composeHeroTitle, { color: colors.title }]}>Start a Thread</Text>
                  <Text style={[styles.composeHeroSub, { color: colors.muted }]}>Share your thoughts to the community!</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setComposeVisible(false)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={[
                    styles.composeCloseBtn,
                    {
                      borderColor: isDark ? 'rgba(100,116,139,0.4)' : '#e2e8f0',
                      backgroundColor: isDark ? 'rgba(51,65,85,0.5)' : '#f1f5f9',
                    },
                  ]}
                >
                  <Ionicons name="close" size={18} color={isDark ? '#94a3b8' : '#475569'} />
                </TouchableOpacity>
              </View>

              {/* Author identity row */}
              <View
                style={[
                  styles.composeAuthorRow,
                  {
                    borderColor: isDark ? 'rgba(12,74,110,0.55)' : '#e2e8f0',
                    backgroundColor: isDark ? 'rgba(15,23,42,0.6)' : '#f8fafc',
                  },
                ]}
              >
                <View
                  style={[
                    styles.composeHeaderAvatar,
                    {
                      borderColor: isDark ? 'rgba(30,64,175,0.65)' : '#cbd5e1',
                      backgroundColor: isDark ? 'rgba(2,6,23,0.75)' : '#f1f5f9',
                    },
                  ]}
                >
                  {myAvatarUrl ? (
                    <Image source={{ uri: myAvatarUrl }} style={styles.composeHeaderAvatarImg} />
                  ) : (
                    <Text style={[styles.composeHeaderAvatarInitials, { color: isDark ? '#dbeafe' : '#1e293b' }]}>
                      {buildInitials(loggedInAs)}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.composeHeaderName, { color: colors.title }]}>{loggedInAs}</Text>
                  <View style={styles.composeHeaderSubRow}>
                    <Ionicons name="earth-outline" size={11} color={isDark ? '#38bdf8' : '#0ea5e9'} />
                    <Text style={[styles.composeHeaderSub, { color: isDark ? '#38bdf8' : '#0ea5e9' }]}>Posting to Community</Text>
                  </View>
                </View>
                <View style={[styles.composeAuthorBadge, { backgroundColor: isDark ? 'rgba(14,165,233,0.12)' : 'rgba(14,165,233,0.08)' }]}>
                  <Ionicons name="people-outline" size={13} color="#0ea5e9" />
                  <Text style={[styles.composeAuthorBadgeText, { color: '#0ea5e9' }]}>Public</Text>
                </View>
              </View>
            </View>

            <ScrollView
              style={styles.modalContent}
              contentContainerStyle={styles.composeScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {/* ── Thread title ─────────────────────────────────────── */}
              <View
                style={[
                  styles.composeInputBlock,
                  {
                    borderColor: colors.inputBorder,
                    backgroundColor: isDark ? 'rgba(2,6,23,0.55)' : '#ffffff',
                  },
                ]}
              >
                <View style={styles.composeFieldHeader}>
                  <View style={styles.composeFieldIcon}>
                    <Ionicons name="pencil-outline" size={13} color="#38bdf8" />
                  </View>
                  <Text style={[styles.composeFieldLabel, { color: '#38bdf8' }]}>Thread title</Text>
                  <Text style={[styles.composeCharCount, { color: colors.subtle }]}>
                    {composeTitle.length}/120
                  </Text>
                </View>
                <TextInput
                  value={composeTitle}
                  onChangeText={(t) => setComposeTitle(t.slice(0, 120))}
                  placeholder="What's on your mind?"
                  placeholderTextColor={isDark ? '#475569' : '#94a3b8'}
                  style={[styles.composeInput, { color: colors.inputText }]}
                  maxLength={120}
                />
              </View>

              {/* ── Thread body ──────────────────────────────────────── */}
              <View
                style={[
                  styles.composeInputBlock,
                  {
                    borderColor: colors.inputBorder,
                    backgroundColor: isDark ? 'rgba(2,6,23,0.55)' : '#ffffff',
                  },
                ]}
              >
                <View style={styles.composeFieldHeader}>
                  <View style={styles.composeFieldIcon}>
                    <Ionicons name="document-text-outline" size={13} color="#38bdf8" />
                  </View>
                  <Text style={[styles.composeFieldLabel, { color: '#38bdf8' }]}>Details</Text>
                  <Text style={[styles.composeCharCount, { color: colors.subtle }]}>
                    {composeBody.length}/1000
                  </Text>
                </View>
                <TextInput
                  value={composeBody}
                  onChangeText={(t) => setComposeBody(t.slice(0, 1000))}
                  placeholder="Share your observations, data, or questions. The more context the better."
                  placeholderTextColor={isDark ? '#475569' : '#94a3b8'}
                  multiline
                  textAlignVertical="top"
                  style={[styles.composeTextArea, { color: colors.inputText }]}
                  maxLength={1000}
                />
              </View>

              {/* ── Categories ───────────────────────────────────────── */}
              <View
                style={[
                  styles.composeInputBlock,
                  {
                    borderColor: colors.inputBorder,
                    backgroundColor: isDark ? 'rgba(2,6,23,0.55)' : '#ffffff',
                  },
                ]}
              >
                <View style={styles.composeFieldHeader}>
                  <View style={styles.composeFieldIcon}>
                    <Ionicons name="pricetags-outline" size={13} color="#38bdf8" />
                  </View>
                  <Text style={[styles.composeFieldLabel, { color: '#38bdf8' }]}>Categories</Text>
                  <View
                    style={[
                      styles.composeCatBadge,
                      {
                        borderColor: composeCategories.length > 0
                          ? 'rgba(34,211,238,0.5)'
                          : (isDark ? 'rgba(100,116,139,0.4)' : '#e2e8f0'),
                        backgroundColor: composeCategories.length > 0
                          ? 'rgba(34,211,238,0.12)'
                          : (isDark ? 'rgba(51,65,85,0.4)' : '#f8fafc'),
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.composeCatBadgeText,
                        { color: composeCategories.length > 0 ? '#22d3ee' : colors.muted },
                      ]}
                    >
                      {composeCategories.length}/{MAX_CATEGORIES}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.composeFieldHint, { color: colors.subtle }]}>Pick up to {MAX_CATEGORIES} topics that best describe your thread.</Text>
                <View style={styles.categoriesWrap}>
                  {categories.map((category) => {
                    const active = composeCategories.includes(category.id);
                    const iconName = getCategoryIcon(category.slug, category.label);
                    const iconColor = active ? '#22d3ee' : (isDark ? '#94a3b8' : '#64748b');
                    return (
                      <TouchableOpacity
                        key={category.id}
                        onPress={() => toggleComposeCategory(category.id)}
                        style={[
                          styles.categoryChip,
                          active
                            ? { borderColor: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.18)' }
                            : { borderColor: colors.chipBorder, backgroundColor: isDark ? 'rgba(2,6,23,0.45)' : '#f8fafc' },
                        ]}
                      >
                        <Ionicons name={iconName} size={12} color={iconColor} />
                        <Text style={[styles.categoryChipText, { color: active ? '#22d3ee' : colors.text }]}>{category.label}</Text>
                        {active && <Ionicons name="checkmark" size={10} color="#22d3ee" />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* ── Error banner ─────────────────────────────────────── */}
              {!!composeError && (
                <View
                  style={[
                    styles.composeErrorBanner,
                    {
                      borderColor: isDark ? 'rgba(239,68,68,0.45)' : '#fca5a5',
                      backgroundColor: isDark ? 'rgba(127,29,29,0.35)' : '#fef2f2',
                    },
                  ]}
                >
                  <View style={[styles.composeErrorIconWrap, { backgroundColor: isDark ? 'rgba(239,68,68,0.2)' : '#fee2e2' }]}>
                    <Ionicons name="alert-circle" size={16} color={isDark ? '#f87171' : '#ef4444'} />
                  </View>
                  <Text style={[styles.composeErrorText, { color: isDark ? '#fca5a5' : '#b91c1c' }]}>{composeError}</Text>
                </View>
              )}

              {/* ── Post button ──────────────────────────────────────── */}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleCreateThread}
                disabled={composeLoading}
                style={[
                  styles.composePostBtn,
                  composeLoading
                    ? { backgroundColor: isDark ? '#1e293b' : '#e2e8f0' }
                    : { backgroundColor: '#0ea5e9' },
                ]}
              >
                {composeLoading ? (
                  <ActivityIndicator color={isDark ? '#94a3b8' : '#64748b'} />
                ) : (
                  <>
                    <Ionicons name="send" size={15} color="#ffffff" />
                    <Text style={styles.composePostBtnText}>Post Thread</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* ── Community note ───────────────────────────────────── */}
              <View style={styles.composeFooterNote}>
                <Ionicons name="shield-checkmark-outline" size={12} color={isDark ? '#475569' : '#94a3b8'} />
                <Text style={[styles.composeFooterNoteText, { color: isDark ? '#475569' : '#94a3b8' }]}>
                  Posts are visible to all community members. Keep discussions respectful.
                </Text>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      <Modal visible={threadModalVisible} transparent animationType="slide">
        <View style={[styles.modalBackdrop, { backgroundColor: colors.modalBg }]}>
          <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.modalTopBar}>
              <Text style={[styles.modalTitle, { color: colors.title }]}>Thread</Text>
              <TouchableOpacity
                onPress={closeThread}
                style={[styles.closeButton, { borderColor: colors.chipBorder, backgroundColor: colors.chipBg }]}
              >
                <Text style={[styles.closeButtonText, { color: colors.text }]}>Close</Text>
              </TouchableOpacity>
            </View>

            {!!activeThread && (
              <FlatList
                data={threadPosts}
                keyExtractor={keyExtractor}
                style={styles.modalContent}
                contentContainerStyle={styles.threadContent}
                removeClippedSubviews={Platform.OS === 'android'}
                initialNumToRender={6}
                maxToRenderPerBatch={8}
                windowSize={8}
                ListHeaderComponent={
                  <View style={[styles.threadHeaderCard, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}>
                    <View style={styles.rowBetweenStart}>
                      <View style={styles.rowStart}>
                        <Avatar
                          avatarUrl={activeThread.authorAvatar}
                          name={activeThread.authorName}
                          isDark={isDark}
                          size={44}
                        />
                        <View>
                          <Text style={[styles.authorName, { color: colors.title }]}>{activeThread.authorName}</Text>
                          <Text style={[styles.mutedText, { color: colors.muted }]}>{activeThread.authorOrg || 'Community'}</Text>
                        </View>
                      </View>
                      <Text style={[styles.mutedText, { color: colors.subtle }]}>{formatRelativeTime(activeThread.created_at)}</Text>
                    </View>

                    <Text style={[styles.threadTitle, { color: colors.title }]}>{activeThread.title}</Text>
                    <Text style={[styles.threadBody, { color: colors.text }]}>{activeThread.body}</Text>

                    <View style={styles.tagWrap}>
                      {(activeThread.categories || []).map((tag) => (
                        <View
                          key={tag.id}
                          style={[
                            styles.tag,
                            {
                              borderColor: isDark ? 'rgba(56,189,248,0.45)' : '#7dd3fc',
                              backgroundColor: isDark ? 'rgba(14,116,144,0.3)' : '#e0f2fe',
                            },
                          ]}
                        >
                          <Text style={[styles.tagText, { color: isDark ? '#bae6fd' : '#0369a1' }]}>#{tag.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                }
                renderItem={({ item }) => (
                  <View
                    style={[
                      styles.replyCard,
                      item.id === highlightedPostId
                        ? {
                            borderColor: '#22d3ee',
                            backgroundColor: isDark ? 'rgba(8,47,73,0.45)' : '#ecfeff',
                          }
                        : { borderColor: colors.cardBorder, backgroundColor: colors.card },
                    ]}
                  >
                    <View style={styles.rowBetweenStart}>
                      <View style={styles.rowStart}>
                        <Avatar avatarUrl={item.authorAvatar} name={item.authorName} isDark={isDark} size={40} />
                        <View>
                          <Text style={[styles.replyAuthor, { color: colors.title }]}>{item.authorName}</Text>
                          <Text style={[styles.mutedText, { color: colors.muted }]}>{item.authorOrg || 'Community'}</Text>
                        </View>
                      </View>
                      <Text style={[styles.mutedText, { color: colors.subtle }]}>{formatRelativeTime(item.created_at)}</Text>
                    </View>

                    <Text style={[styles.replyBody, { color: colors.text }]}>{item.body}</Text>

                    <View style={styles.replyActionsRow}>
                      <View style={styles.rowStartGapLarge}>
                        <TouchableOpacity
                          activeOpacity={0.8}
                          onPress={() => toggleLike(item)}
                          disabled={likeBusyId === item.id}
                          style={styles.rowStartGapSmall}
                        >
                          <Text
                            style={[
                              styles.replyAction,
                              {
                                color: item.userLiked
                                  ? isDark
                                    ? '#fecdd3'
                                    : '#be123c'
                                  : isDark
                                  ? '#fda4af'
                                  : '#e11d48',
                              },
                            ]}
                          >
                            {item.userLiked ? '♥' : '♡'}
                          </Text>
                          <Text style={[styles.replyCount, { color: colors.text }]}>{item.likeCount}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity activeOpacity={0.8} onPress={() => setReplyTarget(item)} style={styles.rowStartGapSmall}>
                          <Text style={[styles.replyAction, { color: '#38bdf8' }]}>↩</Text>
                        </TouchableOpacity>
                      </View>

                      {!!item.parent_post_id && <Text style={[styles.mutedText, { color: colors.subtle }]}>↩</Text>}
                    </View>
                  </View>
                )}
                ListEmptyComponent={
                  threadLoading ? (
                    <View style={styles.emptyWrap}>
                      <ActivityIndicator color="#5eead4" />
                    </View>
                  ) : (
                    <View style={[styles.emptyCard, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}>
                      <Text style={[styles.emptyText, { color: colors.text }]}>No replies yet. Be the first to respond.</Text>
                    </View>
                  )
                }
                ListFooterComponent={
                  <View style={[styles.replyComposer, { borderColor: colors.inputBorder, backgroundColor: colors.inputBg }]}>
                    {!!replyTarget && (
                      <View style={styles.replyTargetRow}>
                        <Text style={styles.replyingToText}>Replying to {replyTarget.authorName}</Text>
                        <TouchableOpacity onPress={() => setReplyTarget(null)}>
                          <Text style={[styles.mutedText, { color: colors.muted }]}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    <TextInput
                      value={replyText}
                      onChangeText={setReplyText}
                      placeholder="Write a reply"
                      placeholderTextColor={isDark ? '#94a3b8' : '#64748b'}
                      multiline
                      textAlignVertical="top"
                      style={[styles.replyInput, { color: colors.inputText }]}
                    />

                    {!!replyError && <Text style={[styles.replyErrorText, { color: isDark ? '#fecdd3' : '#be123c' }]}>{replyError}</Text>}

                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={handleSendReply}
                      disabled={replyLoading}
                      style={[styles.primaryButton, replyLoading ? { backgroundColor: '#334155' } : { backgroundColor: '#22d3ee' }]}
                    >
                      {replyLoading ? (
                        <ActivityIndicator color="#0f172a" />
                      ) : (
                        <Text style={styles.primaryButtonText}>Send reply</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                }
              />
            )}
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex1: { flex: 1 },
  headerWrap: { gap: 18 },
  topBar: {
    paddingTop: 48,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kicker: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 2.8,
    color: '#0ea5e9',
  },
  greetingRow: {
    marginHorizontal: 20,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  greetingAvatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  greetingAvatarImage: { width: 46, height: 46 },
  greetingAvatarInitials: { fontSize: 16, fontWeight: '700' },
  greetingTextWrap: { flex: 1 },
  greetingHi: { fontSize: 11, fontWeight: '500' },
  greetingName: { fontSize: 16, fontWeight: '700', marginTop: 1 },
  greetingBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  greetingBadgeText: { fontSize: 11, fontWeight: '700' },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonText: { fontSize: 20, fontWeight: '600' },
  iconButtonSpacer: { width: 40, height: 40 },
  notificationBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 17,
    height: 17,
    borderRadius: 999,
    paddingHorizontal: 4,
    backgroundColor: '#f43f5e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadgeText: { fontSize: 9, fontWeight: '700', color: '#ffffff' },
  errorCard: {
    marginHorizontal: 20,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: { fontSize: 12 },
  feedContent: { paddingBottom: 128, gap: 16 },
  emptyWrap: { alignItems: 'center', paddingVertical: 28 },
  feedFooterLoader: { paddingVertical: 18 },
  emptyCard: {
    marginHorizontal: 20,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  emptyTitle: { fontSize: 14, fontWeight: '700' },
  emptyText: { marginTop: 8, fontSize: 12, lineHeight: 18 },
  fab: {
    position: 'absolute',
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(94,234,212,0.45)',
    backgroundColor: 'rgba(94,234,212,0.88)',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  fabAnim: { width: 24, height: 24, marginRight: 8 },
  fabLabel: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  modalBackdrop: { flex: 1 },
  modalTopBar: {
    paddingTop: 48,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  closeButton: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  closeButtonText: { fontSize: 12, fontWeight: '500' },
  modalContent: { paddingHorizontal: 20 },
  notificationsListContent: { paddingTop: 14, paddingBottom: 24, gap: 12 },
  modalContentContainer: { paddingBottom: 24 },
  notificationCard: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  notificationHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  notificationMainRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  notificationTextWrap: { flex: 1, minWidth: 0 },
  notificationTime: {
    fontSize: 11,
    textAlign: 'right',
    flexShrink: 0,
    maxWidth: 52,
    marginTop: 2,
  },
  notificationTitle: { fontSize: 13, fontWeight: '700' },
  notificationBody: { marginTop: 4, fontSize: 12, lineHeight: 17 },
  notificationFooter: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notificationOpenHint: { fontSize: 11, fontWeight: '600' },
  notificationDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#22d3ee',
  },
  inputCard: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '600',
  },
  input: { marginTop: 8, fontSize: 14 },
  textArea: { marginTop: 8, minHeight: 120, fontSize: 14 },
  // ── Compose modal ────────────────────────────────────────────────
  composeHeader: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    flexDirection: 'column',
    gap: 12,
    borderBottomWidth: 1,
  },
  composeHeroTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  composeHeroSub: {
    fontSize: 12,
    marginTop: 2,
  },
  composeAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  composeAuthorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  composeAuthorBadgeText: { fontSize: 11, fontWeight: '600' },
  composeHeaderAvatar: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  composeHeaderAvatarImg: { width: 42, height: 42 },
  composeHeaderAvatarInitials: { fontSize: 15, fontWeight: '700' },
  composeHeaderName: { fontSize: 15, fontWeight: '700' },
  composeHeaderSubRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  composeHeaderSub: { fontSize: 11, fontWeight: '500' },
  composeCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composeHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  composeScrollContent: { paddingTop: 18, paddingBottom: 40, gap: 12 },
  composeInputBlock: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
  },
  composeFieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  composeFieldIcon: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(56,189,248,0.12)',
  },
  composeFieldLabel: {
    flex: 1,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    fontWeight: '700',
  },
  composeCharCount: { fontSize: 11, fontWeight: '500' },
  composeInput: { fontSize: 15, lineHeight: 22, paddingVertical: 0 },
  composeTextArea: { fontSize: 14, lineHeight: 22, minHeight: 110, paddingVertical: 0 },
  composeFieldHint: { fontSize: 12, lineHeight: 17, marginBottom: 10 },
  composeCatBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  composeCatBadgeText: { fontSize: 10, fontWeight: '700' },
  composeErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  composeErrorIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composeErrorText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  composePostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  composePostBtnText: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
  composeFooterNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  composeFooterNoteText: { flex: 1, fontSize: 11, lineHeight: 16 },
  categoriesSection: { marginTop: 18 },
  categoriesSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  categoriesCountBadge: { fontSize: 11, fontWeight: '600' },
  categoriesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 5,
  },
  categoryChipIcon: { fontSize: 13 }, // kept for layout spacing
  categoryChipText: { fontSize: 12, fontWeight: '500' },
  // ── Quick filter row ─────────────────────────────────────────────
  quickFiltersRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
  },
  quickFilterBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 10,
    gap: 7,
  },
  quickFilterLabel: { fontSize: 13, fontWeight: '600' },
  // ── Topics collapsable card ───────────────────────────────────────
  topicsCard: {
    marginHorizontal: 20,
    borderWidth: 1,
    borderRadius: 20,
    overflow: 'hidden',
  },
  topicsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  topicsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topicsHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topicsClearBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  topicsClearText: { fontSize: 11, fontWeight: '500' },
  topicsHeaderTitle: { fontSize: 13, fontWeight: '700' },
  topicsActivePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  topicsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  topicChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 5,
  },
  topicChipLabel: { fontSize: 12, fontWeight: '500', maxWidth: 100 },
  primaryButton: {
    marginTop: 18,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  primaryButtonText: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  card: {
    marginHorizontal: 20,
    borderRadius: 28,
    borderWidth: 1,
    padding: 20,
  },
  rowBetweenStart: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  rowStart: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowStartGapLarge: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  rowStartGapSmall: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  avatarText: { fontSize: 15, fontWeight: '700' },
  authorName: { fontSize: 15, fontWeight: '700' },
  mutedText: { fontSize: 11 },
  threadTitle: { marginTop: 14, fontSize: 16, fontWeight: '700' },
  threadBody: { marginTop: 8, fontSize: 13, lineHeight: 20 },
  tagWrap: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  tagText: { fontSize: 11 },
  statsRow: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statLabel: { fontSize: 12, fontWeight: '700' },
  statValue: { fontSize: 12 },
  deleteThreadText: { fontSize: 12, fontWeight: '700', color: '#fb7185' },
  openThreadText: { fontSize: 12, fontWeight: '700', color: '#22d3ee' },
  threadContent: { paddingBottom: 22 },
  threadHeaderCard: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 22,
    padding: 16,
  },
  replyCard: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
  },
  replyAuthor: { fontSize: 14, fontWeight: '700' },
  replyBody: { marginTop: 10, fontSize: 13, lineHeight: 20 },
  replyActionsRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  replyAction: { fontSize: 12, fontWeight: '700' },
  replyCount: { fontSize: 12 },
  replyComposer: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  replyTargetRow: {
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  replyingToText: { fontSize: 12, color: '#38bdf8' },
  replyInput: { minHeight: 80, fontSize: 13 },
  replyErrorText: { marginTop: 8, fontSize: 12 },
});

export default CommunityForumScreen;
