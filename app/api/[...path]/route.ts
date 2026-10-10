import { NextRequest,NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z,ZodError } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { account,asSupabase,authenticated,authClient,authThrottle,dbError,missingConfig,readEnv,requireTenant,rpc,setLocalSessionCookie,setSessionCookies } from "@/lib/server";
import { mailConfigured, sendInvitationEmail, sendRecoveryEmail } from "@/lib/mail";
import { activeProvider } from "@/lib/db/config";
import { mysqlCall } from "@/lib/db/mysql";
import { hashPassword } from "@/lib/auth/passwords";
import { SESSION_COOKIE, localSignIn, localSignOut } from "@/lib/auth/local";
import { AppError,checkOrigin,filterInput,validateCommand,toCsv } from "@/lib/domain";
import { bearerKey,hashIntegrationKey,issueIntegrationKey } from "@/lib/integration";

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
// Machine authentication for IDash-App. The tenant is derived solely from the credential; the caller
// never supplies it. Returns a service client and the resolved tenant, or throws 401/429.
async function integrationAuth(req:NextRequest,endpoint:string) {
 const supplied=bearerKey(req.headers.get("authorization"));
 const key=readEnv("SUPABASE_SERVICE_ROLE_KEY"),url=readEnv("NEXT_PUBLIC_SUPABASE_URL");
 if(!key||!url)throw new AppError(503,"Integrations are not configured on this server.");
 if(!supplied)throw new AppError(401,"Unauthorized");
 const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const hash=hashIntegrationKey(supplied);
 const auth=await rpc(service,"cb_integration_authenticate",{p_key_hash:hash});
 if(!auth){await rpc(service,"cb_integration_log",{p_tenant:null,p_credential:null,p_endpoint:endpoint,p_outcome:"invalid"});throw new AppError(401,"Unauthorized");}
 if(auth.error){await rpc(service,"cb_integration_log",{p_tenant:auth.tenant_id??null,p_credential:auth.credential_id??null,p_endpoint:endpoint,p_outcome:"revoked"});throw new AppError(401,"Unauthorized");}
 const allowed=await rpc(service,"cb_integration_attempt",{p_key:hash,p_limit:600,p_window_seconds:60});
 if(!allowed){await rpc(service,"cb_integration_log",{p_tenant:auth.tenant_id,p_credential:auth.credential_id,p_endpoint:endpoint,p_outcome:"rate_limited"});throw new AppError(429,"Too many requests");}
 return {service,auth};
}
export async function GET(req:NextRequest,ctx:{params:Promise<{path:string[]}>}) {
 try {
  const path=(await ctx.params).path.join("/");
    if(path==="health"){const missing=missingConfig();return reply({status:"ok",service:"client-follow-up-board",configured:missing.length===0,missing});}
  const {db,user}=await authenticated();
  const ac=await account(db);
    if(path==="session")return reply({...ac,email:user.email,mail_configured:mailConfigured()});
  // The tenant comes from the caller's own membership in the database; any tenant parameter is ignored.
  if(path==="integration-links")return reply(await rpc(db,"cb_client_link_queue"));
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
   if(activeProvider()==="mysql")return reply(await rpc(db,"cb_read_plans",{p_offset:(page-1)*30,p_size:30}));
   const {data,error,count}=await asSupabase(db).from("cb_plans").select("*",{count:"exact"}).order("created_at").range((page-1)*30,page*30-1);
   if(error)dbError(error);return reply({rows:data,total:count});
  }
  if(path==="data"&&resource==="tenants") {
   if(!ac.platform)throw new AppError(403,"Platform permission required");
   if(activeProvider()==="mysql"){
    const rows=await rpc(db,"cb_tenant_list") as unknown[];
    return reply({rows,total:rows.length});
   }
   const {data,error,count}=await asSupabase(db).from("cb_tenants").select("*",{count:"exact"}).order("created_at",{ascending:false}).range((page-1)*30,page*30-1);
   if(error)dbError(error);return reply({rows:data,total:count});
  }
  uuid.parse(tenant);
  const member=ac.platform&&resource==="invitations"?null:requireTenant(ac,tenant);
  if(path==="data"&&["filters","masters","clients","members","teams","timeline","notifications","imports","audit","settings","preferences"].includes(resource)&&activeProvider()==="mysql"){
   // The offline provider reads through one scoped routine. The application user has no SELECT on any
   // base table, so this is the only route to a row, and the predicate lives inside the database.
   if(["imports","audit"].includes(resource)&&!["admin","auditor"].includes(member?.role??""))throw new AppError(403,"Permission required");
   return reply(await rpc(db,"cb_read_page",{
    p_resource:resource,
    p_tenant:tenant,
    p_q:resource==="clients"?q:null,
    p_offset:(page-1)*30,
    p_size:30,
   }));
  }
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
  let query=asSupabase(db).from(table).select("*",{count:"exact"}).eq(resource==="settings"?"id":"tenant_id",tenant);
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
   const key=readEnv("SUPABASE_SERVICE_ROLE_KEY"),url=readEnv("NEXT_PUBLIC_SUPABASE_URL");
   if(!key||!url)throw new AppError(503,"Background jobs are not configured");
   const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
   return reply({created:await rpc(db,"cb_reminders")});
  }
  // Machine channel for IDash-App. Authenticated by a per-business integration key (never CRON_SECRET),
  // tenant derived solely from the credential, rate-limited and audited. It cannot issue or rotate keys.
  if(path==="integrations/idash/ping"){
   const {service,auth}=await integrationAuth(req,"integrations/idash/ping");
   await rpc(service,"cb_integration_log",{p_tenant:auth.tenant_id,p_credential:auth.credential_id,p_endpoint:"integrations/idash/ping",p_outcome:"ok"});
   return reply({ok:true,tenant_id:auth.tenant_id,server_time:new Date().toISOString()});
  }
  // Client identity push. Records links for staff review; nothing is merged automatically. Idempotent
  // by idempotency_key: a replay returns the first response, a different body under the same key is 409.
  if(path==="integrations/idash/clients"){
   const {service,auth}=await integrationAuth(req,"integrations/idash/clients");
   const input=await body(req);
   const parsed=z.object({idempotency_key:z.string().min(8).max(120),clients:z.array(z.object({external_client_id:z.string().min(1).max(120),display_name:z.string().min(1).max(160),email:z.email().optional(),phone:z.string().min(6).max(20).optional(),pan_hash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict()).min(1).max(200)}).strict().parse(input);
   const requestHash=createHash("sha256").update(JSON.stringify(parsed.clients),"utf8").digest("hex");
   const result=await rpc(service,"cb_client_push_idempotent",{p_tenant:auth.tenant_id,p_key:parsed.idempotency_key,p_endpoint:"integrations/idash/clients",p_hash:requestHash,p_clients:parsed.clients});
   if(result.status==="conflict")throw new AppError(409,"This idempotency key was used with a different request");
   if(result.status==="in_progress")throw new AppError(409,"A request with this idempotency key is already being processed");
   await rpc(service,"cb_integration_log",{p_tenant:auth.tenant_id,p_credential:auth.credential_id,p_endpoint:"integrations/idash/clients",p_outcome:"ok"});
   return reply(result.response);
  }
  checkOrigin(req.headers.get("origin"),process.env.APP_URL||req.url);
  const input=await body(req);
  if(path==="auth/login"){
   const values=credentials.parse(input);
   // Offline provider: credentials are verified against the local store and the lockout counter lives
   // in the database, so authThrottle is a no-op there.
   if(activeProvider()==="mysql"){
    const {token}=await localSignIn(values.email,values.password,req.headers.get("user-agent")??"");
    await setLocalSessionCookie(token);return reply({ok:true});
   }
   const db=authClient();
   await authThrottle(values.email);
   const {data,error}=await asSupabase(db).auth.signInWithPassword(values);
   if(error||!data.session){await authThrottle(values.email,"failure");throw new AppError(401,"Sign-in failed. Check your credentials or try again later.");}
   await authThrottle(values.email,"success");
   await setSessionCookies(data.session);return reply({ok:true});
  }
  // Registration, recovery and confirmation are hosted-service features. An offline installation
  // provisions accounts with npm run auth:seed-local instead, which is an operator action.
  if(activeProvider()==="mysql"&&["auth/signup","auth/forgot","auth/confirm"].includes(path)){
   throw new AppError(503,"This is not available on an offline installation. Ask the operator to provision the account.");
  }
  if(path==="auth/signup"){
   const values=credentials.extend({password:z.string().min(8).max(256)}).parse(input),db=authClient();
   await authThrottle(values.email);
   const {error}=await asSupabase(db).auth.signUp(values);
   if(error)throw new AppError(422,"Account registration could not be completed. Check your email or try signing in.");
   return reply({message:"If registration is available, check your email to confirm your account, then sign in and accept your invitation."});
  }
  if(path==="auth/forgot"){
   const {email}=z.object({email:z.email()}).strict().parse(input);
   await authThrottle(email);
   // Recovery travels over the configured SMTP provider (the same one invitations use), not the
   // platform mailer, so delivery does not depend on Supabase's email settings. The response is
   // identical whether or not the account exists, so it cannot be used to discover addresses.
   const key=readEnv("SUPABASE_SERVICE_ROLE_KEY"),url=readEnv("NEXT_PUBLIC_SUPABASE_URL");
   if(key&&url){
    const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data}=await admin.auth.admin.generateLink({type:"recovery",email,options:{redirectTo:new URL("/reset-password",readEnv("APP_URL")??req.url).href}});
    const hashed=data?.properties?.hashed_token;
    if(hashed){
     const link=new URL("/reset-password?token_hash="+encodeURIComponent(hashed),readEnv("APP_URL")??req.url).href;
     await sendRecoveryEmail({to:email,link,expiresInHours:1});
    }
   }
   return reply({message:"If this account exists, a recovery email will be sent. Delivery depends on the configured email provider."});
  }
  if(path==="auth/confirm"){
   const {token_hash,type}=z.object({token_hash:z.string().min(20).max(1024),type:z.enum(["recovery","email","signup","invite"])}).strict().parse(input);
   const db=authClient(),{data,error}=await asSupabase(db).auth.verifyOtp({token_hash,type});
   if(error||!data.session)throw new AppError(422,"This link is invalid, expired, or already used.");
   await setSessionCookies(data.session);return reply({ok:true});
  }
  if(path==="auth/accept-invite"){
   const {token,password}=z.object({token:z.string().regex(/^[a-f0-9-]{72}$/),password:z.string().min(8).max(256)}).strict().parse(input);
   const key=readEnv("SUPABASE_SERVICE_ROLE_KEY"),url=readEnv("NEXT_PUBLIC_SUPABASE_URL"),publishable=readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
   if(!key||!url||!publishable)throw new AppError(503,"Invitations are not configured on this server.");
   // The token was emailed to the invited address, so holding it proves control of that mailbox.
   // A brand-new account is therefore created already confirmed, instead of depending on a platform
   // confirmation email, while an existing account still has to supply its own password.
   const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
   const hash=createHash("sha256").update(token,"utf8").digest("hex");
   const {data:inv,error:lookup}=await admin.from("cb_invitations").select("email,used_at,revoked_at,expires_at").eq("token_hash",hash).maybeSingle();
   if(lookup)throw new AppError(503,"The invitation could not be read. Please retry.");
   if(!inv||inv.used_at||inv.revoked_at||new Date(String(inv.expires_at))<=new Date())throw new AppError(422,"This invitation is invalid, expired, or already used.");
   await authThrottle(inv.email);
   const db=authClient();
   const signIn=async()=>(await asSupabase(db).auth.signInWithPassword({email:inv.email,password})).data.session;
   let session=await signIn();
   if(!session){
    // An account may already exist for this address, for example left unconfirmed by an earlier
    // sign-up. Holding the invitation token proves control of the mailbox, so an unconfirmed account
    // may be confirmed here, but an existing account still has to supply its own password: the token
    // must never be a way to take over an account someone already uses.
    const listed=await admin.auth.admin.listUsers({page:1,perPage:200});
    const existing=listed.data?.users.find(u=>u.email?.toLowerCase()===inv.email.toLowerCase());
    if(existing&&!existing.email_confirmed_at)await admin.auth.admin.updateUserById(existing.id,{password,email_confirm:true});
    session=await signIn();
    if(!session){
     if(existing)throw new AppError(422,"That address already has an account. Enter its existing password, or use \"Forgot your password?\".");
     const created=await admin.auth.admin.createUser({email:inv.email,password,email_confirm:true});
     if(created.error)throw new AppError(422,created.error.message);
     session=await signIn();
    }
   }
   if(!session)throw new AppError(503,"Account created, but sign-in failed. Please retry.");
   await setSessionCookies(session);
   const authed=createClient(url,publishable,{global:{headers:{Authorization:"Bearer "+session.access_token}},auth:{persistSession:false,autoRefreshToken:false}});
   const result=await rpc(authed,"cb_command",{p_tenant:null,p_action:"invite.accept",p_data:{token}});
   return reply({ok:true,tenant_id:result.tenant_id});
  }
  const {db,user}=await authenticated();
  if(path==="auth/logout"){
   const {all}=z.object({all:z.boolean().default(false)}).strict().parse(input);
   if(activeProvider()==="mysql"){
    // Revokes the row, so the token stops working immediately rather than at expiry.
    const jar=await cookies();
    await localSignOut(jar.get(SESSION_COOKIE)?.value,all,user.id);
    await setLocalSessionCookie(null);return reply({ok:true});
   }
   await rpc(db,"cb_logout",{all_devices:all});
   const {error}=await asSupabase(db).auth.signOut({scope:all?"global":"local"});
   if(error)throw new AppError(503,"Sign out failed. Please retry.");
   await setSessionCookies(null);return reply({ok:true});
  }
  if(path==="auth/password"){
   await account(db);
   const {password}=z.object({password:z.string().min(8).max(256)}).strict().parse(input);
   if(activeProvider()==="mysql"){
    // Offline: replace the stored scrypt hash, then revoke every session so a stolen cookie cannot
    // outlive the change. Same guarantee the Supabase path gets from a global sign-out.
    await mysqlCall("cb_local_credential_set",[user.id,hashPassword(password),"scrypt"]);
    const jar=await cookies();
    await localSignOut(jar.get(SESSION_COOKIE)?.value,true,user.id);
    await setLocalSessionCookie(null);
    return reply({message:"Password updated. All sessions were revoked. Please sign in again."});
   }
   const {error}=await asSupabase(db).auth.updateUser({password});
   if(error)throw new AppError(422,"Password update failed. Reopen your recovery link or sign in again.");
   await rpc(db,"cb_logout",{all_devices:true});
   await asSupabase(db).auth.signOut({scope:"global"});
   await setSessionCookies(null);
   return reply({message:"Password updated. All application sessions were revoked. Please sign in again."});
  }
  if(path==="import-file"){
   const {tenant,content}=z.object({tenant:uuid,content:z.string().min(1).max(700000).regex(/^[A-Za-z0-9+/]*={0,2}$/)}).strict().parse(input);
   if(requireTenant(await account(db),tenant).role!=="admin")throw new AppError(403,"Administrator required");
   const {workbookRows}=await import("@/lib/workbooks");
   return reply({rows:await workbookRows(Buffer.from(content,"base64"))});
  }
  // Issuance and rotation are session-authenticated and administrator-only. The plaintext key is
  // returned exactly once; the database stores only its hash. A machine caller cannot reach these.
  if(path==="integrations/credentials/issue"){
   const {tenant,label}=z.object({tenant:uuid,label:z.string().min(2).max(80)}).strict().parse(input);
   if(requireTenant(await account(db),tenant).role!=="admin")throw new AppError(403,"Administrator required");
   const secret=issueIntegrationKey();
   const result=await rpc(db,"cb_integration_credential_issue",{p_tenant:tenant,p_label:label,p_key_hash:hashIntegrationKey(secret),p_key_prefix:secret.slice(0,8)});
   return reply({credential_id:result.credential_id,key:secret,shown_once:true});
  }
  if(path==="integrations/credentials/rotate"){
   const {credential}=z.object({credential:uuid}).strict().parse(input);
   const secret=issueIntegrationKey();
   const result=await rpc(db,"cb_integration_credential_rotate",{p_credential:credential,p_key_hash:hashIntegrationKey(secret),p_key_prefix:secret.slice(0,8)});
   return reply({credential_id:result.credential_id,key:secret,shown_once:true});
  }
  // Staff confirm a client link. Administrator or manager only; the database enforces the role.
  if(path==="integration-links/confirm"){
   const {link,client}=z.object({link:uuid,client:uuid}).strict().parse(input);
   return reply(await rpc(db,"cb_client_link_confirm",{p_link:link,p_client:client}));
  }
  // Deletes the sensitive intake record for a link. Administrator or manager of the owning tenant only.
  if(path==="integration-links/forget"){
   const {link}=z.object({link:uuid}).strict().parse(input);
   return reply(await rpc(db,"cb_client_intake_forget",{p_link:link}));
  }
  if(path==="command"){
   const envelope=z.object({tenant:z.union([uuid,z.null()]),action:z.string().max(60),data:z.unknown()}).strict().parse(input);
   const parsed=validateCommand(envelope.action,envelope.data);
   const ac=await account(db);
   if(!["tenant.create","tenant.update","plan.create","invite.accept"].includes(envelope.action)&&!(ac.platform&&["invite.create","invite.revoke"].includes(envelope.action))){
    requireTenant(ac,uuid.parse(envelope.tenant));
   }
   const result=await rpc(db,"cb_command",{p_tenant:envelope.tenant,p_action:envelope.action,p_data:parsed});
   // An invitation is created first and emailed second. If mail is not configured, or the provider
   // refuses the message, the invitation still stands and the caller is told so plainly rather than
   // being told an email was sent. The one-time link is returned either way.
   if(envelope.action==="invite.create"&&result&&typeof result.token==="string"){
    const invited=parsed as {email:string;name:string;role:string};
    const business=ac.memberships.find(m=>m.tenant_id===envelope.tenant)?.tenant_name??null;
    const link=new URL("/invite?token="+encodeURIComponent(result.token)+"&email="+encodeURIComponent(invited.email),readEnv("APP_URL")??req.url).href;
    const mail=await sendInvitationEmail({to:invited.email,name:invited.name,business,role:invited.role,link,expiresInHours:48});
    return reply(mail.sent
      ?{...result,delivery:"email",delivered_to:invited.email}
      :{...result,delivery:"manual",delivery_reason:mail.reason});
   }
   return reply(result);
  }
  throw new AppError(404,"Not found");
 }catch(err){return failure(err);}
}
