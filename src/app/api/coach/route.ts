import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AccessError, AuthError, requireActiveUser } from '@/lib/auth/require-user';
import { askCoach } from '@/lib/coach/coach';
import { AiError } from '@/lib/ai/provider';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  question: z.string().trim().min(2, 'Ask a question.').max(1000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4000),
      }),
    )
    .max(20)
    .optional(),
});

export async function POST(request: Request) {
  let auth;
  try {
    auth = await requireActiveUser(request);
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof AccessError) {
      // Specific, user-facing reason with the decision attached so the UI can
      // render the right blocked screen — never a generic error (Phase 5).
      return NextResponse.json(
        { error: err.message, code: err.decision.code, access: err.decision },
        { status: err.status },
      );
    }
    throw err;
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request.', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    // The tenant-scoped db is the only data the coach can reach.
    const result = await askCoach(auth.db, parsed.data.question, {
      history: parsed.data.history,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AiError) {
      console.error('Coach provider call failed:', err.message);
      return NextResponse.json({ error: err.message, code: 'AI_ERROR' }, { status: 502 });
    }
    console.error('Coach failed:', err);
    return NextResponse.json({ error: 'Coach failed. Check server logs.' }, { status: 500 });
  }
}
