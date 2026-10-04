import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type UserProfile = {
  id?: string;
  email: string;
  username: string;
  fullName: string;
  role: "User" | "Admin";
  modules: Record<string, { view?: boolean; add?: boolean; edit?: boolean; delete?: boolean }>;
  department?: string;
  departmentPrivileges?: Record<string, Record<string, boolean>>;
  password?: string;
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeRole(value: unknown): "User" | "Admin" {
  return value === "Admin" || value === "Administrator" ? "Admin" : "User";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidUsername(value: string) {
  return /^[a-z0-9][a-z0-9._-]{2,49}$/.test(value);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Required Supabase function secrets are missing.");
    return response({ error: "User management is not configured on the server." }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return response({ error: "Request body must be valid JSON." }, 400);
  }

  const action = String(body.action || "");
  if (action === "sign_in") {
    const identifier = String(body.identifier || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!identifier || !password) return response({ error: "Enter your username/email and password." }, 400);
    const profileQuery = identifier.includes("@")
      ? adminClient.from("app_profiles").select("*").eq("email", identifier)
      : adminClient.from("app_profiles").select("*").eq("username", identifier);
    const { data: profile, error: lookupError } = await profileQuery.maybeSingle();
    if (lookupError || !profile) return response({ error: "Invalid username/email or password." }, 401);

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email: profile.email,
      password,
    });
    if (authError || !authData.session || !authData.user) {
      return response({ error: "Invalid username/email or password." }, 401);
    }
    return response({
      session: {
        access_token: authData.session.access_token,
        refresh_token: authData.session.refresh_token,
      },
      user: {
        id: profile.user_id,
        email: profile.email,
        username: profile.username,
        fullName: profile.full_name,
        role: profile.role,
        modules: profile.modules,
        department: profile.department || "",
        departmentPrivileges: profile.department_privileges,
      },
    });
  }

  const authorization = request.headers.get("Authorization") || "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "");
  if (!accessToken) return response({ error: "Authentication is required." }, 401);
  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(accessToken);
  if (callerError || !callerData.user) return response({ error: "The session is invalid or expired." }, 401);
  const { data: callerProfile, error: profileError } = await adminClient
    .from("app_profiles")
    .select("role")
    .eq("user_id", callerData.user.id)
    .maybeSingle();
  if (profileError) {
    console.error("Could not verify the administrator profile.", profileError);
    return response({ error: "Could not verify administrator access." }, 500);
  }
  if (!callerProfile || callerProfile.role !== "Admin") {
    return response({ error: "Administrator access is required." }, 403);
  }

  if (action === "list") {
    const { data, error } = await adminClient.from("app_profiles")
      .select("user_id, email, username, full_name, role, modules, department, department_privileges")
      .order("email");
    if (error) {
      console.error("Could not list user profiles.", error);
      return response({ error: "Could not load user accounts." }, 500);
    }
    return response({
      users: (data || []).map((profile) => ({
        id: profile.user_id,
        email: profile.email,
        username: profile.username,
        fullName: profile.full_name,
        role: profile.role,
        modules: profile.modules,
        department: profile.department,
        departmentPrivileges: profile.department_privileges,
      })),
    });
  }

  if (action === "create") {
    const user = body.user as UserProfile | undefined;
    if (!user || !user.email || !user.username || !user.fullName || !user.password || user.password.length < 8) {
      return response({ error: "Name, username, email, and a password of at least 8 characters are required." }, 400);
    }
    const normalizedEmail = user.email.trim().toLowerCase();
    const normalizedUsername = user.username.trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) return response({ error: "Enter a valid email address." }, 400);
    if (!isValidUsername(normalizedUsername)) return response({ error: "Username must be 3–50 letters, numbers, dots, underscores, or hyphens." }, 400);
    const { data: emailConflict, error: emailConflictError } = await adminClient.from("app_profiles")
      .select("user_id").eq("email", normalizedEmail).maybeSingle();
    const { data: usernameConflict, error: usernameConflictError } = await adminClient.from("app_profiles")
      .select("user_id").eq("username", normalizedUsername).maybeSingle();
    if (emailConflictError || usernameConflictError) return response({ error: "Could not check for duplicate accounts." }, 500);
    if (emailConflict || usernameConflict) return response({ error: "That email address or username is already in use." }, 409);

    const role = normalizeRole(user.role);
    const profile = {
      email: normalizedEmail,
      username: normalizedUsername,
      full_name: user.fullName.trim(),
      role,
      modules: role === "Admin" ? {} : (user.modules || {}),
      department: user.department || null,
      department_privileges: role === "Admin" ? {} : (user.departmentPrivileges || {}),
    };
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: normalizedEmail,
      password: user.password,
      email_confirm: true,
      user_metadata: { username: normalizedUsername, full_name: profile.full_name },
      app_metadata: { role, modules: profile.modules, department: profile.department, departmentPrivileges: profile.department_privileges },
    });
    if (createError || !created.user) {
      return response({ error: createError?.message || "Could not create the login account." }, 400);
    }
    const { error: insertError } = await adminClient.from("app_profiles").insert({
      user_id: created.user.id,
      ...profile,
    });
    if (insertError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      console.error("Could not save the new user profile.", insertError);
      return response({ error: "Could not save the new user profile." }, 500);
    }
    return response({ user: { id: created.user.id, ...user, email: normalizedEmail, username: normalizedUsername, role, password: undefined } }, 201);
  }

  if (action === "update") {
    const user = body.user as UserProfile | undefined;
    if (!user?.id || !user.email || !user.username || !user.fullName) return response({ error: "A valid user profile is required." }, 400);
    const { data: targetProfile, error: targetError } = await adminClient.from("app_profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (targetError || !targetProfile) return response({ error: "User account was not found." }, 404);
    if (user.id === callerData.user.id && normalizeRole(user.role) !== "Admin") {
      return response({ error: "You cannot remove your own administrator access." }, 400);
    }
    const normalizedEmail = user.email.trim().toLowerCase();
    const normalizedUsername = user.username.trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) return response({ error: "Enter a valid email address." }, 400);
    if (!isValidUsername(normalizedUsername)) return response({ error: "Username must be 3–50 letters, numbers, dots, underscores, or hyphens." }, 400);
    const { data: emailConflict, error: emailConflictError } = await adminClient.from("app_profiles")
      .select("user_id").eq("email", normalizedEmail).neq("user_id", user.id).maybeSingle();
    const { data: usernameConflict, error: usernameConflictError } = await adminClient.from("app_profiles")
      .select("user_id").eq("username", normalizedUsername).neq("user_id", user.id).maybeSingle();
    if (emailConflictError || usernameConflictError) return response({ error: "Could not check for duplicate accounts." }, 500);
    if (emailConflict || usernameConflict) return response({ error: "That email address or username is already in use." }, 409);

    const role = normalizeRole(user.role);
    if (targetProfile.role === "Admin" && role !== "Admin") {
      const { count, error: countError } = await adminClient.from("app_profiles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "Admin");
      if (countError) return response({ error: "Could not verify remaining administrators." }, 500);
      if ((count || 0) <= 1) return response({ error: "Cannot remove the only administrator account." }, 400);
    }
    const modules = role === "Admin" ? {} : (user.modules || {});
    const departmentPrivileges = role === "Admin" ? {} : (user.departmentPrivileges || {});
    const metadata = {
      username: normalizedUsername,
      full_name: user.fullName.trim(),
    };
    const appMetadata = { role, modules, department: user.department || null, departmentPrivileges };
    const authUpdate: Record<string, unknown> = {
      email: normalizedEmail,
      user_metadata: metadata,
      app_metadata: appMetadata,
    };
    if (user.password) {
      if (user.password.length < 8) return response({ error: "Password must be at least 8 characters." }, 400);
      authUpdate.password = user.password;
    }
    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(user.id, authUpdate);
    if (authUpdateError) return response({ error: authUpdateError.message }, 400);
    const { error: saveError } = await adminClient.from("app_profiles").update({
      email: normalizedEmail,
      username: metadata.username,
      full_name: metadata.full_name,
      role,
      modules,
      department: appMetadata.department,
      department_privileges: departmentPrivileges,
      updated_at: new Date().toISOString(),
    }).eq("user_id", user.id);
    if (saveError) {
      console.error("Auth account updated but profile update failed.", saveError);
      return response({ error: "Login updated, but the user profile could not be saved. Contact an administrator." }, 500);
    }
    return response({ success: true });
  }

  if (action === "delete") {
    const userId = String(body.userId || "");
    if (!userId || userId === callerData.user.id) return response({ error: "You cannot delete your own account." }, 400);
    const { data: target, error: targetError } = await adminClient.from("app_profiles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    if (targetError || !target) return response({ error: "User account was not found." }, 404);
    if (target.role === "Admin") {
      const { count, error: countError } = await adminClient.from("app_profiles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "Admin");
      if (countError) return response({ error: "Could not verify remaining administrators." }, 500);
      if ((count || 0) <= 1) return response({ error: "Cannot delete the only administrator account." }, 400);
    }
    const { error } = await adminClient.auth.admin.deleteUser(userId);
    if (error) return response({ error: error.message }, 400);
    return response({ success: true });
  }

  return response({ error: "Unknown user-management action." }, 400);
});
