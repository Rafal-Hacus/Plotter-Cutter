// Prints a scrypt hash for AUTH_PASSWORD_HASH, so the plain password doesn't have to be stored anywhere.
//   node server/hash-password.js            (asks for the password)
//   echo -n 'secret' | node server/hash-password.js
import { hashPassword } from './auth.js';
import { createInterface } from 'node:readline';

let input = '';
if (process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = s => { if (!s.includes('Password')) return; rl.output.write(s); };
  input = await new Promise(ok => rl.question('Password: ', a => { rl.close(); process.stdout.write('\n'); ok(a); }));
} else {
  for await (const c of process.stdin) input += c;
  input = input.replace(/\r?\n$/, '');
}
if (input.length < 8) { console.error('Use at least 8 characters.'); process.exit(1); }
console.log(hashPassword(input));
