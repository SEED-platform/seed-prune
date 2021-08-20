# SEED-Prune

This script allows you to cull all data from a SEED database except for specific organizations and users.

1. Create a .env file with the following structure
    ```dotenv
    DB_NAME=seed
    DB_HOST=192.168.7.200
    DB_USER=seeduser
    DB_PASSWORD=password
    DB_PORT=5432
    
    API_URL=http://seed.lan:8000/api/v3/
    API_USERNAME=alex.swindler@nrel.gov
    API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    
    ORGS_TO_KEEP=[123,456]
    USERS_TO_KEEP=[1,2,3]
    ```

2. Run `ts-node index.ts`

- All organizations except those referenced will be fully deleted
- All users except for those referenced will be deleted
  - Some additional users may remain who have foreign key attachments to objects within preserved organizations
  - Any users that remain and aren't referenced in the .env file will have their password hashes reset to be `password`
