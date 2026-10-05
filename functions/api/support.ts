const SUPPORT_EMAIL = 'admin@trymyelin.app';
const SUPPORT_FROM = 'Myelin Support <support@trymyelin.app>';
const MAX_EMAIL_LENGTH = 254;
const MAX_SUBJECT_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_REQUEST_BYTES = 12_000;

interface Env {
  RESEND_API_KEY?: string;
}

interface SupportFunctionContext {
  request: Request;
  env: Env;
}

interface SupportSubmission {
  email: string;
  subject: string;
  message: string;
}

function json(message: string, status = 200): Response {
  return Response.json(
    { message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

function textField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : null;
}

function isValidEmail(email: string): boolean {
  return (
    email.length > 0 &&
    email.length <= MAX_EMAIL_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function parseSubmission(formData: FormData): SupportSubmission | null {
  const email = textField(formData, 'email');
  const subject = textField(formData, 'subject');
  const message = textField(formData, 'message');

  if (
    email === null ||
    subject === null ||
    message === null ||
    !isValidEmail(email) ||
    subject.length === 0 ||
    subject.length > MAX_SUBJECT_LENGTH ||
    message.length === 0 ||
    message.length > MAX_MESSAGE_LENGTH
  ) {
    return null;
  }

  return {
    email,
    subject: subject.replace(/\s+/g, ' '),
    message,
  };
}

function supportEmailText(submission: SupportSubmission): string {
  return `A new support request was submitted through trymyelin.app.

Customer
Email: ${submission.email}
Subject: ${submission.subject}
Submitted: ${new Date().toISOString()}

Message
${submission.message}

Suggested response
Hi,

Thanks for reaching out to Myelin Support.

[Write your response here.]

If you have any other questions, just reply to this email.

Best,
Myelin Support

Reply to this message to respond directly to ${submission.email}.`;
}

export async function onRequestPost({
  request,
  env,
}: SupportFunctionContext): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return json('Your message is too large.', 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json('Please check the form and try again.', 400);
  }

  if (textField(formData, 'company')) {
    return json('Thanks. Your message has been sent.');
  }

  const submission = parseSubmission(formData);
  if (!submission) {
    return json('Please enter a valid email, subject, and message.', 400);
  }

  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return json(
      'Support is temporarily unavailable. Please try again later.',
      503,
    );
  }

  let result: Response;
  try {
    result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: SUPPORT_FROM,
        to: [SUPPORT_EMAIL],
        reply_to: submission.email,
        subject: `[Myelin Support] ${submission.subject}`,
        text: supportEmailText(submission),
      }),
    });
  } catch {
    return json('We could not send your message. Please try again.', 502);
  }

  if (!result.ok) {
    console.error('Resend rejected a support message', result.status);
    return json('We could not send your message. Please try again.', 502);
  }

  return json('Thanks. Your message has been sent.');
}
