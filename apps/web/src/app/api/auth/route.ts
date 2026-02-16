import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { hashPassword, verifyPassword, generateSessionToken } from "@/lib/crypto";
import { validatePhoneNumber, findCountryByCode } from "@/lib/phone-validation";

// scryptSync requires Node.js runtime (not Edge)
export const runtime = "nodejs";

/**
 * POST /api/auth
 *
 * Actions:
 *   register   — Create a new user account (username + password + 구문번호)
 *   login      — Authenticate with username + password + 구문번호
 *   logout     — Invalidate session token
 *   validate   — Check if a session token is still valid
 *   change_password    — Change password (requires current password)
 *   change_passphrase  — Change 구문번호 (requires current password)
 *
 * 사용자 인증 3중 보안:
 *   1. 아이디/비밀번호 (기본 인증)
 *   2. 구문번호 (추가 인증 — 사용자가 설정한 보안 문구)
 *   3. 기기 인증 (별도 — device-auth.ts의 페어링 코드 시스템)
 */

const USERNAME_REGEX = /^[a-zA-Z0-9가-힣_]{2,30}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSPHRASE_MIN_LENGTH = 4;
const SESSION_TTL_HOURS = 24 * 7; // 7일
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    let supabase;
    try {
      supabase = getServiceSupabase();
    } catch (envErr) {
      console.error("[auth] Supabase init failed:", envErr);
      return NextResponse.json(
        { error: "서버 설정 오류입니다. 관리자에게 문의해주세요. (DB_INIT)" },
        { status: 500 },
      );
    }

    switch (action) {
      // ── Register ──────────────────────────────────────
      case "register": {
        const { username, password, passphrase, phone, country_code, email, nickname } = body;

        // Validate username
        if (!username || !USERNAME_REGEX.test(username)) {
          return NextResponse.json(
            { error: "아이디는 2~30자의 영문, 한글, 숫자, 밑줄(_)만 사용할 수 있습니다." },
            { status: 400 },
          );
        }

        // Validate email (required)
        if (!email || !EMAIL_REGEX.test(email)) {
          return NextResponse.json(
            { error: "올바른 이메일 주소를 입력해주세요." },
            { status: 400 },
          );
        }

        // Validate password
        if (!password || password.length < PASSWORD_MIN_LENGTH) {
          return NextResponse.json(
            { error: `비밀번호는 최소 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.` },
            { status: 400 },
          );
        }

        // Validate passphrase (구문번호)
        if (!passphrase || passphrase.length < PASSPHRASE_MIN_LENGTH) {
          return NextResponse.json(
            { error: `구문번호는 최소 ${PASSPHRASE_MIN_LENGTH}자 이상이어야 합니다.` },
            { status: 400 },
          );
        }

        // Validate country code
        if (!country_code || !findCountryByCode(country_code)) {
          return NextResponse.json(
            { error: "국가를 선택해주세요." },
            { status: 400 },
          );
        }

        // Validate phone number (required, format must match country)
        if (!phone) {
          return NextResponse.json(
            { error: "휴대폰 번호를 입력해주세요." },
            { status: 400 },
          );
        }

        const phoneResult = validatePhoneNumber(country_code, phone);
        if (!phoneResult.valid) {
          return NextResponse.json(
            { error: phoneResult.error },
            { status: 400 },
          );
        }

        // Check duplicate username
        const { data: existing, error: usernameCheckErr } = await supabase
          .from("moa_users")
          .select("id")
          .eq("username", username.toLowerCase())
          .single();

        if (usernameCheckErr && usernameCheckErr.code !== "PGRST116") {
          // PGRST116 = "not found" — expected when username is available
          console.error("[auth] Username check failed:", usernameCheckErr);
          return NextResponse.json(
            { error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요. (DB_QUERY)" },
            { status: 500 },
          );
        }

        if (existing) {
          return NextResponse.json(
            { error: "이미 사용 중인 아이디입니다." },
            { status: 409 },
          );
        }

        // Check duplicate email
        const { data: existingEmail, error: emailCheckErr } = await supabase
          .from("moa_users")
          .select("id")
          .eq("email", email.toLowerCase())
          .single();

        if (emailCheckErr && emailCheckErr.code !== "PGRST116") {
          console.error("[auth] Email check failed:", emailCheckErr);
          return NextResponse.json(
            { error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요. (DB_QUERY)" },
            { status: 500 },
          );
        }

        if (existingEmail) {
          return NextResponse.json(
            { error: "이미 사용 중인 이메일입니다." },
            { status: 409 },
          );
        }

        // Check duplicate phone (E.164 normalized)
        const { data: existingPhone, error: phoneCheckErr } = await supabase
          .from("moa_users")
          .select("id")
          .eq("phone", phoneResult.normalized!)
          .single();

        if (phoneCheckErr && phoneCheckErr.code !== "PGRST116") {
          console.error("[auth] Phone check failed:", phoneCheckErr);
          return NextResponse.json(
            { error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요. (DB_QUERY)" },
            { status: 500 },
          );
        }

        if (existingPhone) {
          return NextResponse.json(
            { error: "이미 등록된 휴대폰 번호입니다." },
            { status: 409 },
          );
        }

        // Hash password and passphrase
        let passwordHash: string;
        let passphraseHash: string;
        try {
          passwordHash = hashPassword(password);
          passphraseHash = hashPassword(passphrase);
        } catch (hashErr) {
          const errMsg = hashErr instanceof Error ? hashErr.message : String(hashErr);
          console.error("[auth] Password hashing failed:", errMsg, hashErr);
          return NextResponse.json(
            { error: `서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요. (HASH: ${errMsg})` },
            { status: 500 },
          );
        }

        // Create user record
        const userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const { error: insertError } = await supabase.from("moa_users").insert({
          user_id: userId,
          username: username.toLowerCase(),
          display_name: nickname || username,
          password_hash: passwordHash,
          passphrase_hash: passphraseHash,
          email: email.toLowerCase(),
          phone: phoneResult.normalized,
          country_code: country_code.toUpperCase(),
        });

        if (insertError) {
          console.error("[auth] Register insert failed:", insertError);
          return NextResponse.json(
            { error: "회원가입에 실패했습니다. 잠시 후 다시 시도해주세요. (DB_INSERT)" },
            { status: 500 },
          );
        }

        // Also create user_settings entry
        const { error: settingsError } = await supabase.from("moa_user_settings").upsert({
          user_id: userId,
          model_strategy: "cost-efficient",
          trial_started_at: new Date().toISOString(),
          trial_days: 30,
          is_premium: false,
          phone: phoneResult.normalized,
          phone_verified: false,
        }, { onConflict: "user_id" });

        if (settingsError) {
          console.error("[auth] User settings creation failed:", settingsError);
          // Non-fatal: user was created, continue
        }

        // Create initial credits
        const { error: creditsError } = await supabase.from("moa_credits").upsert({
          user_id: userId,
          balance: 100,
          monthly_quota: 100,
          monthly_used: 0,
          plan: "free",
        }, { onConflict: "user_id" });

        if (creditsError) {
          console.error("[auth] Credits creation failed:", creditsError);
          // Non-fatal: user was created, continue
        }

        // No session token yet — user must verify email first.
        // The email-verify API will issue a session token after verification.
        return NextResponse.json({
          success: true,
          user_id: userId,
          username: username.toLowerCase(),
          display_name: nickname || username,
          email_verification_required: true,
        });
      }

      // ── Login ──────────────────────────────────────
      case "login": {
        const { username, password, passphrase } = body;

        if (!username || !password || !passphrase) {
          return NextResponse.json(
            { error: "아이디, 비밀번호, 구문번호를 모두 입력해주세요." },
            { status: 400 },
          );
        }

        // Find user
        const { data: user, error: findError } = await supabase
          .from("moa_users")
          .select("*")
          .eq("username", username.toLowerCase())
          .single();

        if (findError || !user) {
          return NextResponse.json(
            { error: "아이디 또는 비밀번호가 올바르지 않습니다." },
            { status: 401 },
          );
        }

        // Check lockout
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
          const remainMin = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
          return NextResponse.json(
            { error: `로그인 시도 횟수를 초과했습니다. ${remainMin}분 후 다시 시도해주세요.` },
            { status: 429 },
          );
        }

        // Verify password
        if (!verifyPassword(password, user.password_hash)) {
          await incrementLoginAttempts(supabase, user);
          return NextResponse.json(
            { error: "아이디 또는 비밀번호가 올바르지 않습니다." },
            { status: 401 },
          );
        }

        // Verify passphrase (구문번호)
        if (!verifyPassword(passphrase, user.passphrase_hash)) {
          await incrementLoginAttempts(supabase, user);
          return NextResponse.json(
            { error: "구문번호가 올바르지 않습니다." },
            { status: 401 },
          );
        }

        // Check email verification
        if (!user.email_verified) {
          return NextResponse.json(
            {
              error: "이메일 인증이 필요합니다. 가입 시 발송된 인증 코드를 확인해주세요.",
              email_verification_required: true,
              user_id: user.user_id,
              email: user.email,
              username: user.username,
            },
            { status: 403 },
          );
        }

        // Reset login attempts on success
        await supabase
          .from("moa_users")
          .update({ failed_login_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() })
          .eq("id", user.id);

        // Generate session token
        const token = generateSessionToken();
        const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

        await supabase.from("moa_sessions").insert({
          user_id: user.user_id,
          token,
          expires_at: expiresAt.toISOString(),
          ip_address: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown",
          user_agent: request.headers.get("user-agent") || "unknown",
        });

        // Fetch user's devices (for web chat remote control)
        let devices: { deviceName: string; platform: string; status: string }[] = [];
        try {
          const { data: devicesData } = await supabase
            .from("relay_devices")
            .select("device_name, platform, is_online")
            .eq("user_id", user.user_id);

          devices = (devicesData ?? []).map((d: { device_name: string; platform: string; is_online: boolean }) => ({
            deviceName: d.device_name,
            platform: d.platform,
            status: d.is_online ? "online" : "offline",
          }));
        } catch { /* relay_devices may not exist */ }

        return NextResponse.json({
          success: true,
          user_id: user.user_id,
          username: user.username,
          display_name: user.display_name,
          token,
          expires_at: expiresAt.toISOString(),
          devices,
        });
      }

      // ── Logout ──────────────────────────────────────
      case "logout": {
        const { token } = body;
        if (!token) {
          return NextResponse.json({ error: "Token is required" }, { status: 400 });
        }

        await supabase.from("moa_sessions").delete().eq("token", token);
        return NextResponse.json({ success: true });
      }

      // ── Validate Session ──────────────────────────────
      case "validate": {
        const { token } = body;
        if (!token) {
          return NextResponse.json({ success: false, error: "Token is required" }, { status: 400 });
        }

        const session = await validateSession(supabase, token);
        if (!session) {
          return NextResponse.json({ success: false, error: "세션이 만료되었거나 유효하지 않습니다." }, { status: 401 });
        }

        return NextResponse.json({
          success: true,
          user_id: session.user_id,
        });
      }

      // ── Change Password ──────────────────────────────
      case "change_password": {
        const { token, current_password, new_password } = body;

        if (!token || !current_password) {
          return NextResponse.json({ error: "토큰과 현재 비밀번호가 필요합니다." }, { status: 400 });
        }

        const session = await validateSession(supabase, token);
        if (!session) {
          return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
        }

        if (!new_password || new_password.length < PASSWORD_MIN_LENGTH) {
          return NextResponse.json(
            { error: `새 비밀번호는 최소 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.` },
            { status: 400 },
          );
        }

        const { data: user } = await supabase
          .from("moa_users")
          .select("password_hash")
          .eq("user_id", session.user_id)
          .single();

        if (!user || !verifyPassword(current_password, user.password_hash)) {
          return NextResponse.json({ error: "현재 비밀번호가 올바르지 않습니다." }, { status: 401 });
        }

        const newHash = hashPassword(new_password);
        await supabase.from("moa_users").update({ password_hash: newHash }).eq("user_id", session.user_id);

        return NextResponse.json({ success: true });
      }

      // ── Change Passphrase ──────────────────────────────
      case "change_passphrase": {
        const { token, current_password, new_passphrase } = body;

        if (!token || !current_password) {
          return NextResponse.json({ error: "토큰과 현재 비밀번호가 필요합니다." }, { status: 400 });
        }

        const session = await validateSession(supabase, token);
        if (!session) {
          return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
        }

        if (!new_passphrase || new_passphrase.length < PASSPHRASE_MIN_LENGTH) {
          return NextResponse.json(
            { error: `새 구문번호는 최소 ${PASSPHRASE_MIN_LENGTH}자 이상이어야 합니다.` },
            { status: 400 },
          );
        }

        const { data: user } = await supabase
          .from("moa_users")
          .select("password_hash")
          .eq("user_id", session.user_id)
          .single();

        if (!user || !verifyPassword(current_password, user.password_hash)) {
          return NextResponse.json({ error: "현재 비밀번호가 올바르지 않습니다." }, { status: 401 });
        }

        const newHash = hashPassword(new_passphrase);
        await supabase.from("moa_users").update({ passphrase_hash: newHash }).eq("user_id", session.user_id);

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[auth] Unexpected error:", errMsg, err);
    return NextResponse.json(
      { error: `서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요. (${errMsg.slice(0, 80)})` },
      { status: 500 },
    );
  }
}

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function incrementLoginAttempts(supabase: any, user: any) {
  const attempts = (user.failed_login_attempts || 0) + 1;
  const update: Record<string, unknown> = { failed_login_attempts: attempts };

  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    update.locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
  }

  await supabase.from("moa_users").update(update).eq("id", user.id);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function validateSession(supabase: any, token: string): Promise<{ user_id: string } | null> {
  const { data, error } = await supabase
    .from("moa_sessions")
    .select("user_id, expires_at")
    .eq("token", token)
    .single();

  if (error || !data) return null;

  // Check expiration
  if (new Date(data.expires_at) < new Date()) {
    // Clean up expired session
    await supabase.from("moa_sessions").delete().eq("token", token);
    return null;
  }

  return { user_id: data.user_id };
}
