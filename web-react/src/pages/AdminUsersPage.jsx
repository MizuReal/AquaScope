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

const configMissing = !supabase;

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
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyRowId, setBusyRowId] = useState(null);
  const [sorting, setSorting] = useState([{ id: "created_at", desc: true }]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const { toasts, addToast, dismissToast } = useToast();

  const loadProfiles = async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    setCurrentUserId(session?.user?.id ?? null);

    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, organization, role, status, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      addToast(error.message || "Unable to load profiles.", "error");
      setProfiles([]);
      setLoading(false);
      return;
    }

    setProfiles((data || []).map((profile) => ({
      ...profile,
      role: Number(profile.role) || 0,
      status: profile.status || "active",
    })));
    setLoading(false);
  };

  useEffect(() => {
    loadProfiles();
  }, []);

  const updateProfile = async (userId, payload, successMessage) => {
    if (!supabase) {
      return;
    }

    setBusyRowId(userId);

    try {
      const { data: updated, error } = await supabase
        .from("profiles")
        .update({
          ...payload,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId)
        .select("id, display_name, organization, role, status, created_at");

      if (error) {
        addToast(error.message || "Unable to update profile.", "error");
        setBusyRowId(null);
        return;
      }

      if (!updated || updated.length === 0) {
        addToast("Update had no effect — check RLS policies or verify the user exists.", "error");
        setBusyRowId(null);
        return;
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
      addToast(successMessage, "success");
    } catch (err) {
      addToast(err?.message || "Unexpected error while updating profile.", "error");
      setBusyRowId(null);
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
                updateProfile(
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

  const table = useReactTable({
    data: profiles,
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
    </section>
  );
}
