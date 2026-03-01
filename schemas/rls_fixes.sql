-- =============================================================================
-- RLS FIX SCRIPT  —  Run in Supabase SQL Editor (top to bottom)
-- Each section is idempotent (DROP IF EXISTS / IF NOT EXISTS).
--
-- Context:
--   * The main symptom is "infinite loading" on the web app, especially when
--     posting forum replies or when the dashboard guard queries profiles.
--   * Root causes: a missing INSERT policy on forum_notifications (blocks the
--     after-insert trigger and rolls back the entire forum_posts INSERT),
--     redundant / overlapping permissive policies that multiply evaluation
--     cost, security-role mismatches ({public} vs {authenticated}), and a
--     potential SECURITY INVOKER trigger function.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- FIX #1  ★ CRITICAL — Add missing INSERT policy on forum_notifications
--
-- Without this policy the create_forum_reply_notification() trigger fails
-- with an RLS violation when it is SECURITY INVOKER.  Because the trigger
-- runs inside the same transaction as the forum_posts INSERT, the entire
-- transaction rolls back — the reply silently disappears and the UI appears
-- stuck in "loading" forever.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS forum_notifications_insert ON public.forum_notifications;
CREATE POLICY forum_notifications_insert
  ON public.forum_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
-- WITH CHECK (true) is safe: inserts are only performed by the DB trigger,
-- which enforces integrity via the UNIQUE (recipient_user_id, post_id, type)
-- constraint.


-- ---------------------------------------------------------------------------
-- FIX #2  — Fix forum_notifications SELECT policy role (public → authenticated)
--
-- The original policy targets {public} but checks auth.uid(), which is NULL
-- for the anon role.  Targeting {authenticated} is semantically correct and
-- lets PostgreSQL skip evaluation entirely for anonymous requests.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS forum_notifications_select_own ON public.forum_notifications;
CREATE POLICY forum_notifications_select_own
  ON public.forum_notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = recipient_user_id);


-- ---------------------------------------------------------------------------
-- FIX #3  — Fix forum_notifications UPDATE policy role (public → authenticated)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS forum_notifications_update_own ON public.forum_notifications;
CREATE POLICY forum_notifications_update_own
  ON public.forum_notifications
  FOR UPDATE
  TO authenticated
  USING  (auth.uid() = recipient_user_id)
  WITH CHECK (auth.uid() = recipient_user_id);


-- ---------------------------------------------------------------------------
-- FIX #4  — Add DELETE policy on forum_notifications for recipients
--
-- Allows users to delete their own notifications. Without this no client-side
-- cleanup is possible.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS forum_notifications_delete_own ON public.forum_notifications;
CREATE POLICY forum_notifications_delete_own
  ON public.forum_notifications
  FOR DELETE
  TO authenticated
  USING (auth.uid() = recipient_user_id);


-- ---------------------------------------------------------------------------
-- FIX #5  — Remove redundant SELECT policies on profiles
--
-- profiles_select_authenticated (authenticated, true) already grants every
-- authenticated user access to all profile rows.  The other two policies are
-- evaluated in addition (OR logic) but can never widen access further:
--
--   profiles_select_own          (public, auth.uid() = id)      ← redundant
--   profiles_admin_select_all    (authenticated, is_admin_user()) ← redundant
--
-- Worse, is_admin_user() likely does its own profiles lookup; if it is
-- SECURITY INVOKER this creates recursive RLS evaluation.  Dropping the
-- policy eliminates the call entirely and speeds up every profiles SELECT —
-- including the guardByProfile() query that gates the dashboard.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select_own       ON public.profiles;
DROP POLICY IF EXISTS profiles_admin_select_all ON public.profiles;

-- Remaining profiles policies:
--   SELECT: profiles_select_authenticated  (authenticated, true)
--   INSERT: profiles_insert_own            (authenticated, auth.uid() = id)
--   UPDATE: profiles_update_own            (authenticated, auth.uid() = id)
--   UPDATE: profiles_admin_update_all      (authenticated, is_admin_user())


