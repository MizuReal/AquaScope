import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Animated,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import Filter from 'bad-words';
import { supabase } from '../utils/supabaseClient';
import LottieView from 'lottie-react-native';
import forumAnim from '../assets/public/forumanim.json';
import { useAppTheme } from '../utils/theme';

const HIGHLIGHTS = [
  'AI-assisted water quality insights powered by field data and lab checks.',
  'Automated microbial risk triage with explainable parameter flags.',
  'OCR + fiducial capture streamlines sampling and reporting workflows.',
];

const AnimatedFlatList = Animated.createAnimatedComponent(FlatList);

const SUPABASE_PROFILES_TABLE = process.env.EXPO_PUBLIC_SUPABASE_PROFILES_TABLE || 'profiles';
const MAX_CATEGORIES = 5;

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

const CommunityForumScreen = ({ onNavigate }) => {
  const { isDark } = useAppTheme();
  const heroAnim = useRef(new Animated.Value(0)).current;
  const screenAnim = useRef(new Animated.Value(0)).current;
  const filter = useMemo(() => new Filter(), []);
  const [sessionUser, setSessionUser] = useState(null);
  const [categories, setCategories] = useState([]);
  const [threads, setThreads] = useState([]);
  const [threadStats, setThreadStats] = useState({});
  const [selectedTag, setSelectedTag] = useState('all');
  const [loading, setLoading] = useState(false);
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

  useEffect(() => {
    Animated.timing(heroAnim, {
      toValue: 1,
      duration: 500,
      delay: 100,
      useNativeDriver: true,
    }).start();
  }, [heroAnim]);

  useEffect(() => {
    Animated.timing(screenAnim, {
      toValue: 1,
      duration: 450,
      delay: 40,
      useNativeDriver: true,
    }).start();
  }, [screenAnim]);

  useEffect(() => {
    let isMounted = true;
    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (isMounted) {
        setSessionUser(data?.session?.user || null);
      }
    };
    loadSession();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setSessionUser(session?.user || null);
      }
    });
    return () => {
      isMounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const loadForumData = async () => {
    setLoading(true);
    setFeedError('');
    try {
      const [categoryResult, threadResult] = await Promise.all([
        supabase
          .from('forum_categories')
          .select('id, slug, label, is_active')
          .eq('is_active', true)
          .order('label', { ascending: true }),
        supabase
          .from('forum_threads')
          .select(
            'id, user_id, title, body, created_at, updated_at, forum_thread_categories(category_id, forum_categories(id, slug, label))'
          )
          .order('created_at', { ascending: false }),
      ]);

      if (categoryResult.error) {
        throw categoryResult.error;
      }
      if (threadResult.error) {
        throw threadResult.error;
      }

      const activeCategories = categoryResult.data || [];
      const rawThreads = threadResult.data || [];

      const userIds = Array.from(
        new Set(rawThreads.map((thread) => thread.user_id).filter(Boolean))
      );
      const profilesResult = userIds.length
        ? await supabase
            .from(SUPABASE_PROFILES_TABLE)
            .select('id, display_name, organization, avatar_url')
            .in('id', userIds)
        : { data: [] };

      const profileMap = new Map(
        (profilesResult.data || []).map((profile) => [profile.id, profile])
      );

      const hydratedThreads = rawThreads.map((thread) => {
        const profile = profileMap.get(thread.user_id) || {};
        const categoryLinks = thread.forum_thread_categories || [];
        const mappedCategories = categoryLinks
          .map((link) => link.forum_categories)
          .filter(Boolean);
        return {
          ...thread,
          categories: mappedCategories,
          authorName: profile.display_name || 'Community member',
          authorOrg: profile.organization || '',
          authorAvatar: profile.avatar_url || '',
        };
      });

      const threadIds = hydratedThreads.map((thread) => thread.id);
      let postsData = [];
      if (threadIds.length) {
        const postsResult = await supabase
          .from('forum_posts')
          .select('id, thread_id')
          .in('thread_id', threadIds);
        postsData = postsResult.data || [];
      }

      const repliesCount = postsData.reduce((acc, post) => {
        acc[post.thread_id] = (acc[post.thread_id] || 0) + 1;
        return acc;
      }, {});

      let likesCount = {};
      const postIds = postsData.map((post) => post.id);
      if (postIds.length) {
        const likesResult = await supabase
          .from('forum_post_likes')
          .select('post_id, forum_posts(thread_id)')
          .in('post_id', postIds);
        (likesResult.data || []).forEach((row) => {
          const threadId = row.forum_posts?.thread_id;
          if (!threadId) return;
          likesCount[threadId] = (likesCount[threadId] || 0) + 1;
        });
      }

      const stats = hydratedThreads.reduce((acc, thread) => {
        acc[thread.id] = {
          replies: repliesCount[thread.id] || 0,
          likes: likesCount[thread.id] || 0,
        };
        return acc;
      }, {});

      setCategories(activeCategories);
      setThreads(hydratedThreads);
      setThreadStats(stats);
    } catch (error) {
      console.warn('[Supabase] forum load failed:', error?.message || error);
      setFeedError('Unable to load forum right now.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadForumData();
  }, []);

  const tagFilters = useMemo(() => {
    const dynamic = categories.map((category) => ({
      id: category.id,
      label: category.label,
      slug: category.slug,
    }));
    return [{ id: 'all', label: 'All' }, ...dynamic];
  }, [categories]);

  const filteredThreads = useMemo(() => {
    if (selectedTag === 'all') return threads;
    return threads.filter((thread) =>
      (thread.categories || []).some((category) => category.id === selectedTag)
    );
  }, [threads, selectedTag]);

  const containsBadWords = (text) => {
    if (!text) return false;
    try {
      return filter.isProfane(text);
    } catch (error) {
      console.warn('[Forum] bad-words filter failed:', error?.message || error);
      return false;
    }
  };

  const openThread = async (thread) => {
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
      if (postsResult.error) {
        throw postsResult.error;
      }

      const posts = postsResult.data || [];
      const userIds = Array.from(new Set(posts.map((post) => post.user_id)));
      const profilesResult = userIds.length
        ? await supabase
            .from(SUPABASE_PROFILES_TABLE)
            .select('id, display_name, organization, avatar_url')
            .in('id', userIds)
        : { data: [] };
      const profileMap = new Map(
        (profilesResult.data || []).map((profile) => [profile.id, profile])
      );

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
          authorAvatar: profile.avatar_url || '',
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
  };

  const closeThread = () => {
    setThreadModalVisible(false);
    setActiveThread(null);
    setThreadPosts([]);
    setReplyText('');
    setReplyTarget(null);
    setReplyError('');
  };

  const handleSendReply = async () => {
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
      if (insertResult.error) {
        throw insertResult.error;
      }

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
        authorAvatar: profile.avatar_url || '',
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
          [activeThread.id]: { ...current, replies: current.replies + 1 },
        };
      });
    } catch (error) {
      console.warn('[Supabase] reply insert failed:', error?.message || error);
      setReplyError('Unable to post reply right now.');
    } finally {
      setReplyLoading(false);
    }
  };

  const toggleLike = async (post) => {
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
  };

  const handleCreateThread = async () => {
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
      if (insertResult.error) {
        throw insertResult.error;
      }

      const threadId = insertResult.data.id;
      const categoryPayload = composeCategories.map((categoryId) => ({
        thread_id: threadId,
        category_id: categoryId,
      }));
      if (categoryPayload.length) {
        const { error } = await supabase
          .from('forum_thread_categories')
          .insert(categoryPayload);
        if (error) throw error;
      }

      const profileResult = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .select('id, display_name, organization, avatar_url')
        .eq('id', sessionUser.id)
        .maybeSingle();
      const profile = profileResult.data || {};

      const selectedCategories = categories.filter((category) =>
        composeCategories.includes(category.id)
      );

      const newThread = {
        ...insertResult.data,
        categories: selectedCategories,
        authorName: profile.display_name || 'You',
        authorOrg: profile.organization || '',
        authorAvatar: profile.avatar_url || '',
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
  };

  const toggleComposeCategory = (categoryId) => {
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
  };

  const header = useMemo(
    () => (
      <View className="gap-5">
        <View className="px-5 pt-12 flex-row items-center justify-between">
          <TouchableOpacity
            className={`h-10 w-10 items-center justify-center rounded-2xl border ${isDark ? 'border-sky-900/70 bg-slate-950/70' : 'border-slate-300 bg-slate-100'}`}
            activeOpacity={0.85}
            onPress={() => onNavigate?.('home')}
          >
            <Text className={`text-xl ${isDark ? 'text-sky-100' : 'text-slate-700'}`}>{'<'}</Text>
          </TouchableOpacity>
          <View className="items-center">
            <Text className="text-[12px] uppercase tracking-[3px] text-sky-500">
              Community
            </Text>
            <Text className={`text-[20px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>Forum Feed</Text>
          </View>
          <TouchableOpacity
            className={`rounded-2xl border px-3 py-2 ${
              isDark ? 'border-emerald-600/60 bg-emerald-900/30' : 'border-emerald-300 bg-emerald-100'
            }`}
            activeOpacity={0.85}
            onPress={loadForumData}
          >
            <Text className={`text-[11px] font-semibold uppercase ${isDark ? 'text-emerald-200' : 'text-emerald-800'}`}>
              Refresh
            </Text>
          </TouchableOpacity>
        </View>

        <Animated.View
          style={{
            opacity: heroAnim,
            transform: [
              {
                translateY: heroAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [18, 0],
                }),
              },
            ],
            marginHorizontal: 20,
            borderRadius: 30,
            borderWidth: 1,
            borderColor: isDark ? 'rgba(12,74,110,0.6)' : '#cbd5e1',
            backgroundColor: isDark ? 'rgba(2,6,23,0.9)' : '#ffffff',
            padding: 20,
          }}
        >
          <View className="items-center">
            <LottieView
              source={forumAnim}
              autoPlay
              loop
              style={{ width: 160, height: 160 }}
            />
          </View>
          <Text className="text-[12px] uppercase tracking-wide text-sky-400">
            Collective insights
          </Text>
          <Text className={`mt-2 text-[20px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>
            Share field signals, lab wins, and policy drafts in one flow.
          </Text>
          <View className="mt-4 gap-3">
            {HIGHLIGHTS.map((item) => (
              <View key={item} className="flex-row items-start gap-2">
                <Text className={`text-lg ${isDark ? 'text-emerald-300' : 'text-emerald-600'}`}>-</Text>
                <Text className={`flex-1 text-[13px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{item}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="pl-5"
          contentContainerClassName="pr-5 gap-3"
        >
          {tagFilters.map((tag) => {
            const isActive = selectedTag === tag.id;
            return (
              <TouchableOpacity
                key={tag.id}
                activeOpacity={0.85}
                onPress={() => setSelectedTag(tag.id)}
                className={`rounded-2xl border px-4 py-2 ${
                  isActive
                    ? 'border-aquaaccent bg-aquaaccent/20'
                    : isDark ? 'border-sky-900/70 bg-slate-950/60' : 'border-slate-300 bg-slate-100'
                }`}
              >
                <Text
                  className={`text-[13px] ${
                    isActive ? 'text-aquaaccent' : isDark ? 'text-slate-200' : 'text-slate-700'
                  }`}
                >
                  {tag.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {feedError ? (
          <View
            className={`mx-5 rounded-2xl border px-4 py-3 ${
              isDark ? 'border-rose-900/60 bg-rose-950/40' : 'border-rose-300 bg-rose-100'
            }`}
          >
            <Text className={`text-[12px] ${isDark ? 'text-rose-200' : 'text-rose-700'}`}>{feedError}</Text>
          </View>
        ) : null}
      </View>
    ),
    [heroAnim, onNavigate, tagFilters, selectedTag, feedError, isDark]
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
              outputRange: [16, 0],
            }),
          },
        ],
      }}
    >
      <AnimatedFlatList
        data={filteredThreads}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <PostCard
            post={item}
            index={index}
            stats={threadStats[item.id]}
            onOpenThread={() => openThread(item)}
          />
        )}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: 128, gap: 16 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          loading ? (
            <View className="items-center py-10">
              <ActivityIndicator color="#5eead4" />
            </View>
          ) : (
            <View className={`mx-5 rounded-2xl border px-4 py-6 ${isDark ? 'border-sky-900/60 bg-slate-950/60' : 'border-slate-300 bg-white'}`}>
              <Text className={`text-[14px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>No threads yet</Text>
              <Text className={`mt-2 text-[12px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                Start a thread and share what your team is seeing in the field.
              </Text>
            </View>
          )
        }
      />

      <TouchableOpacity
        activeOpacity={0.85}
        style={{ position: 'absolute', bottom: 32, right: 24, flexDirection: 'row', alignItems: 'center', borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(94,234,212,0.4)', backgroundColor: 'rgba(94,234,212,0.8)', paddingHorizontal: 20, paddingVertical: 12, elevation: 8, shadowColor: 'rgba(12,74,110,0.8)', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6 }}
        onPress={() => setComposeVisible(true)}
      >
        <Text className="mr-2 text-xl text-slate-950">+</Text>
        <Text className="text-[14px] font-semibold text-slate-950">Start a thread</Text>
      </TouchableOpacity>

      <Modal visible={composeVisible} transparent animationType="slide">
        <View className={`flex-1 ${isDark ? 'bg-slate-950/95' : 'bg-slate-100/95'}`}>
          <KeyboardAvoidingView
            className="flex-1"
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View className="px-5 pt-12 flex-row items-center justify-between">
              <Text className={`text-[18px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>Start a thread</Text>
              <TouchableOpacity
                onPress={() => setComposeVisible(false)}
                className={`rounded-2xl border px-3 py-2 ${isDark ? 'border-sky-900/70 bg-slate-950/70' : 'border-slate-300 bg-slate-100'}`}
              >
                <Text className={`text-[12px] ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>Close</Text>
              </TouchableOpacity>
            </View>

            <ScrollView className="px-5" contentContainerClassName="pb-10">
              <View className={`mt-5 rounded-2xl border px-4 py-3 ${isDark ? 'border-sky-900/60 bg-slate-950/60' : 'border-slate-300 bg-white'}`}>
                <Text className={`text-[12px] uppercase tracking-wide ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>
                  Thread title
                </Text>
                <TextInput
                  value={composeTitle}
                  onChangeText={setComposeTitle}
                  placeholder="Summarize the issue or idea"
                  placeholderTextColor={isDark ? '#94a3b8' : '#64748b'}
                  className={`mt-2 text-[14px] ${isDark ? 'text-slate-100' : 'text-slate-800'}`}
                />
              </View>

              <View className={`mt-4 rounded-2xl border px-4 py-3 ${isDark ? 'border-sky-900/60 bg-slate-950/60' : 'border-slate-300 bg-white'}`}>
                <Text className={`text-[12px] uppercase tracking-wide ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>
                  Details
                </Text>
                <TextInput
                  value={composeBody}
                  onChangeText={setComposeBody}
                  placeholder="Share context, data points, or questions"
                  placeholderTextColor={isDark ? '#94a3b8' : '#64748b'}
                  multiline
                  className={`mt-2 min-h-[120px] text-[14px] ${isDark ? 'text-slate-100' : 'text-slate-800'}`}
                />
              </View>

              <View className="mt-5">
                <Text className={`text-[12px] uppercase tracking-wide ${isDark ? 'text-sky-400' : 'text-sky-600'}`}>
                  Categories (up to {MAX_CATEGORIES})
                </Text>
                <View className="mt-3 flex-row flex-wrap gap-2">
                  {categories.map((category) => {
                    const active = composeCategories.includes(category.id);
                    return (
                      <TouchableOpacity
                        key={category.id}
                        onPress={() => toggleComposeCategory(category.id)}
                        className={`rounded-full border px-4 py-2 ${
                          active
                            ? 'border-aquaaccent bg-aquaaccent/20'
                            : isDark ? 'border-sky-900/70 bg-slate-950/60' : 'border-slate-300 bg-slate-100'
                        }`}
                      >
                        <Text
                          className={`text-[12px] ${
                            active ? 'text-aquaaccent' : isDark ? 'text-slate-200' : 'text-slate-700'
                          }`}
                        >
                          {category.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {composeError ? (
                <View
                  className={`mt-4 rounded-2xl border px-4 py-3 ${
                    isDark ? 'border-rose-900/60 bg-rose-950/40' : 'border-rose-300 bg-rose-100'
                  }`}
                >
                  <Text className={`text-[12px] ${isDark ? 'text-rose-200' : 'text-rose-700'}`}>{composeError}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleCreateThread}
                disabled={composeLoading}
                className={`mt-6 items-center rounded-2xl px-4 py-3 ${
                  composeLoading
                    ? isDark
                      ? 'bg-slate-700'
                      : 'bg-slate-300'
                    : 'bg-aquaaccent'
                }`}
              >
                {composeLoading ? (
                  <ActivityIndicator color={isDark ? '#e2e8f0' : '#0f172a'} />
                ) : (
                  <Text className="text-[14px] font-semibold text-slate-950">Post thread</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal visible={threadModalVisible} transparent animationType="slide">
        <View className={`flex-1 ${isDark ? 'bg-slate-950/95' : 'bg-slate-100/95'}`}>
          <KeyboardAvoidingView
            className="flex-1"
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View className="px-5 pt-12 flex-row items-center justify-between">
              <Text className={`text-[18px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>Thread</Text>
              <TouchableOpacity
                onPress={closeThread}
                className={`rounded-2xl border px-3 py-2 ${isDark ? 'border-sky-900/70 bg-slate-950/70' : 'border-slate-300 bg-slate-100'}`}
              >
                <Text className={`text-[12px] ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>Close</Text>
              </TouchableOpacity>
            </View>

            {activeThread ? (
              <FlatList
                data={threadPosts}
                keyExtractor={(item) => item.id}
                className="px-5"
                contentContainerClassName="pb-24"
                ListHeaderComponent={
                  <View
                    className={`mt-5 rounded-[24px] border p-4 ${
                      isDark ? 'border-sky-900/70 bg-slate-950/60' : 'border-slate-300 bg-white'
                    }`}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-3">
                        <View
                          className={`h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border ${
                            isDark ? 'border-sky-800/70 bg-slate-950/70' : 'border-slate-300 bg-slate-100'
                          }`}
                        >
                          {activeThread.authorAvatar ? (
                            <Image
                              source={{ uri: activeThread.authorAvatar }}
                              className="h-11 w-11"
                            />
                          ) : (
                            <Text className={`text-[14px] font-semibold ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>
                              {buildInitials(activeThread.authorName)}
                            </Text>
                          )}
                        </View>
                        <View>
                          <Text className={`text-[15px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>
                            {activeThread.authorName}
                          </Text>
                          <Text className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                            {activeThread.authorOrg || 'Community'}
                          </Text>
                        </View>
                      </View>
                      <Text className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
                        {formatRelativeTime(activeThread.created_at)}
                      </Text>
                    </View>

                    <Text className={`mt-4 text-[16px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>
                      {activeThread.title}
                    </Text>
                    <Text className={`mt-2 text-[13px] leading-5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      {activeThread.body}
                    </Text>

                    <View className="mt-4 flex-row flex-wrap gap-2">
                      {(activeThread.categories || []).map((tag) => (
                        <View
                          key={tag.id}
                          className={`rounded-full border px-3 py-1 ${
                            isDark ? 'border-sky-800/50 bg-sky-900/30' : 'border-sky-300 bg-sky-100'
                          }`}
                        >
                          <Text className={`text-[11px] ${isDark ? 'text-sky-200' : 'text-sky-700'}`}>#{tag.label}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                }
                renderItem={({ item }) => (
                  <View
                    className={`mt-4 rounded-[22px] border p-4 ${
                      isDark ? 'border-sky-900/70 bg-slate-950/60' : 'border-slate-300 bg-white'
                    }`}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-3">
                        <View
                          className={`h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border ${
                            isDark ? 'border-sky-800/70 bg-slate-950/70' : 'border-slate-300 bg-slate-100'
                          }`}
                        >
                          {item.authorAvatar ? (
                            <Image source={{ uri: item.authorAvatar }} className="h-10 w-10" />
                          ) : (
                            <Text className={`text-[13px] font-semibold ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>
                              {buildInitials(item.authorName)}
                            </Text>
                          )}
                        </View>
                        <View>
                          <Text className={`text-[14px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>
                            {item.authorName}
                          </Text>
                          <Text className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                            {item.authorOrg || 'Community'}
                          </Text>
                        </View>
                      </View>
                      <Text className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>
                        {formatRelativeTime(item.created_at)}
                      </Text>
                    </View>

                    <Text className={`mt-3 text-[13px] leading-5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                      {item.body}
                    </Text>

                    <View className="mt-4 flex-row items-center justify-between">
                      <View className="flex-row items-center gap-4">
                        <TouchableOpacity
                          activeOpacity={0.8}
                          onPress={() => toggleLike(item)}
                          disabled={likeBusyId === item.id}
                          className="flex-row items-center gap-1"
                        >
                          <Text
                            className={`text-[12px] font-semibold ${
                              item.userLiked
                                ? isDark
                                  ? 'text-rose-200'
                                  : 'text-rose-700'
                                : isDark
                                ? 'text-rose-300'
                                : 'text-rose-600'
                            }`}
                          >
                            Like
                          </Text>
                          <Text className={`text-[12px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{item.likeCount}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          activeOpacity={0.8}
                          onPress={() => setReplyTarget(item)}
                          className="flex-row items-center gap-1"
                        >
                          <Text className="text-[12px] font-semibold text-sky-300">Reply</Text>
                        </TouchableOpacity>
                      </View>
                      {item.parent_post_id ? (
                        <Text className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>Reply</Text>
                      ) : null}
                    </View>
                  </View>
                )}
                ListEmptyComponent={
                  threadLoading ? (
                    <View className="items-center py-8">
                      <ActivityIndicator color="#5eead4" />
                    </View>
                  ) : (
                    <View
                      className={`mt-4 rounded-2xl border px-4 py-6 ${
                        isDark ? 'border-sky-900/60 bg-slate-950/60' : 'border-slate-300 bg-white'
                      }`}
                    >
                      <Text className={`text-[13px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                        No replies yet. Be the first to respond.
                      </Text>
                    </View>
                  )
                }
                ListFooterComponent={
                  <View
                    className={`mt-6 rounded-2xl border px-4 py-4 ${
                      isDark ? 'border-sky-900/60 bg-slate-950/60' : 'border-slate-300 bg-white'
                    }`}
                  >
                    {replyTarget ? (
                      <View className="mb-3 flex-row items-center justify-between">
                        <Text className="text-[12px] text-sky-300">
                          Replying to {replyTarget.authorName}
                        </Text>
                        <TouchableOpacity onPress={() => setReplyTarget(null)}>
                          <Text className={`text-[12px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                    <TextInput
                      value={replyText}
                      onChangeText={setReplyText}
                      placeholder="Write a reply"
                      placeholderTextColor={isDark ? '#94a3b8' : '#64748b'}
                      multiline
                      className={`min-h-[80px] text-[13px] ${isDark ? 'text-slate-100' : 'text-slate-800'}`}
                    />
                    {replyError ? (
                      <Text className={`mt-2 text-[12px] ${isDark ? 'text-rose-200' : 'text-rose-700'}`}>{replyError}</Text>
                    ) : null}
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={handleSendReply}
                      disabled={replyLoading}
                      className={`mt-4 items-center rounded-2xl px-4 py-3 ${
                        replyLoading ? 'bg-slate-700' : 'bg-aquaaccent'
                      }`}
                    >
                      {replyLoading ? (
                        <ActivityIndicator color="#0f172a" />
                      ) : (
                        <Text className="text-[14px] font-semibold text-slate-950">Send reply</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                }
              />
            ) : null}
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </Animated.View>
  );
};

const PostCard = ({ post, index, stats, onOpenThread }) => {
  const { isDark } = useAppTheme();
  const fade = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 350,
      delay: 200 + index * 120,
      useNativeDriver: true,
    }).start();
    Animated.timing(translate, {
      toValue: 0,
      duration: 350,
      delay: 200 + index * 120,
      useNativeDriver: true,
    }).start();
  }, [fade, translate, index]);

  return (
    <Animated.View
      style={{
        opacity: fade,
        transform: [{ translateY: translate }],
        marginHorizontal: 20,
        borderRadius: 28,
        borderWidth: 1,
        borderColor: isDark ? 'rgba(12,74,110,0.7)' : '#cbd5e1',
        backgroundColor: isDark ? 'rgba(2,6,23,0.6)' : '#ffffff',
        padding: 20,
      }}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-3">
          <View
            className={`h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border ${
              isDark ? 'border-sky-800/70 bg-slate-950/70' : 'border-slate-300 bg-slate-100'
            }`}
          >
            {post.authorAvatar ? (
              <Image source={{ uri: post.authorAvatar }} className="h-12 w-12" />
            ) : (
              <Text className={`text-[15px] font-semibold ${isDark ? 'text-sky-100' : 'text-slate-800'}`}>
                {buildInitials(post.authorName)}
              </Text>
            )}
          </View>
          <View>
            <Text className={`text-[15px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>{post.authorName}</Text>
            <Text className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              {post.authorOrg || 'Community'}
            </Text>
          </View>
        </View>
        <Text className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-600'}`}>{formatRelativeTime(post.created_at)}</Text>
      </View>

      <Text className={`mt-4 text-[16px] font-semibold ${isDark ? 'text-sky-50' : 'text-slate-900'}`}>{post.title}</Text>
      <Text className={`mt-2 text-[13px] leading-5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
        {post.body?.length > 180 ? `${post.body.slice(0, 180)}...` : post.body}
      </Text>

      <View className="mt-4 flex-row flex-wrap gap-2">
        {(post.categories || []).map((tag) => (
          <View
            key={tag.id}
            className={`rounded-full border px-3 py-1 ${
              isDark ? 'border-sky-800/50 bg-sky-900/30' : 'border-sky-300 bg-sky-100'
            }`}
          >
            <Text className={`text-[11px] ${isDark ? 'text-sky-200' : 'text-sky-700'}`}>#{tag.label}</Text>
          </View>
        ))}
      </View>

      <View className={`mt-5 flex-row items-center justify-between border-t pt-4 ${isDark ? 'border-sky-900/60' : 'border-slate-200'}`}>
        <View className="flex-row items-center gap-4">
          <View className="flex-row items-center gap-1">
            <Text className={`text-[12px] font-semibold ${isDark ? 'text-rose-300' : 'text-rose-600'}`}>Likes</Text>
            <Text className={`text-[12px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{stats?.likes || 0}</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Text className="text-[12px] font-semibold text-sky-300">Reply</Text>
            <Text className={`text-[12px] ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{stats?.replies || 0}</Text>
          </View>
        </View>
        <TouchableOpacity activeOpacity={0.85} onPress={onOpenThread}>
          <Text className="text-[12px] font-semibold text-aquaaccent">Open thread {'->'}</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

export default CommunityForumScreen;
