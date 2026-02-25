import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Filter from 'bad-words';
import LottieView from 'lottie-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import forumAnim from '../assets/public/forumanim.json';
import { supabase } from '../utils/supabaseClient';
import { useAppTheme } from '../utils/theme';

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList);
const SUPABASE_PROFILES_TABLE = process.env.EXPO_PUBLIC_SUPABASE_PROFILES_TABLE || 'profiles';
const SUPABASE_AVATAR_BUCKET = process.env.EXPO_PUBLIC_SUPABASE_AVATAR_BUCKET || 'avatars';
const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const MAX_CATEGORIES = 5;
const THREADS_BATCH_SIZE = 5;

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

const PostCard = memo(function PostCard({ post, index, stats, onOpenThread, onToggleLike, likeBusyId, canLike, isDark, colors }) {
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
        <TouchableOpacity activeOpacity={0.85} onPress={() => onOpenThread(post)}>
          <Text style={styles.openThreadText}>Open thread {'->'}</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}, (prev, next) => (
  prev.post === next.post
  && prev.index === next.index
  && prev.stats === next.stats
  && prev.likeBusyId === next.likeBusyId
  && prev.canLike === next.canLike
  && prev.isDark === next.isDark
));

const CommunityForumScreen = ({ onNavigate }) => {
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const screenAnim = useRef(new Animated.Value(0)).current;
  const filter = useMemo(() => new Filter(), []);

  const [sessionUser, setSessionUser] = useState(null);
  const [myAvatarUrl, setMyAvatarUrl] = useState('');
  const [myDisplayName, setMyDisplayName] = useState('');
  const [categories, setCategories] = useState([]);
  const [threads, setThreads] = useState([]);
  const [threadStats, setThreadStats] = useState({});
  const [selectedTag, setSelectedTag] = useState('all');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreThreads, setHasMoreThreads] = useState(true);
  const [feedError, setFeedError] = useState('');

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
  const fabBottomOffset = insets.bottom + 92;

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
    const fetchMyProfile = async (user) => {
      if (!user?.id) return;
      try {
        const { data } = await supabase
          .from(SUPABASE_PROFILES_TABLE)
          .select('display_name, avatar_url')
          .eq('id', user.id)
          .maybeSingle();
        if (isMounted) {
          setMyAvatarUrl(normalizeAvatarUrl(data?.avatar_url));
          if (data?.display_name) setMyDisplayName(data.display_name);
        }
      } catch (_err) {
        // non-critical
      }
    };

    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (isMounted) {
        const user = data?.session?.user || null;
        setSessionUser(user);
        fetchMyProfile(user);
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
  }, []);

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
      const mappedCategories = categoryLinks.map((link) => link.forum_categories).filter(Boolean);
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

      const activeCategories = categoryResult.data || [];

      setCategories(activeCategories);
      setThreads(batchResult.hydratedThreads);
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

      setThreads((prev) => [...prev, ...batchResult.hydratedThreads]);
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

  useEffect(() => {
    loadForumData();
  }, [loadForumData]);

  useEffect(() => {
    const channel = supabase
      .channel('forum-thread-likes-feed')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'forum_thread_likes' },
        () => {
          loadForumData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadForumData]);

  const tagFilters = useMemo(() => {
    const dynamic = categories.map((category) => ({
      id: category.id,
      label: category.label,
      slug: category.slug,
    }));
    return [{ id: 'all', label: 'All' }, ...dynamic];
  }, [categories]);

  const loggedInAs = useMemo(() => {
    if (myDisplayName) return myDisplayName;
    const metaName = sessionUser?.user_metadata?.display_name
      || sessionUser?.user_metadata?.name
      || sessionUser?.user_metadata?.username;
    const emailName = sessionUser?.email ? sessionUser.email.split('@')[0] : '';
    return metaName || emailName || 'user';
  }, [myDisplayName, sessionUser]);

  const filteredThreads = useMemo(() => {
    if (selectedTag === 'all') return threads;
    return threads.filter((thread) => (thread.categories || []).some((category) => category.id === selectedTag));
  }, [selectedTag, threads]);

  const containsBadWords = useCallback((text) => {
    if (!text) return false;
    try {
      return filter.isProfane(text);
    } catch (error) {
      console.warn('[Forum] bad-words filter failed:', error?.message || error);
      return false;
    }
  }, [filter]);

  const openThread = useCallback(async (thread) => {
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

      setThreadPosts(enrichedPosts);
    } catch (error) {
      console.warn('[Supabase] thread load failed:', error?.message || error);
      setReplyError('Unable to load thread replies.');
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
  }, []);

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

      setThreadPosts((prev) => [...prev, newPost]);
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

      if (activeThread) {
        setThreadStats((prev) => {
          const current = prev[activeThread.id] || { replies: 0, likes: 0 };
          return {
            ...prev,
            [activeThread.id]: {
              ...current,
              likes: Math.max(0, current.likes + (post.userLiked ? -1 : 1)),
            },
          };
        });
      }
    } catch (error) {
      console.warn('[Supabase] like toggle failed:', error?.message || error);
      setReplyError('Unable to update like right now.');
    } finally {
      setLikeBusyId('');
    }
  }, [activeThread, likeBusyId, sessionUser]);

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

      setThreads((prev) => [newThread, ...prev]);
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

  const onSelectTag = useCallback((tagId) => {
    setSelectedTag(tagId);
  }, []);

  const keyExtractor = useCallback((item) => item.id, []);

  const renderFeedItem = useCallback(({ item, index }) => (
    <PostCard
      post={item}
      index={index}
      stats={threadStats[item.id]}
      onOpenThread={openThread}
      onToggleLike={toggleThreadLike}
      likeBusyId={threadLikeBusyId}
      canLike={!!sessionUser}
      isDark={isDark}
      colors={colors}
    />
  ), [colors, isDark, openThread, sessionUser, threadLikeBusyId, threadStats, toggleThreadLike]);

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

        <View style={styles.iconButtonSpacer} />
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tagsScroll}
        contentContainerStyle={styles.tagsScrollContent}
      >
        {tagFilters.map((tag) => {
          const isActive = selectedTag === tag.id;
          return (
            <TouchableOpacity
              key={tag.id}
              activeOpacity={0.85}
              onPress={() => onSelectTag(tag.id)}
              style={[
                styles.tagFilter,
                isActive
                  ? styles.tagFilterActive
                  : { borderColor: colors.chipBorder, backgroundColor: colors.chipBg },
              ]}
            >
              <Text
                style={[
                  styles.tagFilterText,
                  { color: isActive ? '#22d3ee' : colors.text },
                ]}
              >
                {tag.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

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
    </View>
  ), [colors, feedError, isDark, loggedInAs, onNavigate, onSelectTag, selectedTag, tagFilters]);

  const emptyComponent = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.emptyWrap}>
          <ActivityIndicator color="#5eead4" />
        </View>
      );
    }

    return (
      <View style={[styles.emptyCard, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}>
        <Text style={[styles.emptyTitle, { color: colors.title }]}>No threads yet</Text>
        <Text style={[styles.emptyText, { color: colors.text }]}>Start a thread and share what your team is seeing in the field.</Text>
      </View>
    );
  }, [colors, loading]);

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
        contentContainerStyle={styles.feedContent}
        showsVerticalScrollIndicator={false}
        refreshing={loading && !loadingMore}
        onRefresh={loadForumData}
        onEndReached={loadMoreThreads}
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

      <Modal visible={composeVisible} transparent animationType="slide">
        <View style={[styles.modalBackdrop, { backgroundColor: colors.modalBg }]}>
          <KeyboardAvoidingView style={styles.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.modalTopBar}>
              <Text style={[styles.modalTitle, { color: colors.title }]}>Start a thread</Text>
              <TouchableOpacity
                onPress={() => setComposeVisible(false)}
                style={[styles.closeButton, { borderColor: colors.chipBorder, backgroundColor: colors.chipBg }]}
              >
                <Text style={[styles.closeButtonText, { color: colors.text }]}>Close</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentContainer}>
              <View style={[styles.inputCard, { borderColor: colors.inputBorder, backgroundColor: colors.inputBg }]}>
                <Text style={[styles.inputLabel, { color: '#38bdf8' }]}>Thread title</Text>
                <TextInput
                  value={composeTitle}
                  onChangeText={setComposeTitle}
                  placeholder="Summarize the issue or idea"
                  placeholderTextColor={isDark ? '#94a3b8' : '#64748b'}
                  style={[styles.input, { color: colors.inputText }]}
                />
              </View>

              <View style={[styles.inputCard, { borderColor: colors.inputBorder, backgroundColor: colors.inputBg }]}>
                <Text style={[styles.inputLabel, { color: '#38bdf8' }]}>Details</Text>
                <TextInput
                  value={composeBody}
                  onChangeText={setComposeBody}
                  placeholder="Share context, data points, or questions"
                  placeholderTextColor={isDark ? '#94a3b8' : '#64748b'}
                  multiline
                  textAlignVertical="top"
                  style={[styles.textArea, { color: colors.inputText }]}
                />
              </View>

              <View style={styles.categoriesSection}>
                <Text style={[styles.inputLabel, { color: '#38bdf8' }]}>Categories (up to {MAX_CATEGORIES})</Text>
                <View style={styles.categoriesWrap}>
                  {categories.map((category) => {
                    const active = composeCategories.includes(category.id);
                    return (
                      <TouchableOpacity
                        key={category.id}
                        onPress={() => toggleComposeCategory(category.id)}
                        style={[
                          styles.categoryChip,
                          active
                            ? styles.tagFilterActive
                            : { borderColor: colors.chipBorder, backgroundColor: colors.chipBg },
                        ]}
                      >
                        <Text style={[styles.categoryChipText, { color: active ? '#22d3ee' : colors.text }]}>{category.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {!!composeError && (
                <View
                  style={[
                    styles.errorCard,
                    {
                      borderColor: isDark ? 'rgba(190,24,93,0.5)' : '#fda4af',
                      backgroundColor: isDark ? 'rgba(136,19,55,0.28)' : '#ffe4e6',
                    },
                  ]}
                >
                  <Text style={[styles.errorText, { color: isDark ? '#fecdd3' : '#be123c' }]}>{composeError}</Text>
                </View>
              )}

              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleCreateThread}
                disabled={composeLoading}
                style={[
                  styles.primaryButton,
                  composeLoading ? { backgroundColor: isDark ? '#334155' : '#cbd5e1' } : { backgroundColor: '#22d3ee' },
                ]}
              >
                {composeLoading ? (
                  <ActivityIndicator color={isDark ? '#e2e8f0' : '#0f172a'} />
                ) : (
                  <Text style={styles.primaryButtonText}>Post thread</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
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
                  <View style={[styles.replyCard, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}>
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
  tagsScroll: { paddingLeft: 20 },
  tagsScrollContent: { paddingRight: 20, gap: 10 },
  tagFilter: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  tagFilterActive: {
    borderWidth: 1,
    borderColor: '#22d3ee',
    backgroundColor: 'rgba(34,211,238,0.2)',
  },
  tagFilterText: { fontSize: 13, fontWeight: '500' },
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
  modalContentContainer: { paddingBottom: 24 },
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
  categoriesSection: { marginTop: 18 },
  categoriesWrap: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  categoryChipText: { fontSize: 12, fontWeight: '500' },
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
