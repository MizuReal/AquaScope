-- ═══════════════════════════════════════════════════════════════════════
-- THREAD LOCK MIGRATION  — Run in Supabase SQL Editor (top to bottom)
-- ═══════════════════════════════════════════════════════════════════════
-- Adds: lock_reason column, admin UPDATE policy, post-insert guard trigger.
-- Safe to re-run (all statements use IF NOT EXISTS / DROP IF EXISTS).

-- ── 1. Add lock_reason column (idempotent) ─────────────────────────
ALTER TABLE public.forum_threads
  ADD COLUMN IF NOT EXISTS lock_reason text NULL;

COMMENT ON COLUMN public.forum_threads.lock_reason IS
  'Optional reason displayed to users when a thread is locked by an admin.';

-- ── 2. Admin UPDATE policy on forum_threads ────────────────────────
-- Allows admins (profiles.role = 1) to update is_locked / lock_reason
-- on ANY thread, not just their own.
DROP POLICY IF EXISTS forum_threads_admin_update ON public.forum_threads;
CREATE POLICY forum_threads_admin_update
  ON public.forum_threads
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 1
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 1
    )
  );

-- ── 3. Admin DELETE policy on forum_threads ─────────────────────────
-- Allows admins to delete ANY thread (regular users already have
-- forum_threads_delete_own which restricts to their own).
DROP POLICY IF EXISTS forum_threads_admin_delete ON public.forum_threads;
CREATE POLICY forum_threads_admin_delete
  ON public.forum_threads
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 1
    )
  );

-- ── 4. Trigger: block INSERT on forum_posts when thread is locked ──
CREATE OR REPLACE FUNCTION public.enforce_thread_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.forum_threads
    WHERE id = NEW.thread_id AND is_locked = true
  ) THEN
    RAISE EXCEPTION 'This thread is locked. New replies are not allowed.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS forum_posts_enforce_thread_lock ON public.forum_posts;
CREATE TRIGGER forum_posts_enforce_thread_lock
  BEFORE INSERT ON public.forum_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_thread_lock();
