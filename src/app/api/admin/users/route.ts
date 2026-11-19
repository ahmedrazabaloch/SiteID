import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const createUserSchema = z.object({
  username: z.string().regex(/^03\d{9}$/, "Enter an 11-digit ID starting with 03."),
  fullName: z.string().trim().min(1).max(80),
  role: z.enum(["admin", "operator"]),
  shift: z.enum(["day", "evening", "night"]),
  password: z.string().min(10).max(72),
});

type Access = { admin: ReturnType<typeof createAdminClient>; userId: string } | { response: NextResponse };

async function requireSuperAdmin(): Promise<Access> {
  try {
    const sessionClient = await createClient();
    const { data: { user }, error: authError } = await sessionClient.auth.getUser();
    if (authError || !user) return { response: NextResponse.json({ error: "Sign in to manage accounts." }, { status: 401 }) };

    const { data: profile, error: profileError } = await sessionClient.from("profiles").select("role,is_active").eq("id", user.id).maybeSingle();
    if (profileError) return { response: NextResponse.json({ error: "Could not verify your account permissions." }, { status: 500 }) };
    if (!profile?.is_active) return { response: NextResponse.json({ error: "This account is inactive." }, { status: 403 }) };
    if (profile.role !== "super_admin") return { response: NextResponse.json({ error: "Only the super admin can manage accounts." }, { status: 403 }) };
    return { admin: createAdminClient(), userId: user.id };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not verify account access.";
    return { response: NextResponse.json({ error: message }, { status: 503 }) };
  }
}

export async function GET() {
  const access = await requireSuperAdmin();
  if ("response" in access) return access.response;
  try {
    const authUsers = [];
    for (let page = 1; ; page++) {
      const { data, error } = await access.admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      authUsers.push(...data.users);
      if (data.users.length < 1000) break;
    }
    const { data: profiles, error: profileError } = await access.admin.from("profiles").select("id,username,full_name,role,operator_shift,is_active,created_at");
    if (profileError) throw profileError;
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const users = authUsers.map((authUser) => {
      const profile = profileById.get(authUser.id);
      return {
        id: authUser.id,
        username: profile?.username ?? null,
        email: authUser.email ?? null,
        phone: authUser.phone ?? null,
        full_name: profile?.full_name || String(authUser.user_metadata?.full_name ?? ""),
        role: profile?.role ?? "operator",
        operator_shift: profile?.operator_shift ?? "day",
        is_active: profile?.is_active ?? true,
        created_at: authUser.created_at,
      };
    }).sort((a, b) => a.full_name.localeCompare(b.full_name));
    return NextResponse.json({ users, currentUserId: access.userId });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Could not load user accounts." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const access = await requireSuperAdmin();
  if ("response" in access) return access.response;
  try {
  let input: unknown;
  try { input = await request.json(); }
  catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the account details and try again." }, { status: 400 });

  const value = parsed.data;
  const authEmail = `${value.username}@users.fuelops.invalid`;
  const { data: created, error: createError } = await access.admin.auth.admin.createUser({
    email: authEmail,
    email_confirm: true,
    password: value.password,
    user_metadata: { full_name: value.fullName },
  });
  if (createError) {
    console.error("[admin/users] Supabase Auth createUser failed", {
      code: createError.code,
      status: createError.status,
      message: createError.message,
    });
    const duplicate = /already|exists|duplicate/i.test(createError.message);
    return NextResponse.json({ error: duplicate ? "This ID number already belongs to an account." : "Supabase could not create this account. Check the server log for the Auth error details." }, { status: duplicate ? 409 : 400 });
  }
  if (!created.user) return NextResponse.json({ error: "Supabase did not return the new account." }, { status: 502 });

  const { data: profile, error: profileError } = await access.admin.from("profiles").update({
    username: value.username,
    full_name: value.fullName,
    role: value.role,
    operator_shift: value.shift,
    is_active: true,
  }).eq("id", created.user.id).select("id,username,full_name,role,operator_shift,is_active,created_at").maybeSingle();
  if (profileError || !profile) {
    await access.admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "The profile could not be created. No account was kept; please try again." }, { status: 500 });
  }
  return NextResponse.json({ user: { ...profile, email: null, phone: null, created_at: created.user.created_at } }, { status: 201 });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Could not create the account. Please try again." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const access = await requireSuperAdmin();
  if ("response" in access) return access.response;
  try {
  let body: { userId?: unknown; isActive?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (typeof body.userId !== "string" || typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "A user ID and active status are required." }, { status: 400 });
  }
  if (body.userId === access.userId) return NextResponse.json({ error: "You cannot deactivate your own super admin account." }, { status: 400 });

  const { data: target, error: findError } = await access.admin.from("profiles").select("id,role,full_name,username").eq("id", body.userId).maybeSingle();
  if (findError) return NextResponse.json({ error: "Could not find this account." }, { status: 500 });
  if (!target) return NextResponse.json({ error: "This account no longer exists." }, { status: 404 });
  if (target.role === "super_admin") return NextResponse.json({ error: "A super admin account cannot be deactivated here." }, { status: 403 });

  const { error: updateError } = await access.admin.from("profiles").update({ is_active: body.isActive, updated_at: new Date().toISOString() }).eq("id", target.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ id: target.id, isActive: body.isActive });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Could not update the account. Please try again." }, { status: 500 });
  }
}
