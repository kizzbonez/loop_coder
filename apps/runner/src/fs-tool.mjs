// File operations for an API agent. Runs as its own process under the unprivileged tool user
// (never as the runner), reads one JSON request on stdin and prints one JSON result.
// Every path is checked again here after resolving symbolic links, so a link the agent made
// cannot lead outside its folders.
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_READ_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_LIST = 400;
const SKIP = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.cache', '.turbo', '.venv', '__pycache__']);

const reply = (result) => process.stdout.write(JSON.stringify(result));

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** The real path of `abs`, or of its nearest existing parent joined with the missing rest. */
async function realish(abs) {
  let current = abs;
  const rest = [];
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...rest.reverse());
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
      const parent = path.dirname(current);
      if (parent === current) throw err;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

async function checked(base, roots, rel) {
  const abs = path.join(base, rel);
  const real = await realish(abs);
  const realRoots = await Promise.all(roots.map((r) => realish(path.join(base, r))));
  if (!realRoots.some((r) => real === r || real.startsWith(r + path.sep))) {
    throw Object.assign(new Error('That path leads outside your folders (through a link).'), { code: 'EOUTSIDE' });
  }
  return real;
}

const lines = (text) => text.replace(/\r\n/g, '\n');

async function list(abs, rel, depth) {
  const out = [];
  async function walk(dir, prefix, level) {
    if (out.length >= MAX_LIST) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (level === 0) throw err;
      return;
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= MAX_LIST) {
        out.push('… (more entries not shown)');
        return;
      }
      const name = prefix + e.name + (e.isDirectory() ? '/' : '');
      out.push(name);
      if (e.isDirectory() && level + 1 < depth && !SKIP.has(e.name)) await walk(path.join(dir, e.name), name, level + 1);
    }
  }
  await walk(abs, '', 0);
  return out.length ? `${rel}/\n${out.join('\n')}` : `${rel}/ is empty`;
}

async function main() {
  const req = await readStdin();
  const { op, base, roots, rel } = req;
  const abs = await checked(base, roots, rel);
  switch (op) {
    case 'list':
      return reply({ ok: true, text: await list(abs, rel, Math.min(Math.max(req.depth ?? 2, 1), 4)) });
    case 'read': {
      const stat = await fs.stat(abs);
      if (stat.isDirectory()) return reply({ ok: true, text: await list(abs, rel, 1) });
      const handle = await fs.open(abs, 'r');
      const buf = Buffer.alloc(Math.min(stat.size, MAX_READ_BYTES));
      await handle.read(buf, 0, buf.length, 0);
      await handle.close();
      if (buf.includes(0)) return reply({ ok: false, error: `${rel} is a binary file (${stat.size} bytes).` });
      const all = lines(buf.toString('utf8')).split('\n');
      const offset = Math.max(1, req.offset ?? 1);
      const limit = Math.min(Math.max(req.limit ?? 2000, 1), 4000);
      const slice = all.slice(offset - 1, offset - 1 + limit);
      const numbered = slice.map((l, i) => `${String(offset + i).padStart(5)}  ${l}`).join('\n');
      const more = offset - 1 + limit < all.length || stat.size > MAX_READ_BYTES;
      return reply({ ok: true, text: `${numbered}${more ? `\n… (${rel}: ${stat.size} bytes; read more with offset)` : ''}` });
    }
    case 'write': {
      if (typeof req.content !== 'string' || Buffer.byteLength(req.content) > MAX_WRITE_BYTES) return reply({ ok: false, error: 'Content missing or larger than 2 MB.' });
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, req.content, 'utf8');
      return reply({ ok: true, text: `Wrote ${rel} (${Buffer.byteLength(req.content)} bytes).` });
    }
    case 'edit': {
      const raw = await fs.readFile(abs, 'utf8');
      const crlf = raw.includes('\r\n');
      const text = lines(raw);
      const oldText = lines(String(req.old_text ?? ''));
      const newText = lines(String(req.new_text ?? ''));
      if (!oldText) return reply({ ok: false, error: 'old_text is empty.' });
      const count = text.split(oldText).length - 1;
      if (count === 0) return reply({ ok: false, error: `old_text was not found in ${rel}. Read the file again and copy the exact text.` });
      if (count > 1 && !req.replace_all) return reply({ ok: false, error: `old_text appears ${count} times in ${rel}: include more surrounding lines, or set replace_all.` });
      let updated = req.replace_all ? text.split(oldText).join(newText) : text.replace(oldText, () => newText);
      if (crlf) updated = updated.replace(/\n/g, '\r\n');
      await fs.writeFile(abs, updated, 'utf8');
      return reply({ ok: true, text: `Edited ${rel} (${req.replace_all ? count : 1} replacement${(req.replace_all ? count : 1) === 1 ? '' : 's'}).` });
    }
    default:
      return reply({ ok: false, error: `Unknown operation ${op}` });
  }
}

main().catch((err) => {
  const messages = { ENOENT: 'No such file or folder.', EISDIR: 'That is a folder.', ENOTDIR: 'A part of that path is not a folder.', EACCES: 'Permission denied.', EOUTSIDE: err.message };
  reply({ ok: false, error: messages[err.code] ?? `Failed: ${err.code ?? err.message}` });
});
