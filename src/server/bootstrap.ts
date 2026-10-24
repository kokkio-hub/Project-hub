import type { Config } from './config.js';
import type { DB } from './db/index.js';
import { hashPassword } from './auth/password.js';
import { countUsers, getUserByEmail, insertUser } from './repos/users.js';
import { PASSWORD_MIN_LENGTH } from '../shared/types.js';

/**
 * Creates the first admin from ADMIN_EMAIL / ADMIN_PASSWORD when the database is
 * empty. Handy for automated deployments; otherwise the first visitor to the web
 * app is asked to create the admin account.
 */
export async function bootstrapAdmin(db: DB, config: Config): Promise<void> {
  const admin = config.bootstrapAdmin;
  if (!admin || countUsers(db) > 0 || getUserByEmail(db, admin.email)) return;
  if (admin.password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  insertUser(db, {
    email: admin.email,
    name: admin.name,
    role: 'admin',
    passwordHash: await hashPassword(admin.password),
    mustChangePassword: false,
  });
  console.log(`Created admin account ${admin.email} from ADMIN_EMAIL/ADMIN_PASSWORD.`);
}
