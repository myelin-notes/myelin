// POST adds an email to the Resend segment that gets the Pro launch broadcast.
const MAX_EMAIL_LENGTH = 254;

interface Env {
  RESEND_API_KEY?: string;
  RESEND_WAITLIST_SEGMENT_ID?: string;
}

interface WaitlistFunctionContext {
  request: Request;
  env: Env;
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

export async function onRequestPost({
  request,
  env,
}: WaitlistFunctionContext): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json('Please enter your email address.', 400);
  }

  const company = formData.get('company');
  if (typeof company === 'string' && company.trim()) {
    return json('You are on the list.');
  }

  const rawEmail = formData.get('email');
  const email =
    typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  if (
    email.length > MAX_EMAIL_LENGTH ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return json('Please enter a valid email address.', 400);
  }

  const apiKey = env.RESEND_API_KEY?.trim();
  const segmentId = env.RESEND_WAITLIST_SEGMENT_ID?.trim();
  if (!apiKey || !segmentId) {
    return json('The waitlist is temporarily unavailable.', 503);
  }

  let result: Response;
  try {
    result = await fetch('https://api.resend.com/contacts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, segments: [{ id: segmentId }] }),
    });
  } catch {
    return json('We could not add you. Please try again.', 502);
  }

  if (!result.ok) {
    console.error(
      'Resend rejected a waitlist contact',
      result.status,
      await result.text(),
    );
    return json('We could not add you. Please try again.', 502);
  }

  return json('You are on the list.');
}
