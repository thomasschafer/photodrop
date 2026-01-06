/**
 * Email service for sending magic links via Cloudflare Email Workers
 *
 * Note: This requires Cloudflare Email Workers to be configured
 * See: https://developers.cloudflare.com/email-routing/email-workers/
 */

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends an invite email with a magic link
 */
export async function sendInviteEmail(
  toEmail: string,
  toName: string,
  groupName: string,
  magicLink: string,
  _fromEmail: string = 'noreply@photodrop.app'
): Promise<void> {
  const subject = `You've been invited to join ${groupName}!`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Welcome to photodrop!</h1>
        <p>Hi ${toName}!</p>
        <p>You've been invited to join <strong>${groupName}</strong> on photodrop - a private photo sharing app.</p>
        <p>Click the button below to accept your invite and get started. This link will expire in 15 minutes.</p>
        <p>
          <a href="${magicLink}" class="button">Join ${groupName}</a>
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
Hi ${toName}!

You've been invited to join ${groupName} on photodrop - a private photo sharing app.

Click the link below to accept your invite and get started (link expires in 15 minutes):
${magicLink}

This invite was sent to ${toEmail}. If you didn't expect this email, you can safely ignore it.
  `.trim();

  await sendEmail({ to: toEmail, subject, html, text });
}

/**
 * Sends a login link email to an existing user
 */
export async function sendLoginLinkEmail(
  toEmail: string,
  toName: string,
  magicLink: string,
  _fromEmail: string = 'noreply@photodrop.app'
): Promise<void> {
  const subject = 'Log in to photodrop';

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Log in to photodrop</h1>
        <p>Hi ${toName}!</p>
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

  await sendEmail({ to: toEmail, subject, html, text });
}

/**
 * Low-level email sending function
 * TODO: Implement using Cloudflare Email Workers
 */
async function sendEmail(options: SendEmailOptions): Promise<void> {
  // TODO: Implement email sending via Cloudflare Email Workers
  // For now, just log to console for development
  console.log('📧 Email would be sent:', {
    to: options.to,
    subject: options.subject,
  });

  // In production, this will use Cloudflare Email Workers:
  // const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
  //   method: 'POST',
  //   headers: { 'content-type': 'application/json' },
  //   body: JSON.stringify({
  //     personalizations: [{ to: [{ email: options.to }] }],
  //     from: { email: 'noreply@photodrop.app', name: 'photodrop' },
  //     subject: options.subject,
  //     content: [
  //       { type: 'text/plain', value: options.text },
  //       { type: 'text/html', value: options.html },
  //     ],
  //   }),
  // });
}
