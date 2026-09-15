#!/usr/bin/env node
if (process.argv.includes('--version')) {console.log('codex-cli 0.153.1');process.exit(0);}
const readline=require('node:readline');
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);if(r.method==='initialized')return;
 if(r.method==='thread/resume')return send({id:r.id,error:{message:'no rollout found for thread id'}});
 if(r.method==='thread/start')return send({id:r.id,result:{thread:{id:'fixture-thread'}}});
 if(r.method==='turn/start'){
  send({id:r.id,result:{turn:{id:'fixture-turn',status:'inProgress',items:[]}}});
  const event={method:'turn/completed',params:{threadId:'fixture-thread',turn:{id:'fixture-turn',status:'completed',items:[{type:'reasoning',text:'PRIVATE_REASONING_CANARY'},{type:'agentMessage',phase:'final_answer',text:JSON.stringify({kind:'reply',text:'café 改善'})}]}}};
  const bytes=Buffer.from(JSON.stringify(event)+'\n');const split=bytes.indexOf(Buffer.from('改'))+1;process.stdout.write(bytes.subarray(0,split));setTimeout(()=>process.stdout.write(bytes.subarray(split)),20);return;
 }
 send({id:r.id,result:{}});
});
