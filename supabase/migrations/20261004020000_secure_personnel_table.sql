BEGIN;

ALTER TABLE public.personnel ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.personnel FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.personnel TO authenticated;

DO $$
DECLARE
  existing_policy record;
BEGIN
  FOR existing_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'personnel'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.personnel', existing_policy.policyname);
  END LOOP;
END
$$;

CREATE POLICY "Clothing users can read personnel"
  ON public.personnel FOR SELECT TO authenticated
  USING (public.can_access_app_module('clothing', 'view'));

CREATE POLICY "Clothing users can add personnel"
  ON public.personnel FOR INSERT TO authenticated
  WITH CHECK (public.can_access_app_module('clothing', 'write'));

CREATE POLICY "Clothing users can update personnel"
  ON public.personnel FOR UPDATE TO authenticated
  USING (public.can_access_app_module('clothing', 'write'))
  WITH CHECK (public.can_access_app_module('clothing', 'write'));

CREATE POLICY "Clothing users can delete personnel"
  ON public.personnel FOR DELETE TO authenticated
  USING (public.can_access_app_module('clothing', 'delete'));

COMMIT;
