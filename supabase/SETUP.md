# Enable shared dashboard access

The pages remain static, but authentication, account administration, and dashboard record data are stored in Supabase. Serve the repository over HTTPS (for example, a private GitHub Pages site or another static web host); do not distribute `file://` copies as the shared deployment.

## One-time Supabase setup

1. In the Supabase SQL Editor, apply the migrations in `supabase/migrations` in filename order. This creates protected app profiles and shared record storage and restricts the existing `personnel` endpoint to authenticated clothing-module users.
2. In the Supabase Auth settings, disable public sign-ups. The app's admin Edge Function is the only account-creation route.
3. Deploy the admin function from the repository root:

   ```powershell
   supabase functions deploy manage-users
   ```

   The function uses the Supabase-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` secrets. Keep the service-role key in Edge Function secrets only; never put it in browser code.
4. Create the first administrator in Supabase Dashboard → Authentication → Users. Copy that user's UUID, then run this SQL in the SQL Editor, replacing the example UUID and email. The module and department grants are app-controlled metadata; the database policies use the profile table to authorize record access.

   ```sql
   INSERT INTO public.app_profiles
     (user_id, email, username, full_name, role, modules, department, department_privileges)
   VALUES
     ('00000000-0000-0000-0000-000000000000', 'admin@example.com', 'admin', 'System Administrator',
      'Admin', '{}'::jsonb, 'DIT', '{}'::jsonb);

   UPDATE auth.users
   SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
     || jsonb_build_object('role', 'Admin', 'modules', '{}'::jsonb)
   WHERE id = '00000000-0000-0000-0000-000000000000';
   ```

5. Deploy the static site over HTTPS. The publishable Supabase key in `supabase-config.js` is intended for browser use; database access is constrained by RLS.
6. Sign in as the bootstrap administrator, then use **System Administration → User access** to create the other accounts and assign module/department permissions. Inventory and safe-keeping records are isolated by department in both the app and database. The other modules are protected by module permission; their department, recipient, or employee fields are business data, not separate database access boundaries.

## Existing browser data

The first administrator sign-in on a browser uploads that browser's existing module records when the corresponding shared cloud record does not exist. Once a cloud record exists, it takes precedence over that browser's local copy. Use the browser that contains the authoritative records for this first sign-in. Legacy browser-stored login credentials are not uploaded; create accounts through Supabase Auth after bootstrap.

Updates use a version check to reject a stale shared snapshot instead of silently overwriting a concurrent change. When a conflict is reported, reload the module to fetch the latest shared record before editing again. Other users see changes when they next open or reload that module. Legacy inventory documents without department metadata are retained only in the default department during the initial split; new issue and receive documents record their department explicitly.
