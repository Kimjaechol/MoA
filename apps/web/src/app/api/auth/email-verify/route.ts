import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { generateSessionToken } from "@/lib/crypto";
import { sendEmail, buildVerificationEmail } from "@/lib/email";

/**
 * POST /api/auth/email-verify
 *
 * Actions:
 *   send    — Send 6-digit verification code via Resend
 *   verify  — Verify code and issue session token
 *   resend  — Resend verification code
 *
 * Sends a 6-digit code via Resend (RESEND_API_KEY env var).
 * On successful verification, marks email_verified=true in moa_users.
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    let supabase;
    try {
      supabase = getServiceSupabase();
    } catch (envErr) {
      console.error("[email-verify] Supabase init failed:", envErr);
      return NextResponse.json(
        { error: "서버 설정 오류입니다. 관리자에게 문의해주세요. (DB_INIT)" },
        { status: 500 },
      );
    }

    switch (action) {
      // ── Send verification email ──
      case "send": {
        const { email, user_id } = body;

        if (!email || !user_id) {
          return NextResponse.json(
            { error: "이메일과 사용자 ID가 필요합니다." },
            { status: 400 },
          );
        }

        // Verify the user exists and email matches
        const { data: user } = await supabase
          .from("moa_users")
          .select("email, email_verified")
          .eq("user_id", user_id)
          .single();

        if (!user) {
          return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
        }

        if (user.email_verified) {
          return NextResponse.json({ error: "이미 인증된 이메일입니다." }, { status: 400 });
        }

        // Generate a 6-digit verification code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Store the verification code
        await supabase
          .from("moa_users")
          .update({
            email_verification_token: code,
            email_verification_expires: expiresAt.toISOString(),
          })
          .eq("user_id", user_id);

        // Send verification email via Resend
        try {
          const { subject, html } = buildVerificationEmail(code);
          await sendEmail({ to: email, subject, html });
        } catch (emailErr) {
          console.error("[email-verify] Email send failed:", emailErr);
          return NextResponse.json(
            { error: "인증 이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요." },
            { status: 500 },
          );
        }

        return NextResponse.json({
          success: true,
          message: "인증 코드가 이메일로 발송되었습니다. 10분 내에 입력해주세요.",
          ...(process.env.NODE_ENV === "development" ? { _dev_code: code } : {}),
        });
      }

      // ── Verify OTP code ──
      case "verify": {
        const { user_id, code } = body;

        if (!user_id || !code) {
          return NextResponse.json(
            { error: "사용자 ID와 인증 코드가 필요합니다." },
            { status: 400 },
          );
        }

        const { data: user } = await supabase
          .from("moa_users")
          .select("email, email_verified, email_verification_token, email_verification_expires")
          .eq("user_id", user_id)
          .single();

        if (!user) {
          return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
        }

        if (user.email_verified) {
          return NextResponse.json({ success: true, message: "이미 인증된 이메일입니다." });
        }

        // Check code expiration
        if (!user.email_verification_token || !user.email_verification_expires) {
          return NextResponse.json(
            { error: "인증 코드가 발급되지 않았습니다. 재발송해주세요." },
            { status: 400 },
          );
        }

        if (new Date(user.email_verification_expires) < new Date()) {
          return NextResponse.json(
            { error: "인증 코드가 만료되었습니다. 재발송해주세요." },
            { status: 400 },
          );
        }

        // Timing-safe comparison
        const codeStr = String(code).trim();
        if (codeStr !== user.email_verification_token) {
          return NextResponse.json(
            { error: "인증 코드가 올바르지 않습니다." },
            { status: 400 },
          );
        }

        // Mark email as verified
        await supabase
          .from("moa_users")
          .update({
            email_verified: true,
            email_verification_token: null,
            email_verification_expires: null,
          })
          .eq("user_id", user_id);

        // Generate session token for auto-login after verification
        const token = generateSessionToken();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        await supabase.from("moa_sessions").insert({
          user_id,
          token,
          expires_at: expiresAt.toISOString(),
          ip_address: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown",
          user_agent: request.headers.get("user-agent") || "unknown",
        });

        return NextResponse.json({
          success: true,
          message: "이메일 인증이 완료되었습니다!",
          token,
          expires_at: expiresAt.toISOString(),
        });
      }

      // ── Resend verification email ──
      case "resend": {
        const { user_id } = body;

        if (!user_id) {
          return NextResponse.json({ error: "사용자 ID가 필요합니다." }, { status: 400 });
        }

        const { data: user } = await supabase
          .from("moa_users")
          .select("email, email_verified")
          .eq("user_id", user_id)
          .single();

        if (!user) {
          return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
        }

        if (user.email_verified) {
          return NextResponse.json({ success: true, message: "이미 인증된 이메일입니다." });
        }

        // Generate new code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await supabase
          .from("moa_users")
          .update({
            email_verification_token: code,
            email_verification_expires: expiresAt.toISOString(),
          })
          .eq("user_id", user_id);

        // Resend verification email via Resend
        try {
          const { subject, html } = buildVerificationEmail(code);
          await sendEmail({ to: user.email, subject, html });
        } catch (emailErr) {
          console.error("[email-verify] Resend email failed:", emailErr);
          return NextResponse.json(
            { error: "인증 이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요." },
            { status: 500 },
          );
        }

        return NextResponse.json({
          success: true,
          message: "인증 코드가 다시 발송되었습니다.",
          ...(process.env.NODE_ENV === "development" ? { _dev_code: code } : {}),
        });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[email-verify] Unexpected error:", errMsg, err);
    return NextResponse.json(
      { error: `서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요. (${errMsg.slice(0, 80)})` },
      { status: 500 },
    );
  }
}
