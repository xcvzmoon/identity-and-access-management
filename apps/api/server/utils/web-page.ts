import { HTTPError } from 'nitro';
import { useKV } from 'nitro/kv';
import * as valibot from 'valibot';

export async function webPage(): Promise<Response> {
  const asset = await useKV('assets:iam-web').getItem('index.html');

  const page = valibot.safeParse(valibot.string(), asset);
  if (!page.success) {
    throw new HTTPError('IAM web assets are unavailable', { status: 503 });
  }

  return new Response(page.output, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
