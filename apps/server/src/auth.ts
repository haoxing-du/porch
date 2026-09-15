import type { FastifyInstance, FastifyReply } from 'fastify';
import oauth, { type OAuth2Namespace } from '@fastify/oauth2';
declare module 'fastify' { interface FastifyInstance { githubOAuth2: OAuth2Namespace; } }
import type pg from 'pg';
import type { Config } from './config';
import { user, uid, secret, hash, Problem } from './core';
import { z } from 'zod';
export async function authRoutes(app:FastifyInstance, db:pg.Pool, cfg:Config) {
  async function signIn(identity:string, name:string, avatar:string|null, reply:FastifyReply) {
    const person = (await db.query('INSERT INTO users(id,identity,name,avatar) VALUES($1,$2,$3,$4) ON CONFLICT(identity) DO UPDATE SET name=excluded.name,avatar=excluded.avatar RETURNING id',[uid(),identity,name,avatar])).rows[0];
    const token = secret();
    await db.query("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[hash(token),person.id]);
    reply.setCookie('porch',token,{path:'/',httpOnly:true,sameSite:'lax',secure:cfg.production,maxAge:30*86400});
  }
  app.get('/api/me', async req=>{
    let person;
    try {person = await user(db,req);} catch (e) {if (!(e instanceof Problem) || e.statusCode!==401) throw e;}
    return {user:person??null,devAuth:cfg.devAuth,githubReady:!!cfg.githubId,maxMessageChars:cfg.maxMessageChars,maxFileBytes:cfg.maxFileBytes,workspaces:person?(await db.query('SELECT w.* FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.name',[person.id])).rows:[]};
  });
  if (cfg.devAuth) app.post('/api/auth/dev', async (req,reply)=>{
    const {name} = z.object({name:z.enum(['alex','sam','outsider'])}).parse(req.body);
    await signIn(`dev:${name}`,name[0].toUpperCase()+name.slice(1),null,reply); return {ok:true};
  });
  app.post('/api/auth/logout',async(req,reply)=>{
    if (req.cookies.porch) await db.query('DELETE FROM auth_sessions WHERE token_hash=$1',[hash(req.cookies.porch)]);
    reply.clearCookie('porch',{path:'/'}); return {ok:true};
  });
  if (cfg.githubId && cfg.githubSecret) {
    await app.register(oauth,{name:'githubOAuth2',credentials:{client:{id:cfg.githubId,secret:cfg.githubSecret},auth:oauth.GITHUB_CONFIGURATION},startRedirectPath:'/api/auth/github',callbackUri:`${cfg.origin}/api/auth/github/callback`,scope:['read:user'],cookie:{secure:cfg.production,httpOnly:true,sameSite:'lax'}});
    app.get('/api/auth/github/callback',async(req,reply)=>{
      const {token} = await app.githubOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);
      const response = await fetch('https://api.github.com/user',{headers:{Authorization:`Bearer ${token.access_token}`,Accept:'application/vnd.github+json','User-Agent':'Porch'},signal:AbortSignal.timeout(15000)});
      if (!response.ok) throw new Problem(502,'GitHub sign-in failed. Try signing in again.');
      const profile = z.object({id:z.number(),login:z.string(),name:z.string().nullable(),avatar_url:z.string()}).parse(await response.json());
      await signIn(`github:${profile.id}`,profile.name??profile.login,profile.avatar_url,reply);
      return reply.redirect('/');
    });
  }
}