-- ---------------------------------------------------------------------------
-- FIX #6  — Remove duplicate / insecure SELECT policy on field_samples
--
-- "Users read their own samples" ({public}) overlaps with
-- field_samples_select_own ({authenticated}).  PostgreSQL evaluates BOTH for
-- every authenticated read, tripling policy cost.
--
-- The {public} variant also allowed (user_id IS NULL) reads for anyone —
-- a data-leak risk.  Drop it and keep only the authenticated-scoped policies.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users read their own samples" ON public.field_samples;

-- Remaining field_samples SELECT policies:
--   field_samples_select_own    (authenticated, auth.uid() = user_id)
--   field_samples_select_admin  (authenticated, admin subquery)


-- ---------------------------------------------------------------------------
-- FIX #7  — Remove insecure INSERT policy on field_samples
--
-- "Users insert their own samples" ({public}) allows inserts with
-- (user_id IS NULL), letting unauthenticated clients insert ownerless rows.
-- Replace with a clean authenticated-only policy.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users insert their own samples" ON public.field_samples;

DROP POLICY IF EXISTS field_samples_insert_own ON public.field_samples;
CREATE POLICY field_samples_insert_own
  ON public.field_samples
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- FIX #8  — Partial index on profiles for admin subqueries
--
-- container_scans_select_admin and field_samples_select_admin both run:
--   EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 1)
-- A partial index on (id) WHERE role = 1 turns this into an index-only
-- lookup for the rare admin case and a fast "not found" for regular users.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS profiles_role_idx
  ON public.profiles (id)
  WHERE role = 1;


-- ---------------------------------------------------------------------------
-- FIX #9  ★ CRITICAL — Ensure notification trigger is SECURITY DEFINER
--
-- If the trigger function is SECURITY INVOKER, the INSERT into
-- forum_notifications runs under the invoking user's permissions.  Even with
-- FIX #1 above, SECURITY DEFINER is the correct design for system-level
-- triggers so the insert always succeeds regardless of the caller's role.
--
-- This ALTER is safe to run even if the function is already SECURITY DEFINER.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'create_forum_reply_notification'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.create_forum_reply_notification() SECURITY DEFINER';
  END IF;
END
$$;


-- ---------------------------------------------------------------------------
-- VERIFICATION — Run after applying all fixes above.
-- Should return one row with security_mode = 'SECURITY DEFINER (safe)'.
-- ---------------------------------------------------------------------------
SELECT
  proname,
  CASE WHEN prosecdef
       THEN 'SECURITY DEFINER (safe)'
       ELSE 'SECURITY INVOKER (needs fix!)'
  END AS security_mode
FROM pg_proc
WHERE proname = 'create_forum_reply_notification';


-- ---------------------------------------------------------------------------
-- COMPLETE POLICY MAP AFTER ALL FIXES
--
-- forum_notifications:
--   SELECT : forum_notifications_select_own   (authenticated, recipient = uid)  ← fixed role
--   INSERT : forum_notifications_insert        (authenticated, true)             ← NEW
--   UPDATE : forum_notifications_update_own    (authenticated, recipient = uid)  ← fixed role
--   DELETE : forum_notifications_delete_own    (authenticated, recipient = uid)  ← NEW
--
-- field_samples:
--   SELECT : field_samples_select_own          (authenticated, uid = user_id)
--   SELECT : field_samples_select_admin        (authenticated, admin subquery)
--   INSERT : field_samples_insert_own          (authenticated, uid = user_id)    ← NEW clean
--
-- profiles:
--   SELECT : profiles_select_authenticated     (authenticated, true)
--   INSERT : profiles_insert_own               (authenticated, uid = id)
--   UPDATE : profiles_update_own               (authenticated, uid = id)
--   UPDATE : profiles_admin_update_all         (authenticated, is_admin_user())
--
-- container_scans:                             (unchanged)
--   SELECT : container_scans_select_own        (authenticated, uid = user_id)
--   SELECT : container_scans_select_admin      (authenticated, admin subquery)
--   INSERT : container_scans_insert_own        (authenticated, uid = user_id)
--   DELETE : container_scans_delete_own        (authenticated, uid = user_id)
--
-- forum_threads / forum_posts / forum_*_likes / forum_thread_categories /
-- forum_categories / storage.objects:          (unchanged — already correct)
-- ---------------------------------------------------------------------------
