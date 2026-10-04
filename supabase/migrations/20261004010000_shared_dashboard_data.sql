BEGIN;

CREATE TABLE IF NOT EXISTS public.app_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  username text NOT NULL UNIQUE,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'User' CHECK (role IN ('User', 'Admin')),
  modules jsonb NOT NULL DEFAULT '{}'::jsonb,
  department text,
  department_privileges jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_records (
  record_key text PRIMARY KEY,
  module_key text NOT NULL CHECK (module_key IN ('inventories', 'clothing', 'payStores', 'jobscard', 'personnel', 'activity')),
  department_scope text,
  value jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.app_profiles FROM anon, authenticated;
GRANT SELECT ON public.app_profiles TO authenticated;
REVOKE ALL ON public.app_records FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_records TO authenticated;

DROP POLICY IF EXISTS "Users can read their own profile" ON public.app_profiles;
CREATE POLICY "Users can read their own profile"
  ON public.app_profiles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.can_access_app_module(
  requested_module text,
  requested_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_profiles profile
    WHERE profile.user_id = (SELECT auth.uid())
      AND (
        profile.role = 'Admin'
        OR (
          requested_module = 'activity'
          AND EXISTS (
            SELECT 1
            FROM jsonb_each(coalesce(profile.modules, '{}'::jsonb)) AS module_permissions(module_key, permissions)
            WHERE (
              requested_permission = 'view'
              AND (
                coalesce((permissions ->> 'view')::boolean, false)
                OR coalesce((permissions ->> 'add')::boolean, false)
                OR coalesce((permissions ->> 'edit')::boolean, false)
                OR coalesce((permissions ->> 'delete')::boolean, false)
              )
            ) OR (
              requested_permission = 'write'
              AND (
                coalesce((permissions ->> 'add')::boolean, false)
                OR coalesce((permissions ->> 'edit')::boolean, false)
                OR coalesce((permissions ->> 'delete')::boolean, false)
              )
            )
          )
        )
        OR coalesce((profile.modules -> requested_module ->> requested_permission)::boolean, false)
        OR (
          requested_permission = 'write'
          AND (
            coalesce((profile.modules -> requested_module ->> 'add')::boolean, false)
            OR coalesce((profile.modules -> requested_module ->> 'edit')::boolean, false)
            OR coalesce((profile.modules -> requested_module ->> 'delete')::boolean, false)
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_app_module(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_app_module(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_app_department(
  requested_department text,
  requested_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_profiles profile
    WHERE profile.user_id = (SELECT auth.uid())
      AND (
        profile.role = 'Admin'
        OR (
          requested_department = '__shared__'
          AND requested_permission = 'view'
          AND public.can_access_app_module('inventories', 'view')
        )
        OR (
          requested_department IS NOT NULL
          AND requested_department <> '__shared__'
          AND (
            coalesce((profile.department_privileges -> requested_department ->> requested_permission)::boolean, false)
            OR (
              requested_permission = 'view'
              AND (
                coalesce((profile.department_privileges -> requested_department ->> 'add')::boolean, false)
                OR coalesce((profile.department_privileges -> requested_department ->> 'edit')::boolean, false)
                OR coalesce((profile.department_privileges -> requested_department ->> 'delete')::boolean, false)
              )
            )
            OR (
              requested_permission = 'write'
              AND (
                coalesce((profile.department_privileges -> requested_department ->> 'add')::boolean, false)
                OR coalesce((profile.department_privileges -> requested_department ->> 'edit')::boolean, false)
                OR coalesce((profile.department_privileges -> requested_department ->> 'delete')::boolean, false)
              )
            )
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_app_department(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_app_department(text, text) TO authenticated;

DROP POLICY IF EXISTS "Users can read permitted dashboard records" ON public.app_records;
CREATE POLICY "Users can read permitted dashboard records"
  ON public.app_records FOR SELECT TO authenticated
  USING (
    public.can_access_app_module(module_key, 'view')
    AND (
      module_key <> 'inventories'
      OR public.can_access_app_department(department_scope, 'view')
    )
  );

DROP POLICY IF EXISTS "Users can add permitted dashboard records" ON public.app_records;
CREATE POLICY "Users can add permitted dashboard records"
  ON public.app_records FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_app_module(module_key, 'write')
    AND (
      module_key <> 'inventories'
      OR public.can_access_app_department(department_scope, 'write')
    )
    AND updated_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "Users can update permitted dashboard records" ON public.app_records;
CREATE POLICY "Users can update permitted dashboard records"
  ON public.app_records FOR UPDATE TO authenticated
  USING (
    public.can_access_app_module(module_key, 'write')
    AND (
      module_key <> 'inventories'
      OR public.can_access_app_department(department_scope, 'write')
    )
  )
  WITH CHECK (
    public.can_access_app_module(module_key, 'write')
    AND (
      module_key <> 'inventories'
      OR public.can_access_app_department(department_scope, 'write')
    )
    AND updated_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete permitted dashboard records" ON public.app_records;
CREATE POLICY "Users can delete permitted dashboard records"
  ON public.app_records FOR DELETE TO authenticated
  USING (
    public.can_access_app_module(module_key, 'delete')
    AND (
      module_key <> 'inventories'
      OR public.can_access_app_department(department_scope, 'delete')
    )
  );

COMMIT;
