import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';

const NOTIFICATIONS_BATCH_SIZE = 30;

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

export const useForumNotifications = ({ sessionUserId, profilesTable = 'profiles', normalizeAvatarUrl }) => {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const refresh = useCallback(async () => {
    if (!sessionUserId) {
      setNotifications([]);
      setError('');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const notificationResult = await supabase
        .from('forum_notifications')
        .select('id, actor_user_id, recipient_user_id, thread_id, post_id, type, title, body, is_read, created_at')
        .eq('recipient_user_id', sessionUserId)
        .order('created_at', { ascending: false })
        .limit(NOTIFICATIONS_BATCH_SIZE);

      if (notificationResult.error) throw notificationResult.error;

      const rawNotifications = notificationResult.data || [];
      const actorIds = Array.from(new Set(rawNotifications.map((item) => item.actor_user_id).filter(Boolean)));
      const actorProfilesResult = actorIds.length
        ? await supabase
            .from(profilesTable)
            .select('id, display_name, avatar_url')
            .in('id', actorIds)
        : { data: [] };

      if (actorProfilesResult.error) throw actorProfilesResult.error;

      const actorMap = new Map((actorProfilesResult.data || []).map((profile) => [profile.id, profile]));
      const hydrated = rawNotifications.map((item) => {
        const actorProfile = actorMap.get(item.actor_user_id) || {};
        return {
          ...item,
          actorName: actorProfile.display_name || 'Someone',
          actorAvatar: normalizeAvatarUrl ? normalizeAvatarUrl(actorProfile.avatar_url) : actorProfile.avatar_url || '',
        };
      });

      setNotifications(dedupeById(hydrated));
    } catch (loadError) {
      console.warn('[Supabase] notifications load failed:', loadError?.message || loadError);
      setError('Unable to load notifications right now.');
    } finally {
      setLoading(false);
    }
  }, [normalizeAvatarUrl, profilesTable, sessionUserId]);

  const markAsRead = useCallback(async (notificationId) => {
    if (!sessionUserId || !notificationId) return;

    setBusyId(notificationId);
    setError('');
    try {
      const { error: updateError } = await supabase
        .from('forum_notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('id', notificationId)
        .eq('recipient_user_id', sessionUserId);

      if (updateError) throw updateError;

      setNotifications((prev) => prev.map((item) => (
        item.id === notificationId ? { ...item, is_read: true } : item
      )));
    } catch (updateError) {
      console.warn('[Supabase] notification mark-as-read failed:', updateError?.message || updateError);
      setError('Unable to update this notification right now.');
      throw updateError;
    } finally {
      setBusyId('');
    }
  }, [sessionUserId]);

  const unreadCount = useMemo(
    () => notifications.reduce((acc, item) => acc + (item?.is_read ? 0 : 1), 0),
    [notifications]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!sessionUserId) return undefined;

    const channel = supabase
      .channel(`forum-notifications-${sessionUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'forum_notifications',
          filter: `recipient_user_id=eq.${sessionUserId}`,
        },
        () => {
          refresh();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh, sessionUserId]);

  return {
    notifications,
    notificationsLoading: loading,
    notificationsError: error,
    notificationsBusyId: busyId,
    unreadNotificationsCount: unreadCount,
    refreshNotifications: refresh,
    markNotificationAsRead: markAsRead,
    setNotificationsError: setError,
  };
};
