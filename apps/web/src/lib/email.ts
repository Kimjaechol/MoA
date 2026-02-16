/**
 * Email sending via Resend API (https://resend.com)
 *
 * Environment variable: RESEND_API_KEY
 * Free tier: 3,000 emails/month
 */

const RESEND_API_URL = "https://api.resend.com/emails";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailOptions) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "MoA <onboarding@resend.dev>",
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Resend API error (${res.status}): ${error}`);
  }

  return await res.json();
}

export function buildVerificationEmail(code: string): { subject: string; html: string } {
  return {
    subject: `[MoA] 이메일 인증 코드: ${code}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; color: #333;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 24px; font-weight: 700; margin: 0;">MoA</h1>
    <p style="color: #666; margin-top: 4px;">이메일 인증</p>
  </div>
  <div style="background: #f8f9fa; border-radius: 12px; padding: 32px; text-align: center; margin-bottom: 24px;">
    <p style="margin: 0 0 16px; font-size: 15px;">인증 코드를 입력해주세요:</p>
    <div style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #111; font-family: monospace;">${code}</div>
  </div>
  <p style="font-size: 13px; color: #888; text-align: center;">
    이 코드는 <strong>10분간</strong> 유효합니다.<br>
    본인이 요청하지 않았다면 이 이메일을 무시해주세요.
  </p>
</body>
</html>`,
  };
}
