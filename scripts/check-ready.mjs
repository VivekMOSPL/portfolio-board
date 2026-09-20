const names=["NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY","SUPABASE_SERVICE_ROLE_KEY","CRON_SECRET","APP_URL"];
const missing=names.filter(name=>!process.env[name]);
if(missing.length){console.log("BLOCKED: missing server configuration: "+missing.join(", "));process.exit(2);}
for(const table of ["cb_tenants","cb_followups","cb_saved_filters","cb_auth_limits"]){
 const response=await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL+"/rest/v1/"+table+"?select=*&limit=0",{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+process.env.SUPABASE_SERVICE_ROLE_KEY}});
 if(!response.ok){console.log("BLOCKED: database schema readiness "+table+" returned HTTP "+response.status);process.exit(2);}
}
console.log("Database schema readiness: HTTP 200 for all required tables. No records retrieved.");
console.log("Still verify real Auth, invitation/recovery email delivery, scheduler and backup/restore before release.");
