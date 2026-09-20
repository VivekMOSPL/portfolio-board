import {readdir,readFile} from "node:fs/promises";
async function walk(dir){let result=[];for(const item of await readdir(dir,{withFileTypes:true})){const path=dir+"/"+item.name;result.push(...(item.isDirectory()?await walk(path):[path]));}return result;}
const secrets=["SUPABASE_SERVICE_ROLE_KEY","CRON_SECRET"].filter(name=>process.env[name]);
for(const file of await walk(".next/static")){const content=await readFile(file);for(const name of secrets)if(content.includes(Buffer.from(process.env[name]))){console.error("FAIL: server secret detected in browser output: "+name);process.exit(1);}}
console.log("PASS: configured server secret values are absent from .next/static; checked "+secrets.length+" configured secret.");
