import { createAuthService } from '../auth/authService';
import { createUserRepository } from '../auth/userRepository';
import { getDb } from '../db/database';

// Membuat akun uji coba untuk audit Lighthouse & Axe Core.
// Atur lewat env: SEED_USERNAME, SEED_PASSWORD, SEED_NAME.
const username = process.env.SEED_USERNAME || 'auditor';
const password = process.env.SEED_PASSWORD || 'Auditor123!';
const name = process.env.SEED_NAME || 'Akun Audit';

const users = createUserRepository(getDb());
if (users.findByUsername(username)) {
  console.log(`Akun "${username}" sudah ada, dilewati.`);
} else {
  createAuthService(users).register({ name, username, password });
  console.log(`Akun "${username}" dibuat.`);
}
