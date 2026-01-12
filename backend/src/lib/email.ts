/**
 * Email service for sending magic links
 *
 * Uses Resend in production (when RESEND_API_KEY is set)
 * Falls back to console logging in development
 */

export interface EmailEnv {
  ENVIRONMENT?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Escape HTML special characters to prevent XSS in emails
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Shared email styles
 */
const EMAIL_STYLES = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .button { display: inline-block; padding: 12px 24px; background-color: #c67d5a; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px; }
`;

/**
 * Sends an invite email with a magic link
 */
export async function sendInviteEmail(
  env: EmailEnv,
  toEmail: string,
  toName: string | null,
  groupName: string,
  magicLink: string
): Promise<void> {
  const safeName = toName !== null ? escapeHtml(toName) : null;
  const greeting = `Hi${safeName ? ' ' + safeName : ''}!`;
  const safeGroupName = escapeHtml(groupName);
  const subject = `You've been invited to join ${groupName}!`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>${EMAIL_STYLES}</style>
    </head>
    <body>
      <div class="container">
        <p>${greeting}</p>
        <p>You've been invited to join <strong>${safeGroupName}</strong> on photodrop - a private photo sharing app.</p>
        <p>Click the button below to accept your invite and get started. This link will expire in 15 minutes.</p>
        <p>
          <a href="${magicLink}" class="button">Join ${safeGroupName}</a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p style="font-size: 12px; color: #6b7280; word-break: break-all;">${magicLink}</p>
        <div class="footer">
          <p>This invite was sent to ${toEmail}. If you didn't expect this email, you can safely ignore it.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
${greeting}

You've been invited to join ${groupName} on photodrop - a private photo sharing app.

Click the link below to accept your invite and get started (link expires in 15 minutes):
${magicLink}

This invite was sent to ${toEmail}. If you didn't expect this email, you can safely ignore it.
  `.trim();

  await sendEmail(env, { to: toEmail, subject, html, text });
}

/**
 * Sends a login link email to an existing user
 */
export async function sendLoginLinkEmail(
  env: EmailEnv,
  toEmail: string,
  toName: string,
  magicLink: string
): Promise<void> {
  const safeName = escapeHtml(toName);
  const subject = 'Log in to photodrop';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>${EMAIL_STYLES}</style>
    </head>
    <body>
      <div class="container">
        <p>Hi ${safeName}!</p>
        <p>Click the button below to log in to photodrop. This link will expire in 15 minutes.</p>
        <p>
          <a href="${magicLink}" class="button">Log in to photodrop</a>
        </p>
        <p>Or copy and paste this link into your browser:</p>
        <p style="font-size: 12px; color: #6b7280; word-break: break-all;">${magicLink}</p>
        <div class="footer">
          <p>This login link was sent to ${toEmail}. If you didn't request this, you can safely ignore it.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Hi ${toName}!

Click the link below to log in to photodrop (link expires in 15 minutes):
${magicLink}

This login link was sent to ${toEmail}. If you didn't request this, you can safely ignore it.
  `.trim();

  await sendEmail(env, { to: toEmail, subject, html, text });
}

/**
 * Low-level email sending function
 * Uses Resend API in production, logs to console in development
 */
async function sendEmail(env: EmailEnv, options: SendEmailOptions): Promise<void> {
  const isProduction = env.ENVIRONMENT === 'production';

  // Production: send via Resend (required)
  if (env.RESEND_API_KEY) {
    if (!env.EMAIL_FROM) {
      throw new Error('EMAIL_FROM must be configured when using Resend');
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Resend API error:', error);
      throw new Error(`Failed to send email: ${response.status}`);
    }

    return;
  }

  // Production without Resend: fail loudly
  if (isProduction) {
    throw new Error(
      'Email sending requires RESEND_API_KEY in production. See README.md for setup instructions.'
    );
  }

  // Development: log to console (safe - only runs locally)
  const magicLinkMatch = options.text.match(/(https?:\/\/[^\s]+\/auth\/[^\s]+)/);
  const magicLink = magicLinkMatch ? magicLinkMatch[1] : null;

  const output = [
    '',
    '═'.repeat(60),
    '📧 DEV EMAIL (not actually sent)',
    '═'.repeat(60),
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
    ...(magicLink ? ['', '🔗 Magic Link:', magicLink] : []),
    '═'.repeat(60),
    '',
  ].join('\n');

  console.warn(output);
}
