#!/usr/bin/env bun
/**
 * Deterministic OpenAI Responses-compatible provider for the JCode Mobile
 * adapter A/B benchmark. It never calls a real model.
 *
 * Env:
 *   FAKE_PORT        listen port (default 7899)
 *   FAKE_DELTAS      number of text deltas (default 12000)
 *   FAKE_DELTA_TEXT  payload per delta (default 32 ASCII chars)
 *   FAKE_DELAY_MS    delay between deltas (default 0 = burst)
 *   FAKE_MODEL       model id advertised by /v1/models (default fake-bench)
 *   FAKE_LOG         request log path (default ./fake-provider.log)
 *
 * The total assistant text is FAKE_DELTAS * FAKE_DELTA_TEXT bytes unless
 * FAKE_REPLACE_BYTES is set, in which case the stream ends with one
 * response.output_text.done replacement of that many bytes. That exercises
 * the adapter's large-payload transport path.
 */
import { appendFileSync } from 'node:fs';

const PORT = Number(process.env.FAKE_PORT ?? 7899);
const DELTAS = Number(process.env.FAKE_DELTAS ?? 12000);
const DELTA_TEXT = process.env.FAKE_DELTA_TEXT ?? 'abcdefghijklmnopqrstuvwxyz012345';
const DELAY_MS = Number(process.env.FAKE_DELAY_MS ?? 0);
const CHUNK = Number(process.env.FAKE_CHUNK ?? 0);
const CHUNK_MS = Number(process.env.FAKE_CHUNK_MS ?? 0);
const MODEL = process.env.FAKE_MODEL ?? 'fake-bench';
const LOG = process.env.FAKE_LOG ?? new URL('./fake-provider.log', import.meta.url).pathname;
const REPLACE_BYTES = Number(process.env.FAKE_REPLACE_BYTES ?? 0);
const BIG_DELTA_BYTES = Number(process.env.FAKE_BIG_DELTA_BYTES ?? 0);
const BUFFERED = process.env.FAKE_BUFFERED === '1';
const SKIP_BODY = process.env.FAKE_SKIP_BODY === '1';

function log(line: string) {
  const text = `${new Date().toISOString()} ${line}\n`;
  try {
    appendFileSync(LOG, text);
  } catch {
    // best effort
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', connection: 'close' },
  });
}

function models() {
  return {
    object: 'list',
    data: [
      {
        id: MODEL,
        object: 'model',
        created: 1700000000,
        owned_by: 'bench',
      },
    ],
  };
}

