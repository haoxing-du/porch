import { config } from './config';
import { pool, migrate } from './db';
import { createApp } from './app';
const cfg=config(),db=pool(cfg.databaseUrl);await migrate(db);const app=await createApp(db,cfg);
await app.listen({host:cfg.host,port:cfg.port});console.log(`Porch service is ready on ${cfg.host}:${cfg.port}.`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();await db.end();process.exit(0);});
