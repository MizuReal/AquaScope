import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ADMIN_ROLE_VALUE, isAdminRole } from "@/lib/profileRole";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { sendUserDeactivationEmail } from "@/lib/api";

const configMissing = !supabase;
const SESSION_TIMEOUT_MS = 10000;
const PROFILES_TIMEOUT_MS = 15000;
const SUPABASE_PROFILES_TABLE = import.meta.env.VITE_PUBLIC_SUPABASE_PROFILES_TABLE || "profiles";

async function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/* ── Toast notification system ────────────────────────────── */
function useToast() {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const addToast = useCallback((message, type = "success") => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type, removing: false }]);
    setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, removing: true } : t)),
      );
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 300);
    }, 4000);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, removing: true } : t)),
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  return { toasts, addToast, dismissToast };
}

const toastStyles = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-rose-200 bg-rose-50 text-rose-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
};

const toastIcons = {
  success: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  error: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
    </svg>
  ),
  info: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-sky-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  ),
};

function ToastContainer({ toasts, onDismiss }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || toasts.length === 0) return null;
  return createPortal(
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3" style={{ maxWidth: 400 }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg transition-all duration-300 ${toastStyles[toast.type] || toastStyles.info} ${
            toast.removing ? "translate-x-full opacity-0" : "translate-x-0 opacity-100"
          }`}
          style={{ animation: toast.removing ? undefined : "toastSlideIn 0.3s ease-out" }}
        >
          <span className="mt-0.5 shrink-0">{toastIcons[toast.type] || toastIcons.info}</span>
          <p className="flex-1 text-sm">{toast.message}</p>
          <button
            type="button"
            className="shrink-0 rounded-full p-1 transition hover:bg-black/5"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M6 6l12 12M6 18L18 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export default function AdminUsersPage() {
  const { session, user } = useAuth();
  const currentUserId = user?.id ?? null;
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyRowId, setBusyRowId] = useState(null);
  const [sorting, setSorting] = useState([{ id: "created_at", desc: true }]);
  const [deactivateModalOpen, setDeactivateModalOpen] = useState(false);
  const [pendingDeactivateUser, setPendingDeactivateUser] = useState(null);
  const [deactivationReason, setDeactivationReason] = useState("");
  const [deactivationSubmitting, setDeactivationSubmitting] = useState(false);
  const mountedRef = useRef(true);
  const latestLoadRequestIdRef = useRef(0);
  // Prevents auth-state events that fire during initialization from superseding the first load.
  const sessionAcquiredRef = useRef(false);
  const { toasts, addToast, dismissToast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadProfiles = useCallback(async ({ silent = false, showToastOnError = true } = {}) => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    if (!silent) {
      setLoading(true);
    }

    const requestId = latestLoadRequestIdRef.current + 1;
    latestLoadRequestIdRef.current = requestId;

    try {
      const isCurrentRequest = () => latestLoadRequestIdRef.current === requestId;

      const sessionResult = await withTimeout(
        supabase
          .from(SUPABASE_PROFILES_TABLE)
          .select("id, display_name, organization, role, status, created_at")
          .order("created_at", { ascending: false }),
        PROFILES_TIMEOUT_MS,
        "Loading profiles timed out. Please retry.",
      );

      if (!mountedRef.current || !isCurrentRequest()) {
        return;
      }

      const profilesResult = sessionResult;

      const { data, error } = profilesResult;
      if (error) {
        throw error;
      }

      setProfiles((data || []).map((profile) => ({
        ...profile,
        role: Number(profile.role) || 0,
        status: profile.status || "active",
      })));
    } catch (err) {
      if (!mountedRef.current || latestLoadRequestIdRef.current !== requestId) {
        return;
      }

      setProfiles([]);
      if (showToastOnError) {
        addToast(err?.message || "Unable to load profiles.", "error");
      }
    } finally {
      if (mountedRef.current && latestLoadRequestIdRef.current === requestId) {
        // Mark session as acquired so future auth events can trigger silent refreshes.
        sessionAcquiredRef.current = true;
      }
      // The non-silent request owns the loading state and must always clear it,
      // even if a newer request has superseded it in the meantime.
      if (mountedRef.current && !silent) {
        setLoading(false);
      }
    }
  }, [addToast]);

  useEffect(() => {
    mountedRef.current = true;
    loadProfiles({ silent: false, showToastOnError: true });

    if (!supabase) {
      return () => {
        mountedRef.current = false;
      };
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      // Guard: supabase-js v2 fires SIGNED_IN immediately on subscription when a session
      // already exists, which would supersede the ongoing initial load and leave `loading`
      // stuck at true forever. Only trigger a silent refresh once the first load has settled.
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        if (sessionAcquiredRef.current) {
          loadProfiles({ silent: true, showToastOnError: false });
        }
        return;
      }

      if (event === "SIGNED_OUT" && mountedRef.current) {
        // AdminLayout will redirect unauthenticated users; just clear displayed profiles.
        setProfiles([]);
      }
    });

    const profilesChannel = supabase
      .channel("admin-users-profiles")
      .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_PROFILES_TABLE }, () => {
        loadProfiles({ silent: true, showToastOnError: false });
      })
      .subscribe();

    const handleWindowFocus = () => {
      loadProfiles({ silent: true, showToastOnError: false });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadProfiles({ silent: true, showToastOnError: false });
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      authListener.subscription.unsubscribe();
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      supabase.removeChannel(profilesChannel);
    };
  }, [loadProfiles]);

  const updateProfile = async (userId, payload, successMessage, options = {}) => {
    const { showSuccessToast = true } = options;

    if (!supabase) {
      return false;
    }

    setBusyRowId(userId);

    try {
      const { data: updated, error } = await supabase
        .from(SUPABASE_PROFILES_TABLE)
        .update({
          ...payload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId)
        .select("id, display_name, organization, role, status, created_at");

      if (error) {
        addToast(error.message || "Unable to update profile.", "error");
        setBusyRowId(null);
        return false;
      }

      if (!updated || updated.length === 0) {
        addToast("Update had no effect — check RLS policies or verify the user exists.", "error");
        setBusyRowId(null);
        return false;
      }

      const freshRow = {
        ...updated[0],
        role: Number(updated[0].role) || 0,
        status: updated[0].status || "active",
      };

      setProfiles((prev) =>
        prev.map((profile) => (profile.id === userId ? freshRow : profile)),
      );
      setBusyRowId(null);
      if (showSuccessToast) {
        addToast(successMessage, "success");
      }
      return true;
    } catch (err) {
      addToast(err?.message || "Unexpected error while updating profile.", "error");
      setBusyRowId(null);
      return false;
    }
  };

  const openDeactivateModal = (profile) => {
    setPendingDeactivateUser(profile);
    setDeactivationReason("");
    setDeactivateModalOpen(true);
  };

  const closeDeactivateModal = () => {
    if (deactivationSubmitting) {
      return;
    }

    setDeactivateModalOpen(false);
    setPendingDeactivateUser(null);
    setDeactivationReason("");
  };

  const confirmDeactivateAccount = async () => {
    const reason = deactivationReason.trim();
    if (!pendingDeactivateUser?.id) {
      addToast("No user selected for deactivation.", "error");
      return;
    }

    if (reason.length < 5) {
      addToast("Please provide a clear deactivation reason (at least 5 characters).", "error");
      return;
    }

    setDeactivationSubmitting(true);
    try {
      const deactivated = await updateProfile(
        pendingDeactivateUser.id,
        { status: "deactivated" },
        `Account deactivated for ${pendingDeactivateUser.display_name || "user"}.`,
        { showSuccessToast: false },
      );

      if (!deactivated) {
        return;
      }

      let accessToken = "";
      let adminUserId = "";

      try {
        accessToken = session?.access_token || "";
        adminUserId = user?.id || "";
      } catch {
      }

      if (!accessToken || !adminUserId) {
        addToast(
          `Account deactivated for ${pendingDeactivateUser.display_name || "user"}, but notification email was not sent because the admin session could not be verified.`,
          "info",
        );
      } else {
        try {
          await sendUserDeactivationEmail({
            targetUserId: pendingDeactivateUser.id,
            adminUserId,
            reason,
            accessToken,
          });
          addToast(
            `Account deactivated and email sent to ${pendingDeactivateUser.display_name || "user"}.`,
            "success",
          );
        } catch (emailError) {
          addToast(
            `Account deactivated, but email delivery failed: ${emailError?.message || "Unknown email error."}`,
            "info",
          );
        }
      }

      setDeactivateModalOpen(false);
      setPendingDeactivateUser(null);
      setDeactivationReason("");
    } finally {
      setDeactivationSubmitting(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        accessorKey: "display_name",
        header: "User",
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-slate-900">{row.original.display_name || "Unnamed user"}</p>
            <p className="font-mono text-xs text-slate-400">{row.original.id}</p>
          </div>
        ),
      },
      {
        accessorKey: "organization",
        header: "Organization",
        cell: ({ row }) => <span className="text-sm text-slate-600">{row.original.organization || "—"}</span>,
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => {
          const isSelf = row.original.id === currentUserId;
          return (
            <select
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:opacity-50"
              value={Number(row.original.role) || 0}
              disabled={busyRowId === row.original.id || isSelf}
              onChange={(event) => {
                const nextRole = Number(event.target.value);
                updateProfile(
                  row.original.id,
                  { role: nextRole },
                  `Role updated for ${row.original.display_name || "user"}.`,
                );
              }}
            >
              <option value={0}>User</option>
              <option value={ADMIN_ROLE_VALUE}>Admin</option>
            </select>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const currentStatus = row.original.status || "active";
          const nextStatus = currentStatus === "active" ? "deactivated" : "active";
          const isSelf = row.original.id === currentUserId;
          return (
            <button
              type="button"
              className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.25em] transition ${
                currentStatus === "active"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              } disabled:opacity-50`}
              disabled={busyRowId === row.original.id || isSelf}
              onClick={() =>
                currentStatus === "active"
                  ? openDeactivateModal(row.original)
                  : updateProfile(
                      row.original.id,
                      { status: nextStatus },
                      `Account ${nextStatus} for ${row.original.display_name || "user"}.`,
                    )
              }
            >
              {currentStatus}
            </button>
          );
        },
      },
      {
        accessorKey: "created_at",
        header: "Created",
        cell: ({ row }) => (
          <span className="text-sm text-slate-500">
            {row.original.created_at ? new Date(row.original.created_at).toLocaleDateString() : "—"}
          </span>
        ),
      },
    ],
    [busyRowId, currentUserId],
  );

  const filteredProfiles = useMemo(() => {
    let result = profiles;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (p) =>
          (p.display_name || "").toLowerCase().includes(q) ||
          (p.organization || "").toLowerCase().includes(q) ||
          (p.id || "").toLowerCase().includes(q),
      );
    }
    if (roleFilter !== "all") {
      const roleVal = roleFilter === "admin" ? ADMIN_ROLE_VALUE : 0;
      result = result.filter((p) => p.role === roleVal);
    }
    if (statusFilter !== "all") {
      result = result.filter((p) => (p.status || "active") === statusFilter);
    }
    return result;
  }, [profiles, searchQuery, roleFilter, statusFilter]);

  const table = useReactTable({
    data: filteredProfiles,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const activeCount = profiles.filter((profile) => (profile.status || "active") === "active").length;
  const adminCount = profiles.filter((profile) => isAdminRole(profile.role)).length;

  return (
    <section className="flex-1 px-6 py-10 lg:px-12">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-sky-600">User Control</p>
          <h1 className="text-3xl font-semibold text-slate-900">Manage User Roles & Account Status</h1>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-slate-600">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
            Total users: <strong className="text-slate-900">{profiles.length}</strong>
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">
            Active: <strong>{activeCount}</strong>
          </span>
          <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-sky-700">
            Admins: <strong>{adminCount}</strong>
          </span>
        </div>
      </header>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <article className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Deactivate/reactivate accounts and update user role directly from this table.</p>

        {/* search & filter toolbar */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, org, or ID..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-sky-300"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-sky-300"
          >
            <option value="all">All roles</option>
            <option value="user">Users only</option>
            <option value="admin">Admins only</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-sky-300"
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="deactivated">Deactivated only</option>
          </select>
          {(searchQuery || roleFilter !== "all" || statusFilter !== "all") && (
            <span className="text-xs text-slate-400">
              Showing {filteredProfiles.length} of {profiles.length}
            </span>
          )}
        </div>

        {configMissing ? (
          <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Supabase is not configured. Set VITE_PUBLIC_SUPABASE_URL and VITE_PUBLIC_SUPABASE_ANON_KEY.
          </p>
        ) : loading ? (
          <p className="mt-6 text-sm text-slate-500">Loading profiles...</p>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        scope="col"
                        className="px-4 py-3 text-left text-xs uppercase tracking-[0.25em] text-slate-500"
                      >
                        {header.isPlaceholder ? null : (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <span className="text-slate-400">
                              {header.column.getIsSorted() === "asc"
                                ? "↑"
                                : header.column.getIsSorted() === "desc"
                                  ? "↓"
                                  : "↕"}
                            </span>
                          </button>
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {table.getRowModel().rows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-slate-500">
                      No profiles found.
                    </td>
                  </tr>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="px-4 py-3 align-top">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {deactivateModalOpen ? (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/50 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <p className="text-xs uppercase tracking-[0.3em] text-sky-600">Account Deactivation</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Provide deactivation reason</h2>
            <p className="mt-2 text-sm text-slate-500">
              This reason will be emailed to {pendingDeactivateUser?.display_name || "the user"}.
            </p>

            <textarea
              value={deactivationReason}
              onChange={(event) => setDeactivationReason(event.target.value)}
              rows={5}
              className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-800 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
              placeholder="Enter clear reason for account deactivation..."
              disabled={deactivationSubmitting}
            />

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                onClick={closeDeactivateModal}
                disabled={deactivationSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl border border-rose-300 bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                onClick={confirmDeactivateAccount}
                disabled={deactivationSubmitting}
              >
                {deactivationSubmitting ? "Processing..." : "Deactivate & Send Email"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
