import {mkdir,writeFile} from 'node:fs/promises'
import {dirname,join} from 'node:path'
import {existsSync,appendFileSync} from 'node:fs'
import readline from 'node:readline'
const argument=name=>process.argv[process.argv.indexOf(name)+1]
const gemini=argument('--gemini-dir'),home=dirname(gemini)
const emit=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n')
let current='gemini-3-pro'
const options=()=>[{id:'model',name:'Model',category:'model',type:'select',currentValue:current,options:[{value:'gemini-3-pro',name:'Gemini 3 Pro'},{value:'gemini-3-flash',name:'Gemini 3 Flash'}]},{id:'mode',type:'select',currentValue:'default',options:[{value:'default'},{value:'plan'}]}]
for await(const line of readline.createInterface({input:process.stdin})){
 const request=JSON.parse(line);appendFileSync(join(home,'fixture-methods.log'),request.method+'\n')
 if(request.method==='initialize')emit({id:request.id,result:{protocolVersion:1,agentInfo:{name:'Antigravity ACP Server',version:'1.5.11'},agentCapabilities:{loadSession:true,mcpCapabilities:{http:true}},authMethods:[{id:'oauth-personal',name:'Google'}]}})
 else if(request.method==='authenticate'){
  process.stderr.write('https://accounts.google.com/o/oauth2/v2/auth?state=fixture-secret&code_challenge=fixture-challenge\n')
  if(existsSync(join(home,'pending-auth')))continue
  if(existsSync(join(home,'deny-auth'))){emit({id:request.id,error:{code:-32000,message:'refresh_token=fixture-private https://example.com/?code=fixture'}});continue}
  await mkdir(join(home,'native-store'),{recursive:true});await writeFile(join(home,'native-store','fixture-session'),'opaque native auth fixture')
  emit({id:request.id,result:{}})
 }else if(request.method==='session/new')emit({id:request.id,result:{sessionId:'695d05f4-f949-4c07-8b73-afd9c42d8e0e',configOptions:options()}})
 else if(request.method==='session/set_config_option'){current=request.params.value;emit({id:request.id,result:{configOptions:options()}})}
 else emit({id:request.id,result:{}})
}
