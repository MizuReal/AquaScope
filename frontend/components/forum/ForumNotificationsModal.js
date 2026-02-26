import React, { memo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const buildInitials = (value) => {
  if (!value) return 'NA';
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'NA';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return `${first}${last}`.toUpperCase();
};

const Avatar = ({ avatarUrl, name, isDark, size = 38 }) => (
  <View
    style={[
      styles.avatar,
      {
        width: size,
        height: size,
        borderRadius: 12,
        borderColor: isDark ? 'rgba(30,64,175,0.65)' : '#cbd5e1',
        backgroundColor: isDark ? 'rgba(2,6,23,0.75)' : '#f1f5f9',
      },
    ]}
  >
    {avatarUrl ? (
      <Image source={{ uri: avatarUrl }} style={{ width: size, height: size }} />
    ) : (
      <Text style={[styles.avatarText, { color: isDark ? '#dbeafe' : '#1e293b' }]}>{buildInitials(name)}</Text>
    )}
  </View>
);

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

const ForumNotificationsModal = memo(function ForumNotificationsModal({
  visible,
  onClose,
  notifications,
  notificationsLoading,
  notificationsError,
  notificationsBusyId,
  onOpenNotification,
  colors,
  isDark,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, { backgroundColor: colors.modalBg }]}> 
        <SafeAreaView style={styles.flex1}>
          <View style={styles.modalTopBar}>
            <Text style={[styles.modalTitle, { color: colors.title }]}>Notifications</Text>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeButton, { borderColor: colors.chipBorder, backgroundColor: colors.chipBg }]}
            >
              <Text style={[styles.closeButtonText, { color: colors.text }]}>Close</Text>
            </TouchableOpacity>
          </View>

          {!!notificationsError && (
            <View
              style={[
                styles.errorCard,
                {
                  marginTop: 14,
                  borderColor: isDark ? 'rgba(190,24,93,0.5)' : '#fda4af',
                  backgroundColor: isDark ? 'rgba(136,19,55,0.28)' : '#ffe4e6',
                },
              ]}
            >
              <Text style={[styles.errorText, { color: isDark ? '#fecdd3' : '#be123c' }]}>{notificationsError}</Text>
            </View>
          )}

          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id}
            style={styles.modalContent}
            contentContainerStyle={styles.notificationsListContent}
            ListEmptyComponent={
              notificationsLoading ? (
                <View style={styles.emptyWrap}>
                  <ActivityIndicator color="#5eead4" />
                </View>
              ) : (
                <View style={[styles.emptyCard, { borderColor: colors.cardBorder, backgroundColor: colors.card }]}> 
                  <Text style={[styles.emptyTitle, { color: colors.title }]}>No notifications yet</Text>
                  <Text style={[styles.emptyText, { color: colors.text }]}>Replies to your threads will show up here.</Text>
                </View>
              )
            }
            renderItem={({ item }) => {
              const itemBusy = notificationsBusyId === item.id;
              return (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => onOpenNotification(item)}
                  disabled={itemBusy}
                  style={[
                    styles.notificationCard,
                    {
                      borderColor: item.is_read
                        ? colors.cardBorder
                        : (isDark ? 'rgba(34,211,238,0.45)' : '#67e8f9'),
                      backgroundColor: item.is_read
                        ? colors.card
                        : (isDark ? 'rgba(8,47,73,0.35)' : '#ecfeff'),
                    },
                  ]}
                >
                  <View style={styles.notificationHeaderRow}>
                    <View style={styles.notificationMainRow}>
                      <Avatar avatarUrl={item.actorAvatar} name={item.actorName} isDark={isDark} size={38} />
                      <View style={styles.notificationTextWrap}>
                        <Text style={[styles.notificationTitle, { color: colors.title }]} numberOfLines={1}>
                          {item.actorName} replied to your thread
                        </Text>
                        <Text style={[styles.notificationBody, { color: colors.text }]} numberOfLines={2}>
                          {item.body || item.title}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.notificationTime, { color: colors.subtle }]} numberOfLines={1}>
                      {formatRelativeTime(item.created_at)}
                    </Text>
                  </View>
                  <View style={styles.notificationFooter}>
                    <Text style={[styles.notificationOpenHint, { color: isDark ? '#22d3ee' : '#0284c7' }]}>
                      {itemBusy ? 'Opening thread...' : 'Tap to open thread'}
                    </Text>
                    {!item.is_read && <View style={styles.notificationDot} />}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  flex1: { flex: 1 },
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
  errorCard: {
    marginHorizontal: 20,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: { fontSize: 12 },
  modalContent: { paddingHorizontal: 20 },
  notificationsListContent: { paddingTop: 14, paddingBottom: 24, gap: 12 },
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
  emptyWrap: { alignItems: 'center', paddingVertical: 28 },
  emptyCard: {
    marginHorizontal: 20,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  emptyTitle: { fontSize: 14, fontWeight: '700' },
  emptyText: { marginTop: 8, fontSize: 12, lineHeight: 18 },
  avatar: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarText: { fontSize: 13, fontWeight: '700' },
});

export default ForumNotificationsModal;
