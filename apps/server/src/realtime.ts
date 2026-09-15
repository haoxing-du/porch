import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { id } from '../../../packages/contracts/src/index';
import { user, member } from './core';
export function realtimeRoutes(app:FastifyInstance,db:pg.Pool){
  app.get('/api/workspaces/:workspace/events',{websocket:true,preValidation:async req=>{
    const {workspace}=z.object({workspace:id}).parse(req.params);await member(db,(await user(db,req)).id,workspace);
  }},(socket,req)=>{
    const {workspace}=z.object({workspace:id}).parse(req.params);let cursor=z.coerce.number().int().nonnegative().catch(0).parse((req.query as {after?:string}).after);let busy=false;
    const timer=setInterval(async()=>{
      if(busy||socket.readyState!==1)return;busy=true;
      try{await member(db,(await user(db,req)).id,workspace);if(socket.bufferedAmount>1048576){socket.close(1013,'Reconnect to load new messages.');return;}
        const events=(await db.query('SELECT id::text,kind,topic_id FROM events WHERE workspace_id=$1 AND id>$2 ORDER BY id LIMIT 100',[workspace,cursor])).rows;
        if(events.length){socket.send(JSON.stringify({type:'events',events}));cursor=Number(events.at(-1).id);}
      }catch{socket.close(1008,'Workspace access ended.');}finally{busy=false;}
    },200);socket.on('close',()=>clearInterval(timer));socket.on('error',()=>clearInterval(timer));socket.send(JSON.stringify({type:'connected'}));
  });
}
