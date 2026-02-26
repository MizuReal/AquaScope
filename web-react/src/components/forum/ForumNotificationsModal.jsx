const buildInitials = (value) => {
  if (!value) return "NA";
  const parts = String(value).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "NA";
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] || "" : "";
  return `${first}${last}`.toUpperCase();
};

const formatRelativeTime = (value) => {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

function NotificationAvatar({ src, name }) {
  if (src) {
    return (
      <img
        src={src}
        alt={name ? `${name} avatar` : "User avatar"}
        className="h-10 w-10 rounded-xl border border-sky-200 object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-xs font-semibold text-slate-700">
      {buildInitials(name)}
    </span>
  );
}

export default function ForumNotificationsModal({
  visible,
  onClose,
  notifications,
  notificationsLoading,
  notificationsError,
  notificationsBusyId,
  onOpenNotification,
}) {
  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 px-4 py-10"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-3xl border-2 border-cyan-300 bg-slate-50 p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-900">Notifications</h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600"
          >
            Close
          </button>
        </div>

        {notificationsError ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {notificationsError}
          </div>
        ) : null}

        <div className="mt-4 max-h-[68vh] space-y-3 overflow-y-auto pr-1">
          {!notificationsLoading && notifications.length === 0 ? (
            <div className="rounded-2xl border-2 border-sky-200 bg-white px-5 py-8 text-sm text-slate-600 shadow-sm">
              No notifications yet. Replies to your threads will show up here.
            </div>
          ) : null}

          {notificationsLoading ? (
            <div className="rounded-2xl border-2 border-cyan-200 bg-white px-5 py-6 text-sm text-slate-600 shadow-sm">
              Loading notifications...
            </div>
          ) : null}

          {!notificationsLoading
            ? notifications.map((item) => {
                const itemBusy = notificationsBusyId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenNotification(item)}
                    disabled={itemBusy}
                    className={`w-full rounded-2xl border-2 px-4 py-3 text-left transition ${
                      item.is_read
                        ? "border-sky-200 bg-white"
                        : "border-cyan-300 bg-cyan-50"
                    } ${itemBusy ? "cursor-not-allowed opacity-70" : "hover:border-sky-300"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <NotificationAvatar src={item.actorAvatar} name={item.actorName} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {item.actorName} replied to your thread
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-600">{item.body || item.title}</p>
                        </div>
                      </div>
                      <p className="shrink-0 text-xs text-slate-500">{formatRelativeTime(item.created_at)}</p>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
                        {itemBusy ? "Opening..." : "Open thread"}
                      </p>
                      {!item.is_read ? <span className="h-2 w-2 rounded-full bg-cyan-500" /> : null}
                    </div>
                  </button>
                );
              })
            : null}
        </div>
      </div>
    </div>
  );
}
