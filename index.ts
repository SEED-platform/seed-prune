import axios from 'axios';
import * as cliProgress from 'cli-progress';
import { Client } from 'pg';

require('node-env-file')(__dirname + '/.env');

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
axios.interceptors.response.use(response => response.data);

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
    console.error(e.response.data);
    process.exit(0);
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
    // Failed to delete all orgs, re-attempt
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
      await client.query(`DELETE
                          FROM landing_seeduser
                          WHERE id = ${id}`);
    } catch (e) {
      // Ignore failures, users that can't be deleted are tied to foreign keys of org data to keep
    }
  }
}

async function resetPasswords() {
  const users = await client.query('SELECT id FROM landing_seeduser ORDER BY id');
  const userIdsToReset = users.rows
    .filter(user => !usersToKeep.includes(user.id))
    .map(user => user.id);

  if (userIdsToReset.length) {
    // "password"
    await client.query(`UPDATE landing_seeduser
                        SET password = 'pbkdf2_sha256$150000$YheaZoup3axI$E2i+GJcbyWG55E+dzIHQF0dWPJtZMZ39iGMHiG2Lz5w='
                        WHERE id IN (${userIdsToReset.join(', ')});`);
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
