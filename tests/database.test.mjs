import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

test("real PostgreSQL schema, RLS, transactions and workflows", async (t) => {
 const db = new PGlite();
 await db.exec("create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key,email text); grant usage on schema auth,public to authenticated,anon,service_role; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('email',current_setting('request.jwt.claim.email',true),'iat',0,'session_id',auth.uid()::text)$$;");
 for(const f of (await readdir("supabase/migrations")).filter(f=>f.endsWith(".sql")).sort()) await db.exec(await readFile("supabase/migrations/"+f,"utf8"));
 const users=Object.fromEntries(["platform","admin","otherAdmin","rm","otherRm","manager","auditor","invitee"].map(n=>[n,randomUUID()]));
 for(const [name,id] of Object.entries(users)) await db.query("insert into auth.users values($1,$2)",[id,name+"@example.test"]);
 await db.query("insert into cb_platform_admins values($1)",[users.platform]);
 async function as(name) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.email',$2,false)",[users[name],name+"@example.test"]);
  await db.exec("set role authenticated");
 }
 async function command(tenant,action,data={}) { return (await db.query("select cb_command($1,$2,$3) result",[tenant,action,JSON.stringify(data)])).rows[0].result; }
 async function count(table) {return Number((await db.query("select count(*) n from "+table)).rows[0].n);}
 await as("platform");
 const a=await command(null,"tenant.create",{name:"Alpha Advisors"});
 const b=await command(null,"tenant.create",{name:"Beta Advisors"});
 const g1=randomUUID(),g2=randomUUID();
 await db.exec("reset role");
 await db.query("insert into cb_teams(id,tenant_id,name) values($1,$2,'North'),($3,$2,'South')",[g1,a.id,g2]);
 for(const [name,tenant,role,team] of [["admin",a.id,"admin",null],["otherAdmin",b.id,"admin",null],["rm",a.id,"rm",g1],["otherRm",a.id,"rm",g2],["manager",a.id,"manager",g1],["auditor",a.id,"auditor",null]]) {
  await db.query("insert into cb_members(tenant_id,user_id,name,email,role,team_id) values($1,$2,$3,$4,$5,$6)",[tenant,users[name],name,name+"@example.test",role,team]);
 }
 await as("admin");
 let c=await command(a.id,"client.create",{code:"A1",name:"Client One",email:"one@example.test",owner_id:users.rm});
 const c2=await command(a.id,"client.create",{code:"A2",name:"Client Two",phone:"+919876543210",owner_id:users.otherRm});
 await as("otherAdmin");
 const foreign=await command(b.id,"client.create",{code:"B1",name:"Other Tenant Client",email:"foreign@example.test",owner_id:users.otherAdmin});
 await t.test("anonymous cannot read or invoke mutations",async()=>{
  await db.exec("reset role; set role anon");
  await assert.rejects(db.query("select * from cb_clients"),/permission denied/);
  await assert.rejects(command(a.id,"client.create",{}),/permission denied/);
 });
 await t.test("cross-tenant read, metrics and ID lookup reveal nothing",async()=>{
  await as("admin");
  assert.equal((await db.query("select * from cb_clients where id=$1",[foreign.id])).rows.length,0);
  assert.equal((await db.query("select cb_metrics($1) m",[b.id])).rows[0].m.total,0);
  await assert.rejects(command(b.id,"client.update",{id:foreign.id,version:1,name:"Attack"}),/access unavailable/);
  await assert.rejects(command(a.id,"client.update",{id:foreign.id,version:1,name:"Attack"}),/Not found/);
 });
 await t.test("RM sees assigned records only, manager sees only team",async()=>{
  await as("rm"); assert.equal(await count("cb_clients"),1);
  await assert.rejects(command(a.id,"client.assign",{id:c.id,version:1,owner_id:users.otherRm}),/permission required/);
  await as("manager"); assert.equal(await count("cb_clients"),1);
  await assert.rejects(command(a.id,"client.assign",{id:c.id,version:1,owner_id:users.otherRm}),/scope/);
 });
 await t.test("platform has tenant metadata but no implicit client access",async()=>{
  await as("platform"); assert.equal(await count("cb_tenants"),2); assert.equal(await count("cb_clients"),0);
 });
 await t.test("auditor cannot mutate and direct table writes are denied",async()=>{
  await as("auditor"); assert.equal(await count("cb_clients"),2);
  await assert.rejects(command(a.id,"client.archive",{id:c.id,version:1}),/Read-only/);
  await as("admin"); await assert.rejects(db.query("update cb_clients set name='Bypass'"),/permission denied/);
  await assert.rejects(db.query("select token_hash from cb_invitations"),/permission denied/);
 });
 await t.test("invalid required fields and contacts save nothing",async()=>{
  await as("admin");const before=await count("cb_clients");
  for(const input of [{},{code:"EMPTY",name:"   ",email:"ok@example.test"},{code:"BAD",name:"Bad Email",email:"bad"},{code:"NONE",name:"No Contact"},{code:"PHONE",name:"Bad Phone",phone:"123"}]) {
   await assert.rejects(command(a.id,"client.create",input));
  }
  assert.equal(await count("cb_clients"),before);
 });
 let f;
 await t.test("create follow-up from permitted client persists amount and history",async()=>{
  await as("rm");
  f=await command(a.id,"followup.create",{client_id:c.id,title:"Annual review",reason:"Review",value_paise:25000000,due_at:"2020-01-01T10:00:00Z"});
  assert.equal(f.owner_id,users.rm); assert.equal(await count("cb_followups"),1);
  await assert.rejects(command(a.id,"followup.create",{client_id:c2.id,title:"Hidden",reason:"Review"}),/Not found/);
 });
 await t.test("Waiting and Won/Lost rules are enforced at database boundary",async()=>{
  await as("rm");const before=await count("cb_timeline");
  for(const data of [{status:"Waiting on Client"},{status:"Won"},{status:"Lost",outcome_note:"Did not proceed"}]) {
   await assert.rejects(command(a.id,"followup.update",{id:f.id,version:1,...data}),/check constraint/);
  }
  assert.equal(await count("cb_timeline"),before);
  assert.equal((await db.query("select version from cb_followups where id=$1",[f.id])).rows[0].version,1);
  await command(a.id,"followup.update",{id:f.id,version:1,status:"Waiting on Client",due_at:"2020-01-02T10:00:00Z",next_action:"Call again"});
 });
 await t.test("optimistic concurrency rejects stale updates",async()=>{
  await assert.rejects(command(a.id,"followup.update",{id:f.id,version:1,status:"Called"}),/Conflict/);
 });
 await t.test("interaction persists and history cannot be rewritten",async()=>{
  await command(a.id,"interaction.create",{id:c.id,version:1,channel:"call",direction:"outbound",summary:"Discussed annual review"});
  assert.equal((await db.query("select version,last_contact_at from cb_clients where id=$1",[c.id])).rows[0].version,2);
  await assert.rejects(db.query("delete from cb_timeline"),/permission denied/);
  await db.exec("reset role");
  await assert.rejects(db.query("update cb_timeline set summary='Rewrite'"),/History is immutable/);
  await as("rm");
 });
 await t.test("metrics use exactly the filtered drill-down records",async()=>{
  const metric=(await db.query("select cb_metrics($1,$2) m",[a.id,JSON.stringify({bucket:"overdue"})])).rows[0].m;
  const page=(await db.query("select cb_followups_page($1,$2,1) p",[a.id,JSON.stringify({bucket:"overdue"})])).rows[0].p;
  assert.equal(metric.total,page.total); assert.equal(metric.total,1); assert.equal(metric.value_paise,25000000);
 });
 await t.test("reminders/escalations are persistent and idempotent",async()=>{
  await assert.rejects(db.query("select cb_reminders()"),/permission denied/);
  await db.exec("reset role; set role service_role");
  assert.equal((await db.query("select cb_reminders() n")).rows[0].n,3);
  assert.equal((await db.query("select cb_reminders() n")).rows[0].n,0);
  await as("admin");
  assert.ok((await db.query("select * from cb_notifications where message like 'Escalation%'")).rows.length>0);
 });
 await t.test("reassignment keeps timeline, moves open work and removes old access",async()=>{
  await as("admin");
  await command(a.id,"client.assign",{id:c.id,version:2,owner_id:users.otherRm});
  await as("rm");assert.equal(await count("cb_clients"),0);assert.equal(await count("cb_followups"),0);assert.equal(await count("cb_timeline"),0);assert.equal(await count("cb_notifications"),0);
  await as("otherRm");assert.equal(await count("cb_clients"),2);
  assert.ok((await db.query("select * from cb_timeline where client_id=$1",[c.id])).rows.length>=4);
 });
 await t.test("Won updates persisted report numerator and opportunity value",async()=>{
  const latest=(await db.query("select * from cb_followups where id=$1",[f.id])).rows[0];
  await command(a.id,"followup.update",{id:f.id,version:latest.version,status:"Won",outcome_note:"Mandate signed",converted_paise:20000000,due_at:latest.due_at.toISOString()});
  const metric=(await db.query("select cb_metrics($1) m",[a.id])).rows[0].m;
  assert.equal(metric.won,1);assert.equal(metric.value_paise,0);assert.equal(metric.converted_paise,20000000);
 });
 await t.test("bulk updates roll back every item when one is outside scope",async()=>{
  await as("otherRm");
  const latest=(await db.query("select * from cb_followups where id=$1",[f.id])).rows[0];
  await assert.rejects(command(a.id,"bulk.followup.update",{items:[{id:f.id,version:latest.version},{id:randomUUID(),version:1}],changes:{status:"Called"}}),/Not found/);
  const unchanged=(await db.query("select * from cb_followups where id=$1",[f.id])).rows[0];
  assert.equal(unchanged.status,"Won");assert.equal(unchanged.version,latest.version);
  await assert.rejects(db.query("select cb_core_command($1,'client.create','{}')",[a.id]),/permission denied/);
 });
 await t.test("duplicate and bulk update preserve original record",async()=>{
  const copy=await command(a.id,"followup.duplicate",{id:f.id});
  assert.notEqual(copy.id,f.id);assert.equal(copy.status,"New");
  const result=await command(a.id,"bulk.followup.update",{items:[{id:copy.id,version:1}],changes:{status:"Called",due_at:"2030-01-01T10:00:00Z"}});
  assert.equal(result.updated,1);
  await command(a.id,"followup.archive",{id:copy.id,version:2});
  assert.equal((await db.query("select status from cb_followups where id=$1",[f.id])).rows[0].status,"Won");
 });
 await t.test("saved filters are private and inactive masters reject new use",async()=>{
  await command(a.id,"saved_filter.create",{name:"My overdue",filters:{bucket:"overdue"}});
  assert.equal(await count("cb_saved_filters"),1);
  await as("admin");assert.equal(await count("cb_saved_filters"),0);
  const master=await command(a.id,"master.create",{kind:"reason",name:"Retired purpose"});
  await command(a.id,"master.update",{id:master.id,version:1,active:false});
  await assert.rejects(command(a.id,"followup.create",{client_id:c.id,title:"Bad reason",reason:"Retired purpose"}),/inactive/);
 });
 await t.test("corrections retain originals and platform usage contains no financial fields",async()=>{
  const event=(await db.query("select * from cb_timeline where client_id=$1 order by created_at limit 1",[c.id])).rows[0];
  await command(a.id,"interaction.correct",{id:event.id,summary:"Corrected historical description",reason:"Clarification"});
  assert.equal((await db.query("select summary from cb_timeline where id=$1",[event.id])).rows[0].summary,event.summary);
  await as("platform");
  const usage=(await db.query("select cb_usage() u")).rows[0].u;
  assert.equal(usage.length,2);assert.ok(!JSON.stringify(usage).includes("value_paise"));
  await command(null,"plan.create",{name:"Growth",user_limit:25,client_limit:5000});
  await as("rm");await assert.rejects(db.query("select cb_usage()"),/Forbidden/);
 });
 await t.test("invalid import rolls back valid earlier rows; retry is idempotent",async()=>{
  await as("admin");const before=await count("cb_clients");
  await assert.rejects(command(a.id,"import.clients",{request_key:randomUUID(),rows:[{code:"ROLL",name:"Rollback",email:"rollback@example.test"},{code:"BAD",name:"",email:"bad"}]}));
  assert.equal(await count("cb_clients"),before);
  const request={request_key:randomUUID(),duplicates:"skip",rows:[{code:"IMP",name:"Imported Person",email:"import@example.test",owner_id:users.rm}]};
  const first=await command(a.id,"import.clients",request);const retry=await command(a.id,"import.clients",request);
  assert.equal(first.id,retry.id);assert.equal(await count("cb_clients"),before+1);
  const skipped=await command(a.id,"import.clients",{...request,request_key:randomUUID()});
  assert.equal(skipped.rows_created,0);assert.equal(skipped.rows_skipped,1);
 });
 await t.test("invitation is email-bound, single-use and token hash is private",async()=>{
  const invite=await command(a.id,"invite.create",{email:"invitee@example.test",name:"New RM",role:"rm",team_id:g1});
  await as("otherRm");await assert.rejects(command(null,"invite.accept",{token:invite.token}),/Sign in as invitee@example\.test/);
  await as("invitee");await assert.rejects(command(null,"invite.accept",{token:"a".repeat(72)}),/invalid/);
  await command(null,"invite.accept",{token:invite.token});
  await assert.rejects(command(null,"invite.accept",{token:invite.token}),/invalid/);
  assert.equal((await db.query("select cb_session() s")).rows[0].s.memberships[0].role,"rm");
 });
 await t.test("revoked and expired invitations cannot be accepted",async()=>{
  await as("admin");
  const revoked=await command(a.id,"invite.create",{email:"invitee@example.test",name:"Reinvited RM",role:"rm"});
  await command(a.id,"invite.revoke",{id:revoked.id});
  await as("invitee");await assert.rejects(command(null,"invite.accept",{token:revoked.token}),/invalid/);
  await as("admin");
  const expired=await command(a.id,"invite.create",{email:"invitee@example.test",name:"Expired RM",role:"rm"});
  await db.exec("reset role");await db.query("update cb_invitations set expires_at=now()-interval '1 second' where id=$1",[expired.id]);
  await as("invitee");await assert.rejects(command(null,"invite.accept",{token:expired.token}),/invalid/);
 });
 await t.test("persistent account throttle locks at ten attempts and is service-only",async()=>{
  await as("admin");await assert.rejects(db.query("select cb_auth_attempt($1,'attempt')",["a".repeat(64)]),/permission denied/);
  await db.exec("reset role; set role service_role");
  for(let i=0;i<10;i++)assert.equal((await db.query("select cb_auth_attempt($1,'attempt') ok",["a".repeat(64)])).rows[0].ok,true);
  assert.equal((await db.query("select cb_auth_attempt($1,'attempt') ok",["a".repeat(64)])).rows[0].ok,false);
  await db.query("select cb_auth_attempt($1,'success')",["a".repeat(64)]);
  assert.equal((await db.query("select cb_auth_attempt($1,'attempt') ok",["a".repeat(64)])).rows[0].ok,true);
 });
 await t.test("disabled membership and suspended tenant lose reads and writes immediately",async()=>{
  await as("admin");await command(a.id,"member.update",{user_id:users.rm,role:"rm",team_id:g1,active:false,version:1});
  await as("rm");assert.equal(await count("cb_clients"),0);await assert.rejects(command(a.id,"client.create",{}),/disabled/);
  await as("platform");await command(a.id,"tenant.update",{version:1,name:a.name,status:"suspended",plan:"Starter",user_limit:10,client_limit:1000});
  await as("admin");assert.equal(await count("cb_clients"),0);await assert.rejects(command(a.id,"client.create",{}),/suspended/);
 });
 await t.test("global and per-session logout immediately deny issued-token access",async()=>{
  await as("otherAdmin");
  assert.equal(await count("cb_clients"),1);
  await db.query("select cb_logout(true)");
  assert.equal(await count("cb_clients"),0);
  await assert.rejects(db.query("select cb_session()"),/revoked/);
  await assert.rejects(command(b.id,"client.create",{}),/Authentication required/);
  await as("auditor");
  assert.equal((await db.query("select cb_access_valid() ok")).rows[0].ok,true);
  await db.query("select cb_logout(false)");
  assert.equal((await db.query("select cb_access_valid() ok")).rows[0].ok,false);
  await as("platform");
  assert.equal((await db.query("select cb_access_valid() ok")).rows[0].ok,true);
 });
 await t.test("integration credential: admin-only issue, hash-only storage, rotate, rate limit, isolation",async()=>{
  const { createHash, randomBytes } = await import("node:crypto");
  const hash=(k)=>createHash("sha256").update(k,"utf8").digest("hex");
  const keyA=randomBytes(32).toString("base64url"), keyB=randomBytes(32).toString("base64url"), keyD=randomBytes(32).toString("base64url");
  // Self-contained: two fresh tenants so earlier subtests cannot affect this one.
  await as("platform");
  const c=await command(null,"tenant.create",{name:"Gamma Advisors"});
  const d=await command(null,"tenant.create",{name:"Delta Advisors"});
  await db.exec("reset role");
  const adminC=randomUUID(), rmC=randomUUID(), adminD=randomUUID();
  await db.query("insert into auth.users values($1,$2),($3,$4),($5,$6)",[adminC,"adminC@example.test",rmC,"rmC@example.test",adminD,"adminD@example.test"]);
  await db.query("insert into cb_members(tenant_id,user_id,name,email,role) values($1,$2,$3,$4,'admin'),($1,$5,$6,$7,'rm'),($8,$9,$10,$11,'admin')",[c.id,adminC,"Admin C","adminC@example.test",rmC,"RM C","rmC@example.test",d.id,adminD,"Admin D","adminD@example.test"]);
  users.adminC=adminC;users.rmC=rmC;users.adminD=adminD;
  await as("adminC");
  await assert.rejects(db.query("select key_hash from cb_integration_credentials"),/permission denied/);
  const issued=(await db.query("select cb_integration_credential_issue($1,$2,$3,$4) r",[c.id,"IDash App",hash(keyA),keyA.slice(0,8)])).rows[0].r;
  assert.ok(issued.credential_id);
  await db.exec("reset role");
  const stored=(await db.query("select * from cb_integration_credentials where id=$1",[issued.credential_id])).rows[0];
  assert.equal(stored.key_hash,hash(keyA));assert.ok(!JSON.stringify(stored).includes(keyA));assert.equal(stored.status,"active");assert.equal(stored.tenant_id,c.id);
  await as("rmC");
  await assert.rejects(db.query("select cb_integration_credential_issue($1,$2,$3,$4)",[c.id,"Nope",hash(randomBytes(32).toString("base64url")),"abcdefgh"]),/Administrator required/);
  await as("adminD");
  await assert.rejects(db.query("select cb_integration_credential_issue($1,$2,$3,$4)",[c.id,"Nope",hash(randomBytes(32).toString("base64url")),"abcdefgh"]),/Administrator required/);
  await as("adminC");
  await assert.rejects(db.query("select cb_integration_authenticate($1)",[hash(keyA)]),/permission denied/);
  await db.exec("reset role; set role service_role");
  const okAuth=(await db.query("select cb_integration_authenticate($1) r",[hash(keyA)])).rows[0].r;
  assert.equal(okAuth.tenant_id,c.id);assert.equal(okAuth.credential_id,issued.credential_id);
  assert.equal((await db.query("select cb_integration_authenticate($1) r",[hash(randomBytes(32).toString("base64url"))])).rows[0].r,null);
  const rlKey=hash(randomBytes(32).toString("base64url"));
  for(let i=0;i<3;i++)assert.equal((await db.query("select cb_integration_attempt($1,3,60) ok",[rlKey])).rows[0].ok,true);
  assert.equal((await db.query("select cb_integration_attempt($1,3,60) ok",[rlKey])).rows[0].ok,false);
  await db.query("select cb_integration_log($1,$2,$3,$4)",[c.id,issued.credential_id,"integrations/idash/ping","ok"]);
  await db.exec("reset role");
  assert.equal(await count("cb_integration_audit"),1);
  await assert.rejects(db.query("update cb_integration_audit set outcome='invalid'"),/History is immutable/);
  await as("adminC");
  const rotated=(await db.query("select cb_integration_credential_rotate($1,$2,$3) r",[issued.credential_id,hash(keyB),keyB.slice(0,8)])).rows[0].r;
  assert.ok(rotated.credential_id);assert.notEqual(rotated.credential_id,issued.credential_id);
  await db.exec("reset role; set role service_role");
  assert.equal((await db.query("select cb_integration_authenticate($1) r",[hash(keyA)])).rows[0].r.error,"revoked");
  assert.equal((await db.query("select cb_integration_authenticate($1) r",[hash(keyB)])).rows[0].r.tenant_id,c.id);
  await as("adminD");
  await db.query("select cb_integration_credential_issue($1,$2,$3,$4)",[d.id,"IDash App",hash(keyD),keyD.slice(0,8)]);
  await db.exec("reset role; set role service_role");
  const authD=(await db.query("select cb_integration_authenticate($1) r",[hash(keyD)])).rows[0].r;
  assert.equal(authD.tenant_id,d.id);assert.notEqual(authD.tenant_id,c.id);
 });
 await t.test("client identity push: review only, idempotent, tenant-scoped, confirm links",async()=>{
  await as("platform");
  const e=await command(null,"tenant.create",{name:"Epsilon Advisors"});
  await db.exec("reset role");
  const adminE=randomUUID(), mgrE=randomUUID(), rmE=randomUUID();
  await db.query("insert into auth.users values($1,$2),($3,$4),($5,$6)",[adminE,"adminE@example.test",mgrE,"mgrE@example.test",rmE,"rmE@example.test"]);
  await db.query("insert into cb_members(tenant_id,user_id,name,email,role) values($1,$2,$3,$4,'admin'),($1,$5,$6,$7,'manager'),($1,$8,$9,$10,'rm')",[e.id,adminE,"Admin E","adminE@example.test",mgrE,"Mgr E","mgrE@example.test",rmE,"RM E","rmE@example.test"]);
  users.adminE=adminE;users.mgrE=mgrE;users.rmE=rmE;
  await as("adminE");
  const cl1=await command(e.id,"client.create",{code:"E1",name:"Existing One",email:"one@example.test",owner_id:rmE});
  await command(e.id,"client.create",{code:"E2",name:"Existing Two",phone:"+919812345678",owner_id:rmE});
  const { createHash } = await import("node:crypto");
  const h=(s)=>createHash("sha256").update(s,"utf8").digest("hex");
  const batch=JSON.stringify([
    {external_client_id:"IDASH-1",display_name:"One",email:"one@example.test",pan_hash:"c".repeat(64)},
    {external_client_id:"IDASH-2",display_name:"Two",phone:"+919812345678"},
    {external_client_id:"IDASH-3",display_name:"Unknown",email:"nobody@example.test"}
  ]);
  const pushIdem=(key,body)=>db.query("select cb_client_push_idempotent($1,$2,$3,$4,$5) r",[e.id,key,"integrations/idash/clients",h(body),body]);
  // one email match, one phone match, one with no match; nothing is auto-merged
  await db.exec("reset role; set role service_role");
  const first=(await pushIdem("key-push-0001",batch)).rows[0].r;
  assert.equal(first.status,"applied");
  const by=Object.fromEntries(first.response.results.map(r=>[r.external_client_id,r]));
  assert.equal(by["IDASH-1"].action,"pending_review");assert.equal(by["IDASH-1"].candidates,1);
  assert.equal(by["IDASH-2"].action,"pending_review");assert.equal(by["IDASH-2"].candidates,1);
  assert.equal(by["IDASH-3"].action,"unmatched");assert.equal(by["IDASH-3"].candidates,0);
  await db.exec("reset role");
  assert.equal((await db.query("select count(*) n from cb_client_links where tenant_id=$1 and status='linked'",[e.id])).rows[0].n,0);
  assert.equal((await db.query("select count(*) n from cb_client_links where tenant_id=$1",[e.id])).rows[0].n,3);
  assert.equal((await db.query("select client_id from cb_client_links where tenant_id=$1 and external_client_id='IDASH-3'",[e.id])).rows[0].client_id,null);
  // a replay with the same key and body returns the first response and writes nothing
  await db.exec("set role service_role");
  const replay=(await pushIdem("key-push-0001",batch)).rows[0].r;
  assert.equal(replay.status,"replay");assert.deepEqual(replay.response,first.response);
  await db.exec("reset role");
  assert.equal((await db.query("select count(*) n from cb_client_links where tenant_id=$1",[e.id])).rows[0].n,3);
  // the same key with a different body is a conflict and writes nothing
  await db.exec("set role service_role");
  assert.equal((await pushIdem("key-push-0001",JSON.stringify([{external_client_id:"IDASH-9",display_name:"Other"}]))).rows[0].r.status,"conflict");
  await db.exec("reset role");
  assert.equal((await db.query("select count(*) n from cb_client_links where tenant_id=$1",[e.id])).rows[0].n,3);
  // a request already holding the reservation blocks a second write and reports in_progress
  await db.query("insert into cb_integration_requests(tenant_id,idempotency_key,endpoint,request_hash,status) values($1,'key-push-0002','integrations/idash/clients',$2,'reserved')",[e.id,"d".repeat(64)]);
  await db.exec("set role service_role");
  assert.equal((await pushIdem("key-push-0002",JSON.stringify([{external_client_id:"IDASH-4",display_name:"Four"}]))).rows[0].r.status,"in_progress");
  await db.exec("reset role");
  assert.equal((await db.query("select count(*) n from cb_client_links where tenant_id=$1",[e.id])).rows[0].n,3);
  // a stale reservation can be taken over so a crashed request cannot block the key forever
  await db.query("update cb_integration_requests set created_at=now()-interval '6 minutes' where tenant_id=$1 and idempotency_key='key-push-0002'",[e.id]);
  await db.exec("set role service_role");
  assert.equal((await pushIdem("key-push-0002",JSON.stringify([{external_client_id:"IDASH-4",display_name:"Four"}]))).rows[0].r.status,"applied");
  await db.exec("reset role");
  assert.equal((await db.query("select count(*) n from cb_client_links where tenant_id=$1",[e.id])).rows[0].n,4);
  // two racing requests with the same key and body: exactly one applies
  await db.exec("set role service_role");
  const race=await Promise.all([pushIdem("key-push-0003",JSON.stringify([{external_client_id:"IDASH-5",display_name:"Five"}])),pushIdem("key-push-0003",JSON.stringify([{external_client_id:"IDASH-5",display_name:"Five"}]))]);
  assert.deepEqual(race.map(r=>r.rows[0].r.status).sort(),["applied","replay"]);
  await db.exec("reset role");
  assert.equal((await db.query("select count(*) n from cb_client_links where tenant_id=$1 and external_client_id='IDASH-5'",[e.id])).rows[0].n,1);
  // queue: tenant from the caller's membership only, never a parameter; no pan_hash; others see nothing
  await as("rmE");
  assert.equal((await db.query("select jsonb_array_length(cb_client_link_queue()) n")).rows[0].n,0);
  await as("adminD");
  assert.equal((await db.query("select jsonb_array_length(cb_client_link_queue()) n")).rows[0].n,0);
  await as("mgrE");
  const queue=(await db.query("select cb_client_link_queue() q")).rows[0].q;
  assert.ok(queue.length>=4);
  assert.ok(queue.every(row=>row.tenant_id===e.id));
  assert.ok(!JSON.stringify(queue).includes("pan_hash"));
  await db.exec("reset role");
  const link1=(await db.query("select id from cb_client_links where tenant_id=$1 and external_client_id='IDASH-1'",[e.id])).rows[0].id;
  await as("mgrE");
  await db.query("select cb_client_link_confirm($1,$2)",[link1,cl1.id]);
  await db.exec("reset role");
  const linked=(await db.query("select status,client_id,reviewed_by from cb_client_links where id=$1",[link1])).rows[0];
  assert.equal(linked.status,"linked");assert.equal(linked.client_id,cl1.id);assert.equal(linked.reviewed_by,mgrE);
  // the PAN hash is cleared on confirmation, and the intake record can be deleted on request
  assert.equal((await db.query("select pan_hash from cb_client_intake where tenant_id=$1 and external_client_id='IDASH-1'",[e.id])).rows[0].pan_hash,null);
  await as("mgrE");
  await db.query("select cb_client_intake_forget($1)",[link1]);
  await db.exec("reset role");
  assert.equal((await db.query("select count(*) n from cb_client_intake where tenant_id=$1 and external_client_id='IDASH-1'",[e.id])).rows[0].n,0);
  // an RM can neither confirm a link nor delete an intake record
  await as("rmE");
  await assert.rejects(db.query("select cb_client_link_confirm($1,$2)",[link1,cl1.id]),/Permission required/);
  await assert.rejects(db.query("select cb_client_intake_forget($1)",[link1]),/Permission required/);
 });
 await db.close();
});
