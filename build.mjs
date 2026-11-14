import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const publicDirectory = path.join(root, 'public');
const outputDirectory = path.join(root, 'dist');
const serverDirectory = path.join(outputDirectory, 'server');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};
const assets = {};
function collect(directory) {
  for (const entry of fs.readdirSync(directory)) {
    const fullPath = path.join(directory, entry);
    if (fs.statSync(fullPath).isDirectory()) {
      collect(fullPath);
      continue;
    }
    const relativePath = path.relative(publicDirectory, fullPath).split(path.sep).join('/');
    assets['/' + relativePath] = {
      type: contentTypes[path.extname(fullPath)] || 'application/octet-stream',
      data: fs.readFileSync(fullPath).toString('base64')
    };
  }
}
if (!fs.existsSync(path.join(publicDirectory, 'index.html'))) {
  throw new Error('public/index.html이 필요합니다. HTML·CSS·JS 3개를 public 폴더에 넣어 주세요.');
}
collect(publicDirectory);
fs.rmSync(outputDirectory, {recursive: true, force: true});
fs.mkdirSync(serverDirectory, {recursive: true});
const apiSource = fs.readFileSync(path.join(root, 'worker', 'api.js'), 'utf8');
const workerSource = `${apiSource}
const STATIC_ASSETS = ${JSON.stringify(assets)};
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return api(request, env);
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = STATIC_ASSETS[pathname];
    if (!asset) return new Response('Not found', {status: 404});
    return new Response(Uint8Array.from(atob(asset.data), c => c.charCodeAt(0)), {
      headers: {
        'Content-Type': asset.type,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
};
`;
fs.writeFileSync(path.join(serverDirectory, 'index.js'), workerSource);
fs.cpSync(path.join(root, 'drizzle'), path.join(outputDirectory, 'drizzle'), {recursive: true});
const manifest = path.join(root, '.openai', 'hosting.json');
if (fs.existsSync(manifest)) {
  fs.mkdirSync(path.join(outputDirectory, '.openai'), {recursive: true});
  fs.copyFileSync(manifest, path.join(outputDirectory, '.openai', 'hosting.json'));
}
console.log('빌드 완료: dist/server/index.js');
