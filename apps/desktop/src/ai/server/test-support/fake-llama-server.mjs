/* global process, console, setTimeout, setInterval */
// A stand-in for `llama-server`, for tests only: the same HTTP surface the engine uses, no model.
// Behaviour comes from FAKE_LLAMA (comma-separated): no-avx2, crash-on-start, oom, die-mid-stream,
// slow-load, slow-stream, hang-prompt (accepts the request and never answers, as a long prompt does),
// stall-stream (one token, then nothing), truncate-stream (one token, then the stream ends without [DONE]),
// reset-stream (one token, then the socket is destroyed),
// and for the Vulkan build (started with --device): card-oom, card-crash-start,
// card-crash-request, card-empty. It prints what it was asked to do on stdout as `fake:` lines.
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const arg = (name) => args[args.indexOf(name) + 1];
const modes = (process.env.FAKE_LLAMA ?? '').split(',');
const port = Number(arg('--port'));
const key = arg('--api-key');
const host = arg('--host');
const card = args.includes('--device');
console.log(`fake: args ${JSON.stringify(args)}`);

if (modes.includes('no-avx2')) {
  console.error(
    'system_info: n_threads = 8 | CPU : SSE3 = 1 | SSSE3 = 1 | AVX = 1 | AVX2 = 0 | F16C = 0 |',
  );
  setInterval(() => undefined, 1000);
} else if (modes.includes('crash-on-start')) {
  console.error('fatal: could not load the model');
  process.exit(3);
} else if (card && modes.includes('card-crash-start')) {
  console.error('vk::PhysicalDevice::createDevice: ErrorInitializationFailed');
  process.exit(3);
} else if ((card && modes.includes('card-oom')) || modes.includes('oom')) {
  console.error(
    'ggml_backend_cpu_buffer_type_alloc_buffer: failed to allocate buffer of size 4683072032',
  );
  process.exit(1);
} else {
  console.error(
    'system_info: n_threads = 8 | CPU : SSE3 = 1 | SSSE3 = 1 | AVX = 1 | AVX2 = 1 | F16C = 1 |',
  );
  if (card) {
    console.error(
      `load_tensors: offloaded ${modes.includes('card-empty') ? 0 : 29}/29 layers to GPU`,
    );
  }
  let hung = false;
  const readyAt = Date.now() + (modes.includes('slow-load') ? 800 : 50);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(Date.now() < readyAt ? 503 : 200).end('{}');
      return;
    }
    if (req.headers.authorization !== `Bearer ${key}`) {
      res.writeHead(401).end('{"error":"invalid api key"}');
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    if (card && modes.includes('card-crash-request')) process.exit(9);
    console.log('fake: request');
    if (modes.includes('hang-prompt') && !hung) {
      hung = true;
      res.on('close', () => console.log('fake: client closed'));
      return; // never answers; the client gives up, or the process is ended
    }
    const request = JSON.parse(body);
    const last = request.messages.at(-1).content;
    const text = typeof last === 'string' ? last : '(a picture)';
    const format = request.response_format?.json_schema?.name;
    const answer =
      format === 'page'
        ? JSON.stringify({
            language: 'en',
            blocks: [{ type: 'paragraph', text: 'Stand-in page, 2026-10-19' }],
          })
        : format === 'proofread'
          ? JSON.stringify({ issues: [{ span: 'Teh', kind: 'spelling', fix: 'The' }] })
          : request.response_format
            ? JSON.stringify({ indices: [1] })
            : `[${text
                .replace(/<[^>]+>/g, '')
                .trim()
                .slice(0, 40)}] ok`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.on('close', () => console.log('fake: client closed'));
    const pieces = answer.match(/\S+\s*/g) ?? [];
    for (const [index, piece] of pieces.entries()) {
      if (modes.includes('die-mid-stream') && index === 1) process.exit(9);
      if (modes.includes('slow-stream')) await sleep(150);
      if (index === 1 && modes.includes('stall-stream')) await new Promise(() => undefined);
      if (index === 1 && modes.includes('truncate-stream')) return void res.end();
      if (index === 1 && modes.includes('reset-stream')) return void res.socket.destroy();
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      console.log(`fake: piece ${index}`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }).listen(port, host, () => console.log(`fake: listening on ${host}:${port}`));
}
