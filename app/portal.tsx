"use client";
import Link from "next/link";
import { useEffect,useRef,useState,type ReactNode } from "react";
import { useSearchParams,useRouter } from "next/navigation";
import { channels,statuses,clientInput,parseCsv,toCsv } from "@/lib/domain";
import { formatRupees,formatRupeesCompact } from "@/lib/format";
import type { Account,Membership } from "@/lib/server";

type Row=Record<string,unknown>;
type PageData={rows:Row[];total:number};
type Field={name:string;label:string;type?:string;required?:boolean;options?:readonly string[]|{value:string;label:string}[];hint?:string};
type Modal={title:string;action:string;fields:Field[];values?:Row;extra?:Row;tenant?:string|null};
const s=(v:unknown)=>String(v??"");
const n=(v:unknown)=>Number(v??0);
const label=(v:string)=>v.replaceAll("_"," ").replaceAll("."," ");
const roles=["admin","manager","rm","auditor"];
async function api(url:string,options?:RequestInit) {
 const response=await fetch(url,{...options,headers:{"Content-Type":"application/json",...options?.headers}});
 const data=await response.json();
 if(!response.ok){const e=new Error(data.error||"Request failed") as Error&{status:number};e.status=response.status;throw e;}
 return data;
}
function useApi<T>(url:string|null) {
 const [state,setState]=useState<{url:string;data?:T;error?:string;status?:number}>();
 useEffect(()=>{
  if(!url)return;
  const control=new AbortController();
  api(url,{signal:control.signal}).then(data=>setState({url,data})).catch(e=>{if(e.name!=="AbortError")setState({url,error:e.message,status:e.status});});
  return ()=>control.abort();
 },[url]);
 return state?.url===url?{...state,loading:false}:{data:undefined,error:undefined,status:undefined,loading:!!url};
}
function Notice({children,error=false}:{children:ReactNode;error?:boolean}){return <div className={"notice "+(error?"error":"")} role={error?"alert":"status"}>{children}</div>;}
function Empty({children="No records match these filters."}:{children?:ReactNode}){return <div className="empty"><span aria-hidden="true">◇</span><h3>Nothing here yet</h3><p>{children}</p></div>;}
function Loading(){return <div className="loading" role="status">Loading your workspace…</div>;}
function Pager({page,total,onPage}:{page:number;total:number;onPage:(n:number)=>void}) {
 return <div className="pager"><span>{total?((page-1)*30+1)+"–"+Math.min(page*30,total):0} of {total} records</span><div><button disabled={page<=1} onClick={()=>onPage(page-1)}>Previous</button><button disabled={page*30>=total} onClick={()=>onPage(page+1)}>Next</button></div></div>;
}
function Form({fields,values={},extra={},onSubmit,submit="Save"}:{fields:Field[];values?:Row;extra?:Row;onSubmit:(d:Row)=>Promise<unknown>;submit?:string}) {
 const [error,setError]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 return <form onSubmit={async e=>{
  e.preventDefault();setError("");setMessage("");setBusy(true);
  try{
   const raw=new FormData(e.currentTarget),data:Row={...extra};
   for(const f of fields){
    const value=String(raw.get(f.name)??"").trim();
    data[f.name]=f.type==="checkbox"?raw.get(f.name)==="on":f.type==="number"?Number(value):f.type==="money"?Math.round(Number(value)*100):f.type==="datetime-local"?(value?new Date(value).toISOString():""):value;
   }
   const result=await onSubmit(data);
   if(result&&typeof result==="object"&&"message" in result)setMessage(s(result.message));
  }catch(err){setError(err instanceof Error?err.message:"Could not save");}
  finally{setBusy(false);}
 }}>
  <div className="form-grid">{fields.map(f=>{
   const value=values[f.name];
   let defaultValue=s(value);
   if(f.type==="money")defaultValue=String(n(value)/100);
   if(f.type==="datetime-local"&&value){const date=new Date(s(value));defaultValue=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
   return <label key={f.name} className={f.type==="textarea"?"wide":""}><span>{f.label}{f.required?" *":""}</span>
   {f.options?<select name={f.name} defaultValue={defaultValue} required={f.required}><option value="">Select…</option>{f.options.map(o=>typeof o==="string"?<option key={o} value={o}>{label(o)}</option>:<option key={o.value} value={o.value}>{o.label}</option>)}</select>
   :f.type==="textarea"?<textarea name={f.name} defaultValue={defaultValue} required={f.required} rows={3} maxLength={4000}/>
   :f.type==="checkbox"?<input name={f.name} type="checkbox" defaultChecked={Boolean(value)}/>
   :<input name={f.name} type={f.type==="money"?"number":f.type||"text"} defaultValue={defaultValue} required={f.required} min={f.type==="number"||f.type==="money"?0:undefined} step={f.type==="money"?"0.01":undefined} autoComplete={f.type==="password"?"current-password":f.type==="email"?"email":"off"}/>}
   {f.hint&&<small>{f.hint}</small>}
   </label>;
  })}</div>
  {error&&<Notice error>{error}</Notice>}{message&&<Notice>{message}</Notice>}
  <button className="primary" disabled={busy} type="submit">{busy?"Saving…":submit}</button>
 </form>;
}
function Dialog({modal,onClose,onSubmit}:{modal:Modal;onClose:()=>void;onSubmit:(data:Row)=>Promise<unknown>}) {
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{ref.current?.showModal();},[]);
 return <dialog ref={ref} onCancel={onClose}><header><div><p className="eyebrow">WORKSPACE ACTION</p><h2>{modal.title}</h2></div><button aria-label="Close dialog" onClick={onClose}>✕</button></header><Form fields={modal.fields} values={modal.values} extra={modal.extra} onSubmit={onSubmit}/></dialog>;
}
const clientFields:Field[]=[
 {name:"code",label:"Client code",required:true},{name:"name",label:"Full name / entity",required:true},
 {name:"email",label:"Email",type:"email"},{name:"phone",label:"Phone",hint:"International format, for example +919876543210"},
 {name:"kind",label:"Type",options:["prospect","client"],required:true},{name:"segment",label:"Segment"},{name:"source",label:"Source"},
 {name:"consent",label:"Communication consent recorded",type:"checkbox"}
];
const followupFields:Field[]=[
 {name:"title",label:"Commitment / title",required:true},{name:"reason",label:"Reason",required:true},
 {name:"channel",label:"Channel",options:channels,required:true},{name:"priority",label:"Priority",options:["low","normal","high","urgent"],required:true},
 {name:"value_paise",label:"Opportunity value (₹)",type:"money",required:true},{name:"product",label:"Product / category"},
 {name:"due_at",label:"Next due date & time",type:"datetime-local",hint:"Enter in your device's local timezone."},
 {name:"reminder_at",label:"Reminder time",type:"datetime-local"},{name:"next_action",label:"Next action"},{name:"description",label:"Description",type:"textarea"}
];
const outcomeFields:Field[]=[
 {name:"status",label:"Status",options:statuses,required:true},{name:"due_at",label:"Next due date & time",type:"datetime-local"},
 {name:"next_action",label:"Next action"},{name:"no_date_reason",label:"Reason if Waiting without a date"},
 {name:"outcome_note",label:"Outcome note (required for Won / Lost)",type:"textarea"},
 {name:"loss_reason",label:"Loss reason (required for Lost)"},{name:"converted_paise",label:"Converted amount (₹)",type:"money"}
];
const tenantFields:Field[]=[
 {name:"name",label:"Business name",required:true},{name:"business_type",label:"Business type",options:["MFD","CFA","CA","wealth manager","other"],required:true},
 {name:"plan",label:"Subscription plan",required:true},{name:"user_limit",label:"User limit",type:"number",required:true},{name:"client_limit",label:"Client limit",type:"number",required:true}
];
function Auth({section}:{section:string}) {
 const params=useSearchParams(),router=useRouter();
 const [message,setMessage]=useState("");
 const password={name:"password",label:"Password",type:"password",required:true};
 const email={name:"email",label:"Email",type:"email",required:true};
 const title:Record<string,string>={login:"Welcome back",register:"Create your account","forgot-password":"Reset your password","reset-password":"Choose a new password",confirm:"Confirm your email",invite:"Accept your invitation"};
 return <main className="auth"><div className="auth-story"><Link href="/login" className="brand"><span>F</span> Follow-through</Link><div><p className="eyebrow">CLIENT FOLLOW-UP BOARD</p><h1>Every commitment.<br/>A clear next step.</h1><p>One workspace for your clients, your team, and the conversations that matter.</p></div><p className="muted">Built for advisory businesses.</p></div>
 <section className="auth-form"><p className="eyebrow">YOUR SECURE WORKSPACE</p><h2>{title[section]||"Sign in"}</h2><p className="muted">Client commitments and follow-ups requiring action.</p>
 {message&&<Notice>{message}</Notice>}
 {section==="login"&&<><Form fields={[email,password]} submit="Sign in" onSubmit={async d=>{await api("/api/auth/login",{method:"POST",body:JSON.stringify(d)});router.replace("/dashboard");router.refresh();}}/><Link href="/forgot-password">Forgot your password?</Link><p>Invited to a business? <Link href="/register">Create an account</Link>, then reopen your invitation.</p></>}
 {section==="register"&&<Form fields={[email,{...password,hint:"Use at least 12 characters."}]} submit="Create account" onSubmit={d=>api("/api/auth/signup",{method:"POST",body:JSON.stringify(d)})}/>}
 {section==="forgot-password"&&<Form fields={[email]} submit="Request recovery email" onSubmit={d=>api("/api/auth/forgot",{method:"POST",body:JSON.stringify(d)})}/>}
 {section==="reset-password"&&<Form fields={[{name:"token_hash",label:"Recovery code",required:true,hint:"Prefilled from your recovery email. Ask your administrator if it is missing."},{...password,hint:"At least 12 characters."}]} values={{token_hash:params.get("token_hash")||""}} submit="Reset password" onSubmit={async d=>{await api("/api/auth/confirm",{method:"POST",body:JSON.stringify({token_hash:d.token_hash,type:"recovery"})});return api("/api/auth/password",{method:"POST",body:JSON.stringify({password:d.password})});}}/>}
 {section==="confirm"&&<Form fields={[{name:"token_hash",label:"Confirmation code",required:true}]} values={{token_hash:params.get("token_hash")||""}} submit="Confirm email" onSubmit={async d=>{await api("/api/auth/confirm",{method:"POST",body:JSON.stringify({...d,type:"email"})});setMessage("Email confirmed. You can now open your invitation.");return {message:"Account confirmed."};}}/>}
 {section==="invite"&&<><Notice>Sign in with the invited email address before accepting. Invitations expire after 48 hours and can be used once.</Notice><Form fields={[{name:"token",label:"Invitation token",required:true}]} values={{token:params.get("token")||""}} submit="Accept invitation" onSubmit={async d=>{const result=await api("/api/command",{method:"POST",body:JSON.stringify({tenant:null,action:"invite.accept",data:d})});router.replace("/dashboard?tenant="+result.tenant_id);router.refresh();}}/><Link href="/login" target="_blank">Sign in in a new tab</Link> · <Link href="/register" target="_blank">Create account</Link></>}
 {section!=="login"&&<p><Link href="/login">Back to sign in</Link></p>}
 <footer><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></footer>
 </section></main>;
}
const publicSections=["login","register","forgot-password","reset-password","confirm","invite"];
export default function Portal({section}:{section:string}) {
 if(publicSections.includes(section))return <Auth section={section}/>;
 if(["privacy","terms"].includes(section))return <main className="legal"><h1>{section==="privacy"?"Privacy information":"Terms of use"}</h1><p>This workspace processes business contact details, follow-ups, interactions and audit records to help your advisory business manage client commitments. Access is limited by business membership and assigned responsibilities.</p><p>Your advisory business is responsible for obtaining consent, determining retention, responding to data requests, and authorizing exports. Contact your business administrator for access, correction, export or account closure requests.</p><p>Use this service only for authorized business records. Keep credentials private. Financial advice and regulatory decisions remain the responsibility of your advisory business.</p><Notice>This is an operational notice. The operator must supply its legal identity, privacy contact, retention policy and formally reviewed terms before production launch. No regulatory compliance is claimed.</Notice><Link href="/login">Return to sign in</Link></main>;
 return <Workspace section={section}/>;
}
function Workspace({section}:{section:string}) {
 const params=useSearchParams(),router=useRouter(),[revision,setRevision]=useState(0),[modal,setModal]=useState<Modal|null>(null),[notice,setNotice]=useState(""),[actionError,setActionError]=useState("");
 const session=useApi<Account&{email:string}>("/api/session?v="+revision),ac=session.data;
 const active=ac?.memberships.filter(m=>m.active&&["active","trial"].includes(m.tenant_status))??[];
 const tenant=params.get("tenant")||active[0]?.tenant_id||"",member=active.find(m=>m.tenant_id===tenant);
 const link=(path:string)=>"/"+path+(tenant?"?tenant="+tenant:"");
 const refresh=()=>setRevision(v=>v+1);
 const command=async(action:string,data:Row,target:string|null=tenant)=>{
  setActionError("");const result=await api("/api/command",{method:"POST",body:JSON.stringify({tenant:target,action,data})});refresh();return result;
 };
 const open=(m:Modal)=>{setNotice("");setModal(m);};
 const act=async(action:string,data:Row)=>{try{await command(action,data);}catch(e){setActionError(e instanceof Error?e.message:"Action failed");}};
 const url=(resource:string,extra:Record<string,string|number>={})=>"/api/data?"+new URLSearchParams({resource,tenant,v:String(revision),...Object.fromEntries(Object.entries(extra).map(([k,v])=>[k,String(v)]))}).toString();
 const teamVisible=member&&["admin","manager"].includes(member.role);
 const nav=[["dashboard","Overview"],["my-day","My day"],["follow-ups","Follow-ups"],["clients","Clients & prospects"],["calendar","Calendar"],
 ...(teamVisible?[["team","Team"]]:[]),...(member?.role==="admin"?[["imports","Imports"]]:[]),["reports","Reports"],["notifications","Notifications"],
 ...(member&&["admin","auditor"].includes(member.role)?[["audit","Audit trail"]]:[]),...(member?.role==="admin"?[["settings","Business settings"]]:[]),["security","Profile & security"]];
 if(session.loading)return <Loading/>;
 if(session.error)return <main className="legal"><Notice error>{session.error}</Notice>{session.status===401?<Link className="primary button" href="/login">Sign in</Link>:<button onClick={refresh}>Retry</button>}</main>;
 if(!ac)return <Loading/>;
 if(!member&&!ac.platform)return <main className="legal"><h1>Workspace unavailable</h1><Notice error>{ac.memberships.length?"Your account is disabled or your business is suspended. Contact your administrator.":"You do not yet belong to a business. Open your invitation to join."}</Notice><Link href="/invite">Accept invitation</Link><button onClick={async()=>{await api("/api/auth/logout",{method:"POST",body:'{"all":false}'});router.replace("/login");router.refresh();}}>Sign out</button></main>;
 return <div className="app-shell"><aside className="sidebar"><Link href={link("dashboard")} className="brand"><span>F</span> Follow-through</Link><p className="eyebrow">WORKSPACE</p>
 {active.length>0&&<select aria-label="Business" value={tenant} onChange={e=>{router.push("/dashboard?tenant="+e.target.value);}}>{active.map(m=><option key={m.tenant_id} value={m.tenant_id}>{m.tenant_name}</option>)}</select>}
 <nav aria-label="Main navigation">{member&&nav.map(([path,title])=><Link key={path} className={section===path?"active":""} href={link(path)}><span aria-hidden="true">{path==="dashboard"?"◈":path==="follow-ups"?"▦":path==="clients"?"◎":"·"}</span>{title}</Link>)}{ac.platform&&<Link className={section==="platform"||!member?"active":""} href="/platform">◇ Platform administration</Link>}</nav>
 <div className="sidebar-footer"><strong>{member?.name||"Platform administrator"}</strong><small>{member?.role||"platform"} · {ac.email}</small><button onClick={async()=>{try{await api("/api/auth/logout",{method:"POST",body:'{"all":false}'});router.replace("/login");router.refresh();}catch(e){setActionError((e as Error).message);}}}>Sign out</button></div></aside>
 <div className="main-shell"><header className="topbar"><span>{member?.tenant_name||"Platform administration"}</span><span className="badge">{member?.role||"Super Admin"}</span><Link href={link("notifications")}>Notifications</Link></header>
 <main className="workspace"><div className="page-heading"><div><p className="eyebrow">{section==="dashboard"?"YOUR BUSINESS AT A GLANCE":"CLIENT FOLLOW-UP BOARD"}</p><h1>{Object.fromEntries(nav)[section]||"Platform administration"}</h1><p className="muted">Client commitments and follow-ups requiring action.</p></div><button onClick={refresh}>↻ Refresh</button></div>
 {notice&&<Notice>{notice}</Notice>}{actionError&&<Notice error>{actionError}</Notice>}
 {(!member||section==="platform")&&ac.platform?<Platform url={url} open={open} ac={ac}/>:member&&<Content section={section} member={member} url={url} open={open} act={act} command={command} link={link} refresh={refresh}/>}
 </main><footer className="app-footer"><span>Follow-through · {member?.timezone||"UTC"}</span><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></footer></div>
 {modal&&<Dialog key={modal.action+s(modal.extra?.id)} modal={modal} onClose={()=>setModal(null)} onSubmit={async data=>{
  const payload=modal.action==="bulk.followup.update"?{items:data.items,changes:Object.fromEntries(Object.entries(data).filter(([k])=>k!=="items"))}:data;
  const result=await command(modal.action,payload,modal.tenant===undefined?tenant:modal.tenant);
  if(result.token)setNotice((result.delivery==="email"
    ?"Invitation created and emailed to "+s(result.delivered_to)+". "
    :"Invitation created for manual delivery."+(result.delivery_reason?" "+s(result.delivery_reason)+" ":" "))
    +"Share this single-use link securely if needed: "+window.location.origin+"/invite?token="+result.token);
  else setNotice("Saved successfully.");
  setModal(null);return result;
 }}/>}
 </div>;
}
type ContentProps={section:string;member:Membership;url:(r:string,e?:Record<string,string|number>)=>string;open:(m:Modal)=>void;act:(a:string,d:Row)=>Promise<void>;command:(a:string,d:Row,t?:string|null)=>Promise<Row>;link:(p:string)=>string;refresh:()=>void};
function Content(p:ContentProps) {
 if(p.section==="clients")return <Clients {...p}/>;
 if(p.section==="team")return <Team {...p}/>;
 if(p.section==="imports")return p.member.role==="admin"?<Imports {...p}/>:<Notice error>Administrator permission required.</Notice>;
 if(p.section==="settings")return p.member.role==="admin"?<Settings {...p}/>:<Notice error>Administrator permission required.</Notice>;
 if(p.section==="notifications")return <Records {...p} resource="notifications"/>;
 if(p.section==="audit")return <Records {...p} resource="audit"/>;
 if(p.section==="security")return <Security {...p}/>;
 return <Followups {...p}/>;
}
function Metrics({url,link}:{url:string;link:(p:string)=>string}) {
 const result=useApi<Row>(url),m=result.data;
 if(result.error)return <Notice error>{result.error}</Notice>;
 if(!m)return <Loading/>;
 return <div className="metrics"><Link className="metric risk" href={link("follow-ups")+"&bucket=open"}><span>Open value at risk</span><strong>{formatRupeesCompact(n(m.value_paise))}</strong><small>{formatRupees(n(m.value_paise))} · {s(m.open)} open commitments</small></Link>
 <Link className="metric" href={link("follow-ups")+"&bucket=overdue"}><span>Overdue</span><strong>{s(m.overdue)}</strong><small>Requires action</small></Link>
 <Link className="metric" href={link("follow-ups")+"&bucket=unplanned"}><span>Unplanned</span><strong>{s(m.unplanned)}</strong><small>Set a next date</small></Link>
 <Link className="metric" href={link("follow-ups")+"&status=Won"}><span>Won / decided</span><strong>{s(m.won)}<em> / {n(m.won)+n(m.lost)}</em></strong><small>{n(m.won)+n(m.lost)?Math.round(n(m.won)*100/(n(m.won)+n(m.lost)))+"% conversion":"No decided outcomes"}</small></Link></div>;
}
function Followups(p:ContentProps) {
 const [now,setNow]=useState(()=>Date.now()),[exportFormat,setExportFormat]=useState("csv");
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);
 const params=useSearchParams(),[page,setPage]=useState(1),[q,setQ]=useState(""),[search,setSearch]=useState(""),[status,setStatus]=useState(params.get("status")||""),[bucket,setBucket]=useState(params.get("bucket")||(p.section==="my-day"?"open":"")),[view,setView]=useState(p.section==="calendar"?"calendar":p.section==="my-day"?"list":"board");
 useEffect(()=>{const timer=setTimeout(()=>setSearch(q),300);return()=>clearTimeout(timer);},[q]);
 const filters={page,...(search?{q:search}:{}),...(status?{status}:{}),...(bucket?{bucket}:{})};
 const result=useApi<PageData>(p.url("followups",filters));
 const saved=useApi<PageData>(p.url("filters"));
 const [selected,setSelected]=useState<string[]>([]);
 const rows=result.data?.rows??[],canWrite=p.member.role!=="auditor";
 const chosen=rows.filter(row=>selected.includes(s(row.id)));
 const metrics=useApi<Row>(p.section==="reports"?p.url("metrics",filters):null);
 const update=(row:Row)=>p.open({title:"Update follow-up",action:"followup.update",fields:outcomeFields,values:row,extra:{id:row.id,version:row.version}});
 const card=(row:Row)=><article className="followup-card" key={s(row.id)}><div className="card-top">{canWrite&&<input type="checkbox" aria-label={"Select "+s(row.title)} checked={selected.includes(s(row.id))} onChange={e=>setSelected(e.target.checked?[...selected,s(row.id)]:selected.filter(id=>id!==row.id))}/>}<span className={"badge priority-"+s(row.priority)}>{s(row.priority)} priority</span><span className="muted">{s(row.channel)}</span></div><h3>{s(row.title)}</h3><Link href={p.link("clients")+"&client="+row.client_id}>{s(row.client_name)}</Link><p className="muted">{s(row.reason)}</p><strong className="card-value">{formatRupees(n(row.value_paise))}</strong><p className={row.due_at&&new Date(s(row.due_at)).getTime()<now&&!["Won","Lost","Cancelled"].includes(s(row.status))?"overdue":""}>{row.due_at?"◷ "+new Date(s(row.due_at)).toLocaleString("en-IN",{timeZone:p.member.timezone,dateStyle:"medium",timeStyle:"short"}):"No due date"}</p><div className="card-footer"><span className="badge">{s(row.status)}</span>{canWrite&&<button onClick={()=>update(row)}>Update</button>}</div></article>;
 return <><Metrics url={p.url("metrics")} link={p.link}/>
 {p.section==="reports"&&metrics.data&&<section className="panel"><h2>Outcome and timeliness report</h2><div className="report-grid"><p><strong>{formatRupees(n(metrics.data.converted_paise))}</strong>Recorded converted value</p><p><strong>{s(metrics.data.on_time)} / {s(metrics.data.completed_with_due)}</strong>Completed on time / completed with a due date</p><p><strong>{s(metrics.data.total)}</strong>Records in selected scope</p></div><p className="muted">Open value excludes Won, Lost and Cancelled. Conversion is Won ÷ (Won + Lost). On-time completion compares completion with the recorded due time. Use the records below to inspect the figures.</p></section>}
 <section className="panel"><div className="section-heading"><div><h2>{p.section==="my-day"?"Your agenda":"Follow-up workspace"}</h2><p className="muted">Overdue first, then priority, due time and opportunity value.</p></div><div className="button-row">{canWrite&&<Link className="button primary" href={p.link("clients")}>+ Schedule from a client</Link>}{p.member.role==="admin"&&<button onClick={async()=>{try{const response=await fetch(p.url("followups",filters).replace("/api/data?","/api/export?")+"&format="+exportFormat);if(!response.ok){const e=await response.json();throw new Error(e.error);}const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="follow-ups."+exportFormat;a.click();URL.revokeObjectURL(url);}catch(e){alert((e as Error).message);}}}>Export filtered {exportFormat.toUpperCase()}</button>}</div></div>
 <div className="toolbar"><label><span className="sr-only">Saved filters</span><select aria-label="Saved filters" defaultValue="" onChange={e=>{const item=saved.data?.rows.find(r=>r.id===e.target.value);if(item){const f=item.filters as Record<string,string>;setQ(f.q||"");setStatus(f.status||"");setBucket(f.bucket||"");setPage(1);}}}><option value="">Saved filters…</option>{saved.data?.rows.map(r=><option key={s(r.id)} value={s(r.id)}>{s(r.name)}</option>)}</select></label><button onClick={()=>p.open({title:"Save current filter",action:"saved_filter.create",fields:[{name:"name",label:"Filter name",required:true}],extra:{filters:{...(search?{q:search}:{}),...(status?{status}:{}),...(bucket?{bucket}:{})}}})}>Save filter</button>{chosen.length>0&&canWrite&&<button onClick={()=>p.open({title:"Update "+chosen.length+" selected follow-ups",action:"bulk.followup.update",fields:outcomeFields.map(f=>f.name==="due_at"?{...f,hint:"A blank date removes the next date for every selected record."}:f),values:{status:"Called",converted_paise:0},extra:{items:chosen.map(row=>({id:row.id,version:row.version}))}})}>Bulk update ({chosen.length})</button>}{p.member.role==="admin"&&<label><span className="sr-only">Export format</span><select value={exportFormat} onChange={e=>setExportFormat(e.target.value)} aria-label="Export format"><option value="csv">CSV export</option><option value="xlsx">XLSX export</option></select></label>}<label className="search"><span className="sr-only">Search follow-ups</span><input placeholder="Search commitments…" value={q} onChange={e=>{setQ(e.target.value);setPage(1);}}/></label><label><span className="sr-only">Status</span><select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">All statuses</option>{statuses.map(v=><option key={v}>{v}</option>)}</select></label><label><span className="sr-only">Due filter</span><select value={bucket} onChange={e=>{setBucket(e.target.value);setPage(1);}}><option value="">All dates</option>{["open","overdue","today","upcoming","unplanned","completed"].map(v=><option key={v} value={v}>{label(v)}</option>)}</select></label><div className="segmented">{["board","list","calendar"].map(v=><button key={v} aria-pressed={view===v} className={view===v?"selected":""} onClick={()=>setView(v)}>{label(v)}</button>)}</div></div>
 {result.error?<Notice error>{result.error}</Notice>:result.loading?<Loading/>:!rows.length?<Empty>Schedule a follow-up from a client profile, or adjust your filters.</Empty>:view==="board"?<div className="board">{statuses.filter(st=>rows.some(r=>r.status===st)).map(st=><section className="lane" key={st}><h3>{st} <span>{rows.filter(r=>r.status===st).length}</span></h3>{rows.filter(r=>r.status===st).map(card)}</section>)}</div>:view==="calendar"?<div className="calendar-list">{[...new Set(rows.map(r=>r.due_at?new Date(s(r.due_at)).toLocaleDateString("en-IN",{timeZone:p.member.timezone,dateStyle:"full"}):"Unscheduled"))].map(day=><section key={day}><h3>{day}</h3><div className="card-grid">{rows.filter(r=>(r.due_at?new Date(s(r.due_at)).toLocaleDateString("en-IN",{timeZone:p.member.timezone,dateStyle:"full"}):"Unscheduled")===day).map(card)}</div></section>)}</div>:<div className="table-wrap"><table><thead><tr><th>Commitment</th><th>Client</th><th>Status</th><th>Priority</th><th>Value</th><th>Due</th>{canWrite&&<th>Action</th>}</tr></thead><tbody>{rows.map(row=><tr key={s(row.id)}><td>{canWrite&&<input type="checkbox" aria-label={"Select "+s(row.title)} checked={selected.includes(s(row.id))} onChange={e=>setSelected(e.target.checked?[...selected,s(row.id)]:selected.filter(id=>id!==row.id))}/>}<strong>{s(row.title)}</strong><small>{s(row.reason)}</small></td><td><Link href={p.link("clients")+"&client="+row.client_id}>{s(row.client_name)}</Link></td><td>{s(row.status)}</td><td>{s(row.priority)}</td><td>{formatRupees(n(row.value_paise))}</td><td>{row.due_at?new Date(s(row.due_at)).toLocaleString("en-IN",{timeZone:p.member.timezone}):"Unplanned"}</td>{canWrite&&<td><button onClick={()=>update(row)}>Update</button></td>}</tr>)}</tbody></table></div>}
 <Pager page={page} total={result.data?.total??0} onPage={setPage}/><small className="muted">Views show the current page of up to 30 records. Summary figures include the full authorized scope.</small>
 </section></>;
}

