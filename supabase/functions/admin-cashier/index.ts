import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function firstConfiguredKey(name: string): string | undefined {
  try {
    const values = Object.values(JSON.parse(Deno.env.get(name) ?? "{}"));
    return values.find((value): value is string => typeof value === "string");
  } catch {
    return undefined;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method tidak diizinkan." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? firstConfiguredKey("SUPABASE_PUBLISHABLE_KEYS");
  const serviceKey = Deno.env.get("ALASTEMPUR_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? firstConfiguredKey("SUPABASE_SECRET_KEYS");
  const appUrl = Deno.env.get("APP_URL");
  if (!supabaseUrl || !anonKey || !serviceKey || !appUrl) {
    return json({ error: "Konfigurasi Edge Function belum lengkap. Periksa secret APP_URL dan ALASTEMPUR_SERVICE_KEY." }, 500);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) return json({ error: "Sesi login dibutuhkan." }, 401);

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Sesi login tidak valid. Silakan login ulang." }, 401);

  const { data: callerProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("role,is_active")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) return json({ error: profileError.message }, 500);
  if (callerProfile?.role !== "superadmin" || callerProfile.is_active !== true) {
    return json({ error: "Hanya super admin aktif yang boleh mengelola akun kasir." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Data permintaan tidak valid." }, 400);
  }

  if (body.action === "invite") {
    const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (fullName.length < 2 || fullName.length > 100) return json({ error: "Nama harus berisi 2–100 karakter." }, 400);
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Format email tidak valid." }, 400);
    if (!/^\d{10,14}$/.test(phone)) return json({ error: "Nomor telepon harus 10–14 digit angka." }, 400);

    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, phone },
      redirectTo: `${appUrl.replace(/\/$/, "")}/?invite=true`,
    });
    if (error) return json({ error: error.message }, 400);

    await adminClient.from("audit_logs").insert({
      actor_id: authData.user.id,
      action: "cashier.invited",
      target_user_id: data.user?.id ?? null,
      details: { email, full_name: fullName },
    });
    return json({ ok: true, message: "Undangan kasir berhasil dikirim." });
  }

  if (body.action === "set_active") {
    const targetId = typeof body.user_id === "string" ? body.user_id : "";
    const active = body.active;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId)) {
      return json({ error: "ID akun tidak valid." }, 400);
    }
    if (targetId === authData.user.id) return json({ error: "Akun super admin sendiri tidak dapat dinonaktifkan dari menu ini." }, 400);
    if (typeof active !== "boolean") return json({ error: "Status akun tidak valid." }, 400);

    const { data: target, error: targetError } = await adminClient
      .from("profiles")
      .select("id,role,email,full_name,is_active")
      .eq("id", targetId)
      .maybeSingle();
    if (targetError) return json({ error: targetError.message }, 500);
    if (!target || target.role !== "kasir") return json({ error: "Akun kasir tidak ditemukan." }, 404);

    const { error: updateError } = await adminClient
      .from("profiles")
      .update({ is_active: active, updated_at: new Date().toISOString() })
      .eq("id", targetId);
    if (updateError) return json({ error: updateError.message }, 500);

    await adminClient.from("audit_logs").insert({
      actor_id: authData.user.id,
      action: active ? "cashier.activated" : "cashier.deactivated",
      target_user_id: targetId,
      details: { email: target.email, full_name: target.full_name },
    });
    return json({ ok: true, message: active ? "Akun kasir diaktifkan." : "Akun kasir dinonaktifkan." });
  }

  return json({ error: "Aksi tidak dikenal." }, 400);
});
