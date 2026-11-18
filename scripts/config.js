import { fileURLToPath } from 'node:url';

// Resolve from this checkout, including paths with spaces or non-ASCII characters.
const entry = fileURLToPath(new URL('../src/server.js', import.meta.url));
console.log(JSON.stringify({mcpServers:{
  'human-browser': {command:process.execPath, args:[entry]}
}}, null, 2));
