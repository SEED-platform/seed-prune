import {pbkdf2Sync} from 'node:crypto';
import axios, {AxiosError} from 'axios';
import * as cliProgress from 'cli-progress';
import * as dotenv from 'dotenv';
import {Client} from 'pg';

dotenv.config({path: `${__dirname}/.env`});

const client = new Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT)
});

axios.defaults.baseURL = process.env.API_URL;
axios.defaults.auth = {
  username: process.env.API_USERNAME || '',
  password: process.env.API_KEY || ''
};
axios.interceptors.response.use(({data}) => data);

let myUserId: number;
const orgsToKeep = JSON.parse(process.env.ORGS_TO_KEEP || '[]');
const usersToKeep = JSON.parse(process.env.USERS_TO_KEEP || '[]');

type Org = {
  name: string,
  org_id: number,
  parent_id: null | number,
  id: number,
  user_role: string
}

const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

(async () => {
  await client.connect();
  await getCurrentUser();
  await deleteOrganizations();
  await deleteUsers();
  await resetPasswords();
  await client.end();
  console.log('Done');
})();

async function getCurrentUser() {
  try {
    ({pk: myUserId} = await axios.get('/users/current/'));
  } catch (e) {
    const err = e as Error | AxiosError;
    if (axios.isAxiosError(err)) {
      console.error(err.response?.data);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

async function deleteOrganizations() {
  let organizations: Org[];
  ({organizations} = await axios.get('/organizations/?brief=true'));

  const orgIdsToDelete = organizations
    .filter(org => !orgsToKeep.includes(org.id))
    .map(org => org.id)
    .sort((a, b) => a - b);

  for (const orgId of orgIdsToDelete) {
    const org = organizations.find(org => org.id === orgId);
    console.log(`Deleting org ${orgId}: ${org!.name}`);
    bar.start(100, 0);
    let progress_key: string;
    ({progress_key} = await axios.delete(`/organizations/${orgId}/`));
    await progress(progress_key);
  }

  // Confirm that orgs have been deleted, repeat if necessary for cleanup
  ({organizations} = await axios.get('/organizations/?brief=true'));
  if (organizations.filter(org => !orgsToKeep.includes(org.id)).length) {
    console.warn('Failed to delete all orgs, re-attempting...');
    await deleteOrganizations();
  }
}

async function deleteUsers() {
  const users = await client.query('SELECT id FROM landing_seeduser ORDER BY id');
  const userIdsToDelete = users.rows
    .filter(user => ![myUserId, ...usersToKeep].includes(user.id))
    .map(user => user.id);
  for (const id of userIdsToDelete) {
    try {
      await client.query(`DELETE FROM landing_seeduser WHERE id = ${id}`);
    } catch (e) {
      // Ignore failures, users that can't be deleted are tied to foreign keys of org data to keep
    }
  }
}

async function resetPasswords() {
  const users = await client.query('SELECT id FROM landing_seeduser ORDER BY id');
  const userIdsToReset: number[] = users.rows
    .filter(({id}) => !usersToKeep.includes(id))
    .map(({id}) => id);

  for (const userId of userIdsToReset) {
    await client.query(`UPDATE landing_seeduser SET password = '${hashPassword()}' WHERE id = ${userId};`);
  }
}

async function progress(key: string) {
  return new Promise<void>(async resolve => {
    let progress = 0;
    while (progress < 100) {
      ({progress} = await axios.get(`/progress/${key}/`));
      bar.update(Number(progress.toFixed(2)));
      if (progress < 100) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        bar.stop();
        resolve();
      }
    }
  });
}

function hashPassword(password = 'password') {
  const iterations = 260000;
  const salt = randomString(22);
  const hash = pbkdf2Sync('password', salt, iterations, 32, 'sha256').toString('base64');
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

function randomString(length: number, chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  let result = '';
  for (let i = 0; i < length; ++i) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
