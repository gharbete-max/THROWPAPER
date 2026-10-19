/* global process, console, setTimeout, setInterval */
// A stand-in for `llama-server`, for tests only: the same HTTP surface the engine uses, no model.
// Behaviour comes from FAKE_LLAMA (comma-separated): no-avx2, crash-on-start, oom, die-mid-stream,
// slow-load, slow-stream. It prints what it was asked to do on stdout as `fake:` lines.
import { createServer } from 'node:http';

const args = process.argv.slice(2);
const arg = (name) => args[args.indexOf(name) + 1];
const modes = (process.env.FAKE_LLAMA ?? '').split(',');
const port = Number(arg('--port'));
const key = arg('--api-key');
const host = arg('--host');
console.log(`fake: args ${JSON.stringify(args)}`);

if (modes.includes('no-avx2')) {
  console.error(
    'system_info: n_threads = 8 | CPU : SSE3 = 1 | SSSE3 = 1 | AVX = 1 | AVX2 = 0 | F16C = 0 |',
  );
  setInterval(() => undefined, 1000);
} else if (modes.includes('crash-on-start')) {
  console.error('fatal: could not load the model');
  process.exit(3);
} else if (modes.includes('oom')) {
  console.error(
    'ggml_backend_cpu_buffer_type_alloc_buffer: failed to allocate buffer of size 4683072032',
  );
  process.exit(1);
} else {
  console.error(
    'system_info: n_threads = 8 | CPU : SSE3 = 1 | SSSE3 = 1 | AVX = 1 | AVX2 = 1 | F16C = 1 |',
  );
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
    const request = JSON.parse(body);
    const last = request.messages.at(-1).content;
    const text = typeof last === 'string' ? last : '(a picture)';
    const answer = request.response_format
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
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  }).listen(port, host, () => console.log(`fake: listening on ${host}:${port}`));
}
