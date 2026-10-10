import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { AppError } from "./domain";
import { readEnv } from "./env";
import { activeProvider } from "./db/config";
import { mysqlDriver, type DataDriver } from "./db/mysql";
import { SESSION_COOKIE, localSession } from "./auth/local";

// Re-exported so existing callers can keep importing configuration helpers from here.
export { REQUIRED_CONFIG, missingConfig, readEnv } from "./env";

/**
 * The data client is provider-specific. Under Supabase it is a client carrying the request's session,
 * so PostgreSQL resolves auth.uid() from the JWT. Under MySQL it is a driver bound to the resolved
 * user id, which every routine receives as p_actor. Both are used through rpc() below, which is the
 * only thing the rest of the server knows about.
 */
export type AnyClient = SupabaseClient | DataDriver;

function isDriver(client: AnyClient): client is DataDriver {
  return (client as DataDriver).provider === "mysql";
}

/**
 * Narrows a client to the Supabase type for the branches that only run on that provider — PostgREST
 * table reads and the auth calls. If one of those branches is ever reached on the local provider the
 * call would be meaningless, so it raises instead of silently misbehaving.
 */
export function asSupabase(client: AnyClient): SupabaseClient {
  if (isDriver(client)) {
    throw new AppError(500, "Internal error: a Supabase-only operation was reached on the local provider");
  }
  return client;
}

export function setLocalSessionCookie(token: string | null) {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
  return cookies().then((jar) => {
    if (!token) {
      jar.set(SESSION_COOKIE, "", { ...options, maxAge: 0 });
      return;
    }
    jar.set(SESSION_COOKIE, token, { ...options, maxAge: 60 * 60 * 24 * 7 });
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
export async function authenticated(): Promise<{db:AnyClient;user:{id:string;email?:string}}> {
 // Offline provider: the session cookie holds an opaque token and the account is resolved from the
 // database, so revocation takes effect on the next request exactly as it did with Supabase.
 if(activeProvider()==="mysql"){
  const jar=await cookies();
  const session=await localSession(jar.get(SESSION_COOKIE)?.value);
  if(!session)throw new AppError(401,"Please sign in");
  return {db:mysqlDriver(session.user.id),user:{id:session.user.id,email:session.user.email}};
 }
 const jar=await cookies(),access=jar.get("cb_access")?.value,refresh=jar.get("cb_refresh")?.value;
 if(!access||!refresh)throw new AppError(401,"Please sign in");
 const db=authClient();
 const {data:sessionData,error:sessionError}=await db.auth.setSession({access_token:access,refresh_token:refresh});
 if(sessionError||!sessionData.session)throw new AppError(401,"Session expired. Please sign in again.");
 const {data,error}=await db.auth.getUser(sessionData.session.access_token);
 if(error||!data.user)throw new AppError(401,"Please sign in again");
 if(sessionData.session.access_token!==access)await setSessionCookies(sessionData.session);
 return {db,user:{id:data.user.id,email:data.user.email}};
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
export async function rpc(db:AnyClient,name:string,args:Record<string,unknown>={}) {
 if(isDriver(db))return await db.rpc(name,args);
 const {data,error}=await db.rpc(name,args);if(error)dbError(error);return data;
}
export type Membership={tenant_id:string;name:string;role:"admin"|"manager"|"rm"|"auditor";team_id:string|null;active:boolean;tenant_name:string;tenant_status:string;timezone:string};
export type Account={user_id:string;platform:boolean;memberships:Membership[]};
export async function account(db:AnyClient):Promise<Account> {return await rpc(db,"cb_session") as Account;}
export function requireTenant(ac:Account,id:string) {
 const member=ac.memberships.find(m=>m.tenant_id===id);
 if(!member||!member.active||!["active","trial"].includes(member.tenant_status))throw new AppError(403,"Account disabled, business suspended, or access unavailable");
 return member;
}

export async function authThrottle(email:string,event:"attempt"|"success"|"failure"="attempt") {
 // The offline provider applies its own lockout inside cb_local_credentials — five failures lock the
 // account for fifteen minutes — so there is nothing to add here. Under Supabase the limiter lives in
 // a service-only table keyed by an HMAC of the address, so the address itself is never stored.
 if(activeProvider()==="mysql")return;
 const key=readEnv("SUPABASE_SERVICE_ROLE_KEY"),url=readEnv("NEXT_PUBLIC_SUPABASE_URL");
 if(!key||!url)throw new AppError(503,"Secure authentication is not fully configured. The operator must configure the server credential for persistent abuse controls.");
 const {createHmac}=await import("node:crypto");
 const hash=createHmac("sha256",key).update(email.trim().toLowerCase()).digest("hex");
 const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const allowed=await rpc(service,"cb_auth_attempt",{p_key:hash,p_event:event});
 if(!allowed)throw new AppError(429,"Too many attempts. Please try again in 15 minutes.");
}
