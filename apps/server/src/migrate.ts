import { config } from './config';
import { pool, migrate } from './db';
const db = pool(config().databaseUrl);
try {await migrate(db); console.log('Database migrations applied.');} finally {await db.end();}
