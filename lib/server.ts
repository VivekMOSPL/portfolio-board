import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { AppError } from "./domain";

/**
 * Next.js replaces a statically written `process.env.NEXT_PUBLIC_*` with whatever value
 * existed at build time. A deployment built before those variables were set therefore has
 * `undefined` compiled into it, and no host setting can repair that at runtime — which is
 * exactly how "Authentication is not configured" survives a correctly configured project.
 * Reading through a variable name is left alone by the compiler and resolves against the
 * real runtime environment, so host configuration is honoured without a rebuild.
 */
export function readEnv(name: string): string | undefined {
  return process.env[name];
}

export const REQUIRED_CONFIG = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "APP_URL",
] as const;

/** Names of required settings that are absent or still hold a placeholder. Values are never returned. */
export function missingConfig(): string[] {
  return REQUIRED_CONFIG.filter((name) => {
    const value = readEnv(name);
    return !value || value.includes("[");
  });
}

export function authClient() {
 const url=readEnv("NEXT_PUBLIC_SUPABASE_URL"),key=readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
 if(!url||!key||url.includes("["))throw new AppError(503,"Authentication is not configured. Ask the operator to configure Supabase.");
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
export async function setSessionCookies(session:Session|null) {
 const jar=await cookies();
 const options={httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax" as const,path:"/"};
 if(!session){jar.set("cb_access","",{...options,maxAge:0});jar.set("cb_refresh","",{...options,maxAge:0});return;}
 jar.set("cb_access",session.access_token,{...options,maxAge:60*60*24*7});
 jar.set("cb_refresh",session.refresh_token,{...options,maxAge:60*60*24*7});
}
export async function authenticated() {
 const jar=await cookies(),access=jar.get("cb_access")?.value,refresh=jar.get("cb_refresh")?.value;
 if(!access||!refresh)throw new AppError(401,"Please sign in");
 const db=authClient();
 const {data:sessionData,error:sessionError}=await db.auth.setSession({access_token:access,refresh_token:refresh});
 if(sessionError||!sessionData.session)throw new AppError(401,"Session expired. Please sign in again.");
 const {data,error}=await db.auth.getUser(sessionData.session.access_token);
 if(error||!data.user)throw new AppError(401,"Please sign in again");
 if(sessionData.session.access_token!==access)await setSessionCookies(sessionData.session);
 return {db,user:data.user};
}
export function dbError(error:{code?:string;message:string}|null):never {
 if(!error)throw new AppError(500,"Unexpected database response");
 if(error.code==="P0002")throw new AppError(404,"Record not found");
 if(error.code==="40001")throw new AppError(409,"This record changed. Refresh it before saving again.");
 if(error.code==="28000")throw new AppError(401,error.message);
 if(error.code==="42501")throw new AppError(403,error.message);
 if(error.code==="23505")throw new AppError(409,"A matching record already exists. Check the client code, email or phone.");
 if(["23502","23503","23514","22P02","22007","22008"].includes(error.code??""))throw new AppError(422,"Invalid data, missing required fields, or a status rule was not satisfied.");
 if(error.code==="22023")throw new AppError(422,error.message);
 if(error.code==="PGRST202"||error.code==="42P01")throw new AppError(503,"Database setup is incomplete. The operator must apply the versioned migrations.");
 console.error(JSON.stringify({event:"database_error",code:error.code??"unknown"}));
 throw new AppError(503,"The data service is unavailable. Please retry.");
}
export async function rpc(db:SupabaseClient,name:string,args:Record<string,unknown>={}) {
 const {data,error}=await db.rpc(name,args);if(error)dbError(error);return data;
}
export type Membership={tenant_id:string;name:string;role:"admin"|"manager"|"rm"|"auditor";team_id:string|null;active:boolean;tenant_name:string;tenant_status:string;timezone:string};
export type Account={user_id:string;platform:boolean;memberships:Membership[]};
export async function account(db:SupabaseClient):Promise<Account> {return await rpc(db,"cb_session");}
export function requireTenant(ac:Account,id:string) {
 const member=ac.memberships.find(m=>m.tenant_id===id);
 if(!member||!member.active||!["active","trial"].includes(member.tenant_status))throw new AppError(403,"Account disabled, business suspended, or access unavailable");
 return member;
}

export async function authThrottle(email:string,event:"attempt"|"success"|"failure"="attempt") {
 const key=readEnv("SUPABASE_SERVICE_ROLE_KEY"),url=readEnv("NEXT_PUBLIC_SUPABASE_URL");
 if(!key||!url)throw new AppError(503,"Secure authentication is not fully configured. The operator must configure the server credential for persistent abuse controls.");
 const {createHmac}=await import("node:crypto");
 const hash=createHmac("sha256",key).update(email.trim().toLowerCase()).digest("hex");
 const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const allowed=await rpc(service,"cb_auth_attempt",{p_key:hash,p_event:event});
 if(!allowed)throw new AppError(429,"Too many attempts. Please try again in 15 minutes.");
}
