import type { FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pool, migrate } from '../../../apps/server/src/db';
import { createApp } from '../../../apps/server/src/app';
import type { Config } from '../../../apps/server/src/config';
export async function createTestApp(){
  const schema=`test_${crypto.randomUUID().replaceAll('-','')}`;const url=process.env.TEST_DATABASE_URL??'postgres://localhost/postgres';const admin=pool(url);await admin.query(`CREATE SCHEMA ${schema}`);
  const db=pool(url,schema);await migrate(db);const uploadDir=await mkdtemp(join(tmpdir(),'porch-test-'));
  const cfg:Config={databaseUrl:url,origin:'http://localhost:5173',production:false,devAuth:true,uploadDir,host:'127.0.0.1',port:0,maxFileBytes:20971520,maxMessageChars:8000};
  const fixture={db,cfg,app:await createApp(db,cfg),async restart(){await this.app.close();this.app=await createApp(db,cfg);await this.app.ready();},async close(){await this.app.close();await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await rm(uploadDir,{recursive:true,force:true});}};
  await fixture.app.ready();return fixture;
}
export async function login(app:FastifyInstance,name:'alex'|'sam'|'outsider'){
  const response=await app.inject({method:'POST',url:'/api/auth/dev',payload:{name}});if(response.statusCode!==200)throw new Error(response.body);return response.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
}
export async function call(app:FastifyInstance,cookie:string,method:'GET'|'POST'|'PATCH'|'DELETE',url:string,payload?:unknown){
  const response=await app.inject({method,url,headers:{cookie},...(payload===undefined?{}:{payload:JSON.stringify(payload),headers:{cookie,'content-type':'application/json'}})});
  if(response.statusCode>=400)throw new Error(`${method} ${url}: ${response.statusCode} ${response.body}`);return response.json();
}
