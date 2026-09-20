import { NextRequest,NextResponse } from "next/server";
import { z,ZodError } from "zod";
import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { account,authenticated,authClient,authThrottle,dbError,requireTenant,rpc,setSessionCookies } from "@/lib/server";
import { AppError,checkOrigin,filterInput,validateCommand,toCsv } from "@/lib/domain";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const uuid=z.uuid();
const reply=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
async function body(req:NextRequest) {
 if(!req.headers.get("content-type")?.includes("application/json"))throw new AppError(415,"Use JSON");
 const reader=req.body?.getReader();if(!reader)throw new AppError(400,"Request body required");
 let size=0;const chunks:Uint8Array[]=[];
 while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1024*1024){await reader.cancel();throw new AppError(413,"Request is too large");}chunks.push(part.value);}
 const raw=Buffer.concat(chunks).toString("utf8");
 try{return JSON.parse(raw);}catch{throw new AppError(400,"Invalid JSON");}
}
function failure(err:unknown) {
 if(err instanceof ZodError)return reply({error:err.issues.map(i=>(i.path.join(".")||"Input")+": "+i.message).join("; ")},422);
 if(err instanceof AppError)return reply({error:err.message},err.status);
 console.error(JSON.stringify({event:"request_error",type:err instanceof Error?err.name:"unknown"}));
 return reply({error:"The request could not be completed. Please retry."},500);
}
const credentials=z.object({email:z.email(),password:z.string().min(1).max(256)}).strict();
export async function GET(req:NextRequest,ctx:{params:Promise<{path:string[]}>}) {
 try {
  const path=(await ctx.params).path.join("/");
  if(path==="health")return reply({status:"ok",service:"client-follow-up-board"});
  const {db,user}=await authenticated();
  const ac=await account(db);
  if(path==="session")return reply({...ac,email:user.email});
  const resource=req.nextUrl.searchParams.get("resource")??"followups";
  const tenant=req.nextUrl.searchParams.get("tenant")??"";
  const page=z.coerce.number().int().min(1).max(100000).parse(req.nextUrl.searchParams.get("page")??1);
  const q=z.string().max(120).parse(req.nextUrl.searchParams.get("q")??"");
  if(path==="data"&&resource==="usage"){
   if(!ac.platform)throw new AppError(403,"Platform permission required");
   const rows=await rpc(db,"cb_usage");return reply({rows,total:rows.length});
  }
  if(path==="data"&&resource==="plans"){
   if(!ac.platform)throw new AppError(403,"Platform permission required");
   const {data,error,count}=await db.from("cb_plans").select("*",{count:"exact"}).order("created_at").range((page-1)*30,page*30-1);
   if(error)dbError(error);return reply({rows:data,total:count});
  }
  if(path==="data"&&resource==="tenants") {
   if(!ac.platform)throw new AppError(403,"Platform permission required");
   const {data,error,count}=await db.from("cb_tenants").select("*",{count:"exact"}).order("created_at",{ascending:false}).range((page-1)*30,page*30-1);
   if(error)dbError(error);return reply({rows:data,total:count});
  }
  uuid.parse(tenant);
  const member=ac.platform&&resource==="invitations"?null:requireTenant(ac,tenant);
  if(resource==="invitations") {
   if(!ac.platform&&member?.role!=="admin")throw new AppError(403,"Administrator required");
   const rows=await rpc(db,"cb_invitations_list",{t:tenant});return reply({rows,total:rows.length});
  }
  const rawFilters:Record<string,string>={};
  for(const k of ["q","status","priority","bucket","owner_id","client_id"]){const v=req.nextUrl.searchParams.get(k);if(v)rawFilters[k]=v;}
  const filters=filterInput.parse(rawFilters);
  if(path==="export") {
   if(member?.role!=="admin")throw new AppError(403,"Export requires administrator permission");
   // Explicit bounded export: never silently deliver a partial full-dataset export.
   const data=await rpc(db,"cb_followups_page",{t:tenant,filters,page_number:1});
   if(data.total>30)throw new AppError(422,"Narrow your filters to at most 30 records for this export. Background bulk export is not configured.");
   const format=z.enum(["csv","xlsx"]).parse(req.nextUrl.searchParams.get("format")??"csv");
   await rpc(db,"cb_command",{p_tenant:tenant,p_action:"export.log",p_data:{filters,count:data.total,format}});
   if(format==="xlsx"){
    const {workbookExport}=await import("@/lib/workbooks");
    const buffer=await workbookExport(data.rows,["id","client_name","title","status","due_at","value_paise","converted_paise"]);
    return new NextResponse(Uint8Array.from(buffer),{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":'attachment; filename="follow-ups.xlsx"',"Cache-Control":"no-store"}});
   }
   return new NextResponse(toCsv(data.rows,["id","client_name","title","status","due_at","value_paise","converted_paise"]),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="follow-ups.csv"',"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
  }
  if(path!=="data")throw new AppError(404,"Not found");
  if(resource==="followups")return reply(await rpc(db,"cb_followups_page",{t:tenant,filters,page_number:page}));
  if(resource==="metrics")return reply(await rpc(db,"cb_metrics",{t:tenant,filters}));
  const tables:Record<string,string>={filters:"cb_saved_filters",masters:"cb_master_data",clients:"cb_clients",members:"cb_members",teams:"cb_teams",timeline:"cb_timeline",notifications:"cb_notifications",imports:"cb_imports",audit:"cb_audit",settings:"cb_tenants",preferences:"cb_preferences"};
  const table=tables[resource];if(!table)throw new AppError(404,"Not found");
  if(["imports","audit"].includes(resource)&&!["admin","auditor"].includes(member?.role??""))throw new AppError(403,"Permission required");
  let query=db.from(table).select("*",{count:"exact"}).eq(resource==="settings"?"id":"tenant_id",tenant);
  if(resource==="clients"){
   query=query.is("archived_at",null);
   if(q)query=query.ilike("name","%"+q.replace(/[\\%_]/g,"\\$&")+"%");
   if(req.nextUrl.searchParams.get("id"))query=query.eq("id",uuid.parse(req.nextUrl.searchParams.get("id")));
  }
  if(resource==="timeline")query=query.eq("client_id",uuid.parse(req.nextUrl.searchParams.get("client_id")));
  const order=resource==="members"?"name":resource==="teams"?"name":resource==="preferences"?"user_id":"created_at";
  const {data,error,count}=await query.order(order,{ascending:resource==="members"||resource==="teams"}).range((page-1)*30,page*30-1);
  if(error)dbError(error);return reply({rows:data,total:count});
 }catch(err){return failure(err);}
}
export async function POST(req:NextRequest,ctx:{params:Promise<{path:string[]}>}) {
 try{
  const path=(await ctx.params).path.join("/");
  if(path==="jobs/reminders"){
   const expected=process.env.CRON_SECRET,supplied=req.headers.get("authorization")?.replace(/^Bearer /,"")??"";
   if(!expected||supplied.length!==expected.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))throw new AppError(401,"Unauthorized");
   const key=process.env.SUPABASE_SERVICE_ROLE_KEY,url=process.env.NEXT_PUBLIC_SUPABASE_URL;
   if(!key||!url)throw new AppError(503,"Background jobs are not configured");
   const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
   return reply({created:await rpc(db,"cb_reminders")});
  }
  checkOrigin(req.headers.get("origin"),process.env.APP_URL||req.url);
  const input=await body(req);
  if(path==="auth/login"){
   const values=credentials.parse(input),db=authClient();
   await authThrottle(values.email);
   const {data,error}=await db.auth.signInWithPassword(values);
   if(error||!data.session){await authThrottle(values.email,"failure");throw new AppError(401,"Sign-in failed. Check your credentials or try again later.");}
   await authThrottle(values.email,"success");
   await setSessionCookies(data.session);return reply({ok:true});
  }
  if(path==="auth/signup"){
   const values=credentials.extend({password:z.string().min(12).max(256)}).parse(input),db=authClient();
   await authThrottle(values.email);
   const {error}=await db.auth.signUp(values);
   if(error)throw new AppError(422,"Account registration could not be completed. Check your email or try signing in.");
   return reply({message:"If registration is available, check your email to confirm your account, then sign in and accept your invitation."});
  }
  if(path==="auth/forgot"){
   const {email}=z.object({email:z.email()}).strict().parse(input),db=authClient();
   await authThrottle(email);
   const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:new URL("/reset-password",process.env.APP_URL||req.url).href});
   if(error)throw new AppError(503,"Password recovery is unavailable. Contact your business administrator.");
   return reply({message:"If this account exists, a recovery email will be sent. Delivery depends on the configured email provider."});
  }
  if(path==="auth/confirm"){
   const {token_hash,type}=z.object({token_hash:z.string().min(20).max(1024),type:z.enum(["recovery","email","signup","invite"])}).strict().parse(input);
   const db=authClient(),{data,error}=await db.auth.verifyOtp({token_hash,type});
   if(error||!data.session)throw new AppError(422,"This link is invalid, expired, or already used.");
   await setSessionCookies(data.session);return reply({ok:true});
  }
  const {db}=await authenticated();
  if(path==="auth/logout"){
   const {all}=z.object({all:z.boolean().default(false)}).strict().parse(input);
   await rpc(db,"cb_logout",{all_devices:all});
   const {error}=await db.auth.signOut({scope:all?"global":"local"});
   if(error)throw new AppError(503,"Sign out failed. Please retry.");
   await setSessionCookies(null);return reply({ok:true});
  }
  if(path==="auth/password"){
   await account(db);
   const {password}=z.object({password:z.string().min(12).max(256)}).strict().parse(input);
   const {error}=await db.auth.updateUser({password});
   if(error)throw new AppError(422,"Password update failed. Reopen your recovery link or sign in again.");
   await rpc(db,"cb_logout",{all_devices:true});
   await db.auth.signOut({scope:"global"});
   await setSessionCookies(null);
   return reply({message:"Password updated. All application sessions were revoked. Please sign in again."});
  }
  if(path==="import-file"){
   const {tenant,content}=z.object({tenant:uuid,content:z.string().min(1).max(700000).regex(/^[A-Za-z0-9+/]*={0,2}$/)}).strict().parse(input);
   if(requireTenant(await account(db),tenant).role!=="admin")throw new AppError(403,"Administrator required");
   const {workbookRows}=await import("@/lib/workbooks");
   return reply({rows:await workbookRows(Buffer.from(content,"base64"))});
  }
  if(path==="command"){
   const envelope=z.object({tenant:z.union([uuid,z.null()]),action:z.string().max(60),data:z.unknown()}).strict().parse(input);
   const parsed=validateCommand(envelope.action,envelope.data);
   const ac=await account(db);
   if(!["tenant.create","tenant.update","plan.create","invite.accept"].includes(envelope.action)&&!(ac.platform&&["invite.create","invite.revoke"].includes(envelope.action))){
    requireTenant(ac,uuid.parse(envelope.tenant));
   }
   return reply(await rpc(db,"cb_command",{p_tenant:envelope.tenant,p_action:envelope.action,p_data:parsed}));
  }
  throw new AppError(404,"Not found");
 }catch(err){return failure(err);}
}