function responsesSse(body: Record<string, unknown>) {
  const encoder = new TextEncoder();
  const responseId = `resp_bench_${Date.now().toString(36)}`;
  const itemId = `msg_bench_${Date.now().toString(36)}`;
  const start = performance.now();
  log('responsesSse building');
  const events: string[] = [];
  const push = (event: unknown) => {
    events.push(`data: ${JSON.stringify(event)}\n\n`);
  };
  push({
    type: 'response.created',
    response: { id: responseId, model: body.model ?? MODEL, status: 'in_progress' },
  });
  push({
    type: 'response.output_item.added',
    output_index: 0,
    item: {
      id: itemId,
      type: 'message',
      role: 'assistant',
      status: 'in_progress',
      content: [],
    },
  });
  for (let index = 0; index < DELTAS; index += 1) {
    push({
      type: 'response.output_text.delta',
      delta: DELTA_TEXT,
      output_index: 0,
      content_index: 0,
      item_id: itemId,
    });
  }
  if (BIG_DELTA_BYTES > 0) {
    const bigText = 'İ'.repeat(Math.floor(BIG_DELTA_BYTES / 2));
    push({
      type: 'response.output_text.delta',
      delta: bigText,
      output_index: 0,
      content_index: 0,
      item_id: itemId,
    });
  }
  if (REPLACE_BYTES > 0) {
    push({
      type: 'response.output_text.done',
      text: 'x'.repeat(REPLACE_BYTES),
      output_index: 0,
      content_index: 0,
      item_id: itemId,
    });
  }
  const fullText =
    DELTA_TEXT.repeat(DELTAS) +
    (BIG_DELTA_BYTES > 0 ? 'İ'.repeat(Math.floor(BIG_DELTA_BYTES / 2)) : '');
  push({
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      id: itemId,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: fullText }],
    },
  });
  push({
    type: 'response.completed',
    response: {
      id: responseId,
      model: body.model ?? MODEL,
      status: 'completed',
      output: [
        {
          id: itemId,
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: fullText }],
        },
      ],
      usage: {
        input_tokens: 64,
        output_tokens: Math.max(1, Math.ceil((DELTAS * DELTA_TEXT.length) / 4)),
        total_tokens: 64 + (DELTAS * DELTA_TEXT.length) / 4,
      },
    },
  });
  const doneEvent = 'data: [DONE]\n\n';
  log(`responsesSse built ${events.length} events (buffered=${BUFFERED})`);

  if (BUFFERED) {
    const text = events.join('') + doneEvent;
    log(`responsesSse returning buffered ${text.length} bytes`);
    return new Response(text, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'content-length': String(encoder.encode(text).length),
        connection: 'close',
      },
    });
  }
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        log('responsesSse stream start');
        const send = (event: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        const sendText = (text: string) => {
          send({
            type: 'response.output_text.delta',
            delta: text,
            output_index: 0,
            content_index: 0,
            item_id: itemId,
          });
        };

        for (let index = 0; index < events.length; index += 1) {
          controller.enqueue(encoder.encode(events[index]));
          if (DELAY_MS > 0) await sleep(DELAY_MS);
          const deltaIndex = index - 2;
          if (CHUNK > 0 && CHUNK_MS > 0 && deltaIndex >= 0 && (deltaIndex + 1) % CHUNK === 0) {
            await sleep(CHUNK_MS);
          }
        }
        controller.enqueue(encoder.encode(doneEvent));
        controller.close();
        log(`responses streamed deltas=${DELTAS} in ${(performance.now() - start).toFixed(1)}ms`);
      },
    }),
    {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'close',
      },
    },
  );
}

function chatSse(body: Record<string, unknown>) {
  const encoder = new TextEncoder();
  const id = `chatcmpl_bench_${Date.now().toString(36)}`;
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (delta: unknown, finish: string | null = null) => {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                id,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: body.model ?? MODEL,
                choices: [{ index: 0, delta, finish_reason: finish }],
              })}\n\n`,
            ),
          );
        };
        send({ role: 'assistant', content: '' });
        for (let index = 0; index < DELTAS; index += 1) {
          send({ content: DELTA_TEXT });
          if (DELAY_MS > 0) await sleep(DELAY_MS);
        }
        send({}, 'stop');
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
        log(`chat streamed deltas=${DELTAS}`);
      },
    }),
    {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'close',
      },
    },
  );
}

const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  idleTimeout: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const headers: Record<string, string> = {};
    for (const [key, value] of request.headers) {
      headers[key] = value;
    }
    log(`${request.method} ${url.pathname}${url.search} headers=${JSON.stringify(headers)}`);
    if (url.pathname === '/health') return json({ ok: true, deltas: DELTAS });
    if (url.pathname.endsWith('/models')) return json(models());
    if (url.pathname.endsWith('/chat/completions') && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      return chatSse(body);
    }
    if (url.pathname.endsWith('/responses') && request.method === 'POST') {
      if (SKIP_BODY) {
        log('responses skipping body');
        return responsesSse({ model: MODEL });
      }
      log('responses reading body');
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      log('responses body read');
      return responsesSse(body);
    }
    if (url.pathname.endsWith('/responses') && request.method === 'GET') {
      return json({ object: 'list', data: [] });
    }
    log(`unhandled ${request.method} ${url.pathname}`);
    return json({ error: { message: `unhandled ${request.method} ${url.pathname}` } }, 404);
  },
});

console.log(`fake provider listening on http://127.0.0.1:${server.port}/v1 model=${MODEL} deltas=${DELTAS}`);