function Clients(p:ContentProps) {
 const params=useSearchParams(),selected=params.get("client"),[page,setPage]=useState(1),[q,setQ]=useState(""),[search,setSearch]=useState("");
 useEffect(()=>{const timer=setTimeout(()=>setSearch(q),300);return()=>clearTimeout(timer);},[q]);
 const result=useApi<PageData>(p.url("clients",selected?{id:selected}:{page,q:search}));
 const members=useApi<PageData>(p.url("members"));
 const masters=useApi<PageData>(p.url("masters"));
 const configured=(fields:Field[])=>fields.map(field=>{const kind=({segment:"segment",reason:"reason",loss_reason:"loss_reason",product:"product"} as Record<string,string>)[field.name];const choices=masters.data?.rows.filter(r=>r.kind===kind&&r.active).map(r=>s(r.name));return choices?.length?{...field,options:choices}:field;});
 const history=useApi<PageData>(selected?p.url("timeline",{client_id:selected,page}):null);
 const work=useApi<PageData>(selected?p.url("followups",{client_id:selected}):null);
 const canWrite=p.member.role!=="auditor";
 const owner:Field={name:"owner_id",label:"Assigned owner",options:members.data?.rows.filter(r=>r.active&&r.role!=="auditor").map(r=>({value:s(r.user_id),label:s(r.name)+" · "+s(r.role)}))??[],hint:"Showing the first 30 accessible members."};
 const client=result.data?.rows[0];
 if(selected)return <><Link href={p.link("clients")}>← All clients</Link>{result.loading?<Loading/>:result.error?<Notice error>{result.error}</Notice>:!client?<Notice error>Client not found or outside your access.</Notice>:<>
 <section className="panel profile"><div><p className="eyebrow">{s(client.code)} · {s(client.kind)}</p><h2>{s(client.name)}</h2><p>{s(client.email)||"No email"} · {s(client.phone)||"No phone"}</p><p className="muted">{s(client.segment)||"No segment"} · Communication consent: {client.consent?"recorded":"not recorded"}</p></div>
 {canWrite&&<div className="button-row"><button className="primary" onClick={()=>p.open({title:"Schedule follow-up",action:"followup.create",fields:configured(followupFields),values:{channel:"call",priority:"normal",value_paise:0},extra:{client_id:client.id}})}>+ Schedule follow-up</button>
 <button onClick={()=>p.open({title:"Log interaction",action:"interaction.create",fields:[{name:"channel",label:"Channel",options:[...channels,"note"],required:true},{name:"direction",label:"Direction",options:["inbound","outbound"],required:true},{name:"summary",label:"Summary",type:"textarea",required:true},{name:"next_action",label:"Next action",hint:"Use Schedule follow-up to create a dated commitment."}],values:{channel:"call",direction:"outbound"},extra:{id:client.id,version:client.version}})}>Log interaction</button>
 <button onClick={()=>p.open({title:"Edit client",action:"client.update",fields:configured(clientFields.filter(f=>f.name!=="code")),values:client,extra:{id:client.id,version:client.version}})}>Edit profile</button>
 {["admin","manager"].includes(p.member.role)&&<button onClick={()=>p.open({title:"Reassign client and open work",action:"client.assign",fields:[{...owner,required:true}],values:client,extra:{id:client.id,version:client.version}})}>Reassign</button>}
 <button onClick={()=>{if(confirm("Archive this client? Open follow-ups must be closed or archived first. History will be retained."))void p.act("client.archive",{id:client.id,version:client.version});}}>Archive</button></div>}</section>
 <div className="detail-columns"><section className="panel"><h2>Follow-ups</h2>{work.error&&<Notice error>{work.error}</Notice>}{work.loading?<Loading/>:!work.data?.rows.length?<Empty>No follow-ups scheduled.</Empty>:work.data.rows.map(row=><article className="timeline-item" key={s(row.id)}><strong>{s(row.title)}</strong><p>{s(row.status)} · {formatRupees(n(row.value_paise))}</p>{canWrite&&<div className="button-row"><button onClick={()=>p.open({title:"Update follow-up",action:"followup.update",fields:outcomeFields,values:row,extra:{id:row.id,version:row.version}})}>Update / reschedule</button><button onClick={()=>void p.act("followup.duplicate",{id:row.id})}>Duplicate</button><button onClick={()=>{if(confirm("Archive this follow-up and retain its history?"))void p.act("followup.archive",{id:row.id,version:row.version});}}>Archive</button></div>}</article>)}{(work.data?.total??0)>30&&<Link href={p.link("follow-ups")}>View all in follow-up workspace</Link>}</section>
 <section className="panel"><h2>Interaction & change history</h2><p className="muted">Original events are retained.</p>{history.error&&<Notice error>{history.error}</Notice>}{history.loading?<Loading/>:history.data?.rows.map(row=><article className="timeline-item" key={s(row.id)}><small>{new Date(s(row.created_at)).toLocaleString("en-IN",{timeZone:p.member.timezone})} · {label(s(row.kind))}</small><h3>{s(row.summary)}</h3><details><summary>Event details</summary><pre>{JSON.stringify(row.detail,null,2)}</pre><small>Recorded by {s(row.actor_id)}</small>{p.member.role==="admin"&&<button onClick={()=>p.open({title:"Correct timeline entry",action:"interaction.correct",fields:[{name:"summary",label:"Corrected summary",type:"textarea",required:true},{name:"reason",label:"Reason for correction",required:true}],extra:{id:row.id}})}>Add correction</button>}</details></article>)}<Pager page={page} total={history.data?.total??0} onPage={setPage}/></section></div></>}</>;
 return <section className="panel"><div className="section-heading"><div><h2>Clients & prospects</h2><p className="muted">Relationships, ownership and every next step.</p></div>{canWrite&&<button className="primary" onClick={()=>p.open({title:"Add client or prospect",action:"client.create",fields:[...configured(clientFields),...(p.member.role==="rm"?[]:[owner])],values:{kind:"prospect"}})}>+ Add client</button>}</div>
 <label className="search"><span className="sr-only">Search clients</span><input value={q} onChange={e=>{setQ(e.target.value);setPage(1);}} placeholder="Search client name…"/></label>
 {result.error?<Notice error>{result.error}</Notice>:result.loading?<Loading/>:!result.data?.rows.length?<Empty>Add your first client or import an approved contact list.</Empty>:<div className="table-wrap"><table><thead><tr><th>Client</th><th>Contact</th><th>Segment</th><th>Type</th><th>Last contact</th><th>Profile</th></tr></thead><tbody>{result.data.rows.map(row=><tr key={s(row.id)}><td><strong>{s(row.name)}</strong><small>{s(row.code)}</small></td><td>{s(row.email)||s(row.phone)}</td><td>{s(row.segment)||"—"}</td><td><span className="badge">{s(row.kind)}</span></td><td>{row.last_contact_at?new Date(s(row.last_contact_at)).toLocaleDateString("en-IN",{timeZone:p.member.timezone}):"No contact logged"}</td><td><Link href={p.link("clients")+"&client="+row.id}>Open profile →</Link></td></tr>)}</tbody></table></div>}<Pager page={page} total={result.data?.total??0} onPage={setPage}/></section>;
}
function Team(p:ContentProps) {
 const [page,setPage]=useState(1),members=useApi<PageData>(p.url("members",{page})),teams=useApi<PageData>(p.url("teams")),invites=useApi<PageData>(p.member.role==="admin"?p.url("invitations"):null);
 const teamField:Field={name:"team_id",label:"Team / branch",options:teams.data?.rows.map(t=>({value:s(t.id),label:s(t.name)+(t.branch?" · "+s(t.branch):"")}))??[]};
 if(!["admin","manager"].includes(p.member.role))return <Notice error>Team permission required.</Notice>;
 return <><section className="panel"><div className="section-heading"><div><h2>Your team</h2><p className="muted">Roles and assignment boundaries are enforced by the server and database.</p></div>{p.member.role==="admin"&&<div className="button-row"><button onClick={()=>p.open({title:"Create team / branch",action:"team.create",fields:[{name:"name",label:"Team name",required:true},{name:"branch",label:"Branch"}]})}>+ Team / branch</button><button className="primary" onClick={()=>p.open({title:"Invite team member",action:"invite.create",fields:[{name:"name",label:"Name",required:true},{name:"email",label:"Email",type:"email",required:true},{name:"role",label:"Role",options:roles,required:true},teamField],values:{role:"rm"}})}>+ Invite member</button></div>}</div>
 {members.error&&<Notice error>{members.error}</Notice>}{members.loading?<Loading/>:<div className="table-wrap"><table><thead><tr><th>Member</th><th>Role</th><th>State</th><th>Team</th><th>Access</th></tr></thead><tbody>{members.data?.rows.map(m=><tr key={s(m.user_id)}><td><strong>{s(m.name)}</strong><small>{s(m.email)}</small></td><td>{s(m.role)}</td><td>{m.active?"Active":"Disabled"}</td><td>{s(teams.data?.rows.find(t=>t.id===m.team_id)?.name)||"Unassigned"}</td><td>{p.member.role==="admin"&&<button onClick={()=>p.open({title:"Update member access",action:"member.update",fields:[{name:"role",label:"Role",options:roles,required:true},teamField,{name:"active",label:"Account active",type:"checkbox"}],values:m,extra:{user_id:m.user_id,version:m.version}})}>Manage</button>}</td></tr>)}</tbody></table></div>}<Pager page={page} total={members.data?.total??0} onPage={setPage}/></section>
 <section className="panel"><h2>Teams & branches</h2>{teams.error&&<Notice error>{teams.error}</Notice>}<div className="chips">{teams.data?.rows.map(t=><span className="badge" key={s(t.id)}>{s(t.name)} · {s(t.branch)||"No branch"}</span>)}</div></section>
 {p.member.role==="admin"&&<section className="panel"><h2>Invitations</h2><p className="muted">Invitations are emailed when this server has a mail provider configured, and the one-time link is always shown on creation as a fallback. Create a replacement invitation after revoking an existing one.</p>{invites.error&&<Notice error>{invites.error}</Notice>}{invites.data?.rows.map(row=><article key={s(row.id)} className="record-row"><div><strong>{s(row.name)}</strong><p>{s(row.email)} · {s(row.role)}</p></div><span>{row.used_at?"Accepted":row.revoked_at?"Revoked":new Date(s(row.expires_at))<new Date()?"Expired":"Pending"}</span>{!row.used_at&&!row.revoked_at&&<button onClick={()=>{if(confirm("Revoke this invitation?"))void p.act("invite.revoke",{id:row.id});}}>Revoke</button>}</article>)}</section>}</>;
}
function Imports(p:ContentProps) {
 const [csv,setCsv]=useState(""),[parsed,setParsed]=useState<Record<string,string>[]>([]),[mapping,setMapping]=useState<Record<string,string>>({}),[preview,setPreview]=useState<Row[]>([]),[errors,setErrors]=useState<string[]>([]),[duplicates,setDuplicates]=useState("reject"),[requestKey,setRequestKey]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const history=useApi<PageData>(p.url("imports"));
 const fields=["code","name","email","phone","owner_id","segment","source"];
 const download=(content:string,name:string)=>{const url=URL.createObjectURL(new Blob([content],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);};
 return <><section className="panel"><div className="section-heading"><div><h2>Import clients</h2><p className="muted">CSV / XLSX · up to 500 rows · international phone format · all-or-nothing validation</p></div><button onClick={()=>download("code,name,email,phone,owner_id,segment,source\r\n","client-template.csv")}>Download template</button></div>
 <ol className="steps"><li>Upload</li><li>Map columns</li><li>Validate</li><li>Confirm</li></ol>
 <label>CSV or XLSX file<input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={async e=>{
 const file=e.target.files?.[0];if(!file)return;setErrors([]);setPreview([]);setParsed([]);
 try{
 if(file.name.toLowerCase().endsWith(".xlsx")){
  if(file.size>512*1024)throw new Error("XLSX exceeds 512 KB");
  const content=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(new Error("Could not read file"));reader.readAsDataURL(file);});
  const result=await api("/api/import-file",{method:"POST",body:JSON.stringify({tenant:p.member.tenant_id,content})});
  const rows=result.rows as Record<string,string>[];setParsed(rows);setMapping(Object.fromEntries(fields.map(f=>[f,f in (rows[0]??{})?f:""])));setCsv("");
 }else{if(file.size>1024*1024)throw new Error("CSV exceeds 1 MB");setCsv(await file.text());}
 }catch(err){setErrors([(err as Error).message]);}
 }}/></label>
 <label>Or paste CSV<textarea rows={5} value={csv} onChange={e=>{setCsv(e.target.value);setParsed([]);setPreview([]);}}/></label>
 <button disabled={!csv.trim()} onClick={()=>{try{const rows=parseCsv(csv);setParsed(rows);setMapping(Object.fromEntries(fields.map(f=>[f,f in (rows[0]??{})?f:""])));setErrors([]);setPreview([]);}catch(e){setErrors([(e as Error).message]);}}}>Read columns</button>
 {parsed.length>0&&<><h3>Column mapping · {parsed.length} rows</h3><div className="form-grid">{fields.map(f=><label key={f}>{label(f)}<select value={mapping[f]||""} onChange={e=>{setMapping({...mapping,[f]:e.target.value});setPreview([]);}}><option value="">Not mapped</option>{Object.keys(parsed[0]).map(h=><option key={h}>{h}</option>)}</select></label>)}</div><button onClick={()=>{
  const problems:string[]=[],valid:Row[]=[];
  parsed.forEach((row,index)=>{const data=Object.fromEntries(fields.map(f=>[f,mapping[f]?row[mapping[f]]:""]));const result=clientInput.safeParse({...data,kind:"prospect",consent:false});if(!result.success)problems.push("Row "+(index+2)+": "+result.error.issues.map(i=>i.path.join(".")+" "+i.message).join("; "));else valid.push(result.data);});
  setErrors(problems);setPreview(problems.length?[]:valid);setRequestKey(crypto.randomUUID());setMessage("");
 }}>Validate mapped rows</button></>}
 {errors.length>0&&<Notice error><strong>Nothing has been imported.</strong><ul>{errors.slice(0,20).map((e,i)=><li key={i}>{e}</li>)}</ul><button onClick={()=>download(toCsv(errors.map(error=>({error})),["error"]),"import-errors.csv")}>Download errors</button></Notice>}
 {preview.length>0&&<><Notice>{preview.length} rows passed field validation. Existing client codes, emails and phone numbers are checked transactionally at confirmation. No records have been saved yet.</Notice><div className="table-wrap"><table><thead><tr><th>Code</th><th>Name</th><th>Email / phone</th></tr></thead><tbody>{preview.slice(0,10).map((row,i)=><tr key={i}><td>{s(row.code)}</td><td>{s(row.name)}</td><td>{s(row.email)||s(row.phone)}</td></tr>)}</tbody></table><small>Previewing the first {Math.min(10,preview.length)} rows.</small></div><label>Duplicate strategy<select value={duplicates} onChange={e=>setDuplicates(e.target.value)}><option value="reject">Reject the entire import if a duplicate exists</option><option value="skip">Skip existing duplicates</option></select></label><button className="primary" disabled={busy} onClick={async()=>{
  setBusy(true);setErrors([]);
  try{const result=await p.command("import.clients",{request_key:requestKey,duplicates,rows:preview});setMessage("Import complete: "+s(result.rows_created)+" created, "+s(result.rows_skipped)+" skipped.");setPreview([]);}catch(e){setErrors([(e as Error).message]);}finally{setBusy(false);}
 }}>{busy?"Importing…":"Confirm import"}</button></>}{message&&<Notice>{message}</Notice>}</section>
 <section className="panel"><h2>Import history</h2>{history.error&&<Notice error>{history.error}</Notice>}{history.data?.rows.length?history.data.rows.map(row=><article key={s(row.id)} className="record-row"><div><strong>{s(row.rows_created)} created · {s(row.rows_skipped)} skipped</strong><p>{new Date(s(row.created_at)).toLocaleString()}</p></div><span className="badge">Committed</span></article>):<Empty>No completed imports.</Empty>}</section></>;
}
function Settings(p:ContentProps) {
 const result=useApi<PageData>(p.url("settings")),tenant=result.data?.rows[0];
 if(result.error)return <Notice error>{result.error}</Notice>;
 if(!tenant)return <Loading/>;
 return <><MasterData {...p}/><section className="panel"><h2>Business profile & follow-up rules</h2><Form key={s(tenant.version)} fields={[{name:"name",label:"Business name",required:true},{name:"timezone",label:"IANA timezone",required:true,hint:"For example Asia/Kolkata"},{name:"escalation_hours",label:"Escalate after overdue hours",type:"number",required:true}]} values={tenant} extra={{version:tenant.version}} onSubmit={d=>p.command("settings.update",d)}/><div className="rule"><h3>Subscription & limits</h3><p>{s(tenant.plan)} · {s(tenant.user_limit)} active users · {s(tenant.client_limit)} active clients</p><p>Status: {s(tenant.status)} · Renewal: {s(tenant.renewal_at)||"Not set"}</p></div><Notice>Email, WhatsApp, SMS, SSO and attachment scanning are not configured. In-app reminder processing requires the operator to configure and schedule the background worker.</Notice></section></>;
}
function Records(p:ContentProps&{resource:string}) {
 const [page,setPage]=useState(1),result=useApi<PageData>(p.url(p.resource,{page}));
 if(result.error)return <Notice error>{result.error}</Notice>;
 return <section className="panel"><h2>{p.resource==="audit"?"Immutable audit history":"Your notifications"}</h2>{result.loading?<Loading/>:!result.data?.rows.length?<Empty/>:result.data.rows.map(row=><article className="record-row" key={s(row.id)}><div><strong>{s(row.message||row.action)}</strong><p className="muted">{new Date(s(row.created_at)).toLocaleString("en-IN",{timeZone:p.member.timezone})}</p>{p.resource==="audit"&&<small>Actor {s(row.actor_id)} · Record {s(row.entity_id)||"—"}</small>}</div>{p.resource==="notifications"&&<div className="button-row">{row.client_id?<Link href={p.link("clients")+"&client="+row.client_id}>Open client</Link>:null}{!row.read_at&&<button onClick={()=>void p.act("notification.read",{id:row.id})}>Mark read</button>}</div>}</article>)}<Pager page={page} total={result.data?.total??0} onPage={setPage}/></section>;
}
function Security(p:ContentProps) {
 const router=useRouter(),preferences=useApi<PageData>(p.url("preferences"));
 return <div className="detail-columns"><section className="panel"><h2>Account security</h2><Form fields={[{name:"password",label:"New password",type:"password",required:true,hint:"At least 12 characters."}]} submit="Change password" onSubmit={d=>api("/api/auth/password",{method:"POST",body:JSON.stringify(d)})}/><button onClick={async()=>{if(confirm("Sign out all your sessions?")){await api("/api/auth/logout",{method:"POST",body:'{"all":true}'});router.replace("/login");router.refresh();}}}>Sign out all devices</button><p className="muted">Application data access is revoked immediately. Supabase refresh sessions are also signed out.</p></section><section className="panel"><h2>Notification preferences</h2>{preferences.error&&<Notice error>{preferences.error}</Notice>}<Form key={String(preferences.data?.rows[0]?.in_app)} fields={[{name:"in_app",label:"Receive in-app scheduled reminders",type:"checkbox"}]} values={{in_app:preferences.data?.rows[0]?.in_app??true}} onSubmit={d=>p.command("preferences.update",d)}/><Notice>Assignment notifications remain active. Email and messaging preferences will be available once delivery providers are configured.</Notice></section></div>;
}
function Platform({url,open,ac}:{url:ContentProps["url"];open:ContentProps["open"];ac:Account}) {
 const [page,setPage]=useState(1),result=useApi<PageData>(ac.platform?url("tenants",{page}):null),usage=useApi<PageData>(ac.platform?url("usage"):null),plans=useApi<PageData>(ac.platform?url("plans"):null);
 if(!ac.platform)return <Notice error>Platform permission required.</Notice>;
 return <section className="panel"><div className="section-heading"><div><h2>Subscribed businesses</h2><p>Plans: {plans.data?.rows.map(r=>s(r.name)).join(", ")||"Loading…"}</p><button onClick={()=>open({title:"Create subscription plan",action:"plan.create",tenant:null,fields:tenantFields.filter(f=>["name","user_limit","client_limit"].includes(f.name))})}>+ Subscription plan</button><p className="muted">Business metadata only. Platform access does not grant client-data access.</p></div><button className="primary" onClick={()=>open({title:"Create business",action:"tenant.create",tenant:null,fields:tenantFields,values:{business_type:"MFD",plan:"Starter",user_limit:10,client_limit:1000}})}>+ Create business</button></div>
 {result.error?<Notice error>{result.error}</Notice>:result.loading?<Loading/>:!result.data?.rows.length?<Empty>Create the first business and invite its administrator.</Empty>:result.data.rows.map(row=><article className="record-row" key={s(row.id)}><div><h3>{s(row.name)}</h3><p>{s(row.business_type)} · {s(row.plan)} · {s(row.status)}</p><small>{s(usage.data?.rows.find(u=>u.tenant_id===row.id)?.users)} / {s(row.user_limit)} users · {s(usage.data?.rows.find(u=>u.tenant_id===row.id)?.clients)} / {s(row.client_limit)} clients · {s(usage.data?.rows.find(u=>u.tenant_id===row.id)?.followups)} follow-ups</small></div><div className="button-row"><button onClick={()=>open({title:"Manage business",action:"tenant.update",tenant:s(row.id),fields:[...tenantFields.filter(f=>f.name!=="business_type"),{name:"status",label:"Status",options:["trial","active","suspended","archived"],required:true},{name:"renewal_at",label:"Renewal date",type:"date"}],values:row,extra:{version:row.version}})}>Manage</button><button onClick={()=>open({title:"Invite business administrator",action:"invite.create",tenant:s(row.id),fields:[{name:"name",label:"Administrator name",required:true},{name:"email",label:"Email",type:"email",required:true}],extra:{role:"admin"}})}>Invite admin</button></div></article>)}<Pager page={page} total={result.data?.total??0} onPage={setPage}/></section>;
}

function MasterData(p:ContentProps) {
 const [page,setPage]=useState(1),result=useApi<PageData>(p.url("masters",{page}));
 return <section className="panel"><div className="section-heading"><div><h2>Business master data</h2><p className="muted">Deactivate values to retire them while preserving operational history.</p></div><button onClick={()=>p.open({title:"Add master value",action:"master.create",fields:[{name:"kind",label:"Category",options:["segment","tag","reason","loss_reason","product","custom_field"],required:true},{name:"name",label:"Value / field name",required:true}]})}>+ Add value</button></div>{result.error&&<Notice error>{result.error}</Notice>}{result.data?.rows.map(row=><article key={s(row.id)} className="record-row"><div><strong>{s(row.name)}</strong><p>{label(s(row.kind))} · {row.active?"Active":"Inactive"}</p></div><button onClick={()=>void p.act("master.update",{id:row.id,version:row.version,active:!row.active})}>{row.active?"Deactivate":"Reactivate"}</button></article>)}<Pager page={page} total={result.data?.total??0} onPage={setPage}/></section>;
}

