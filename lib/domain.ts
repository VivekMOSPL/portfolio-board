import { z } from "zod";

export const statuses = ["New","Due","Called","Meeting Scheduled","Met","Waiting on Client","Follow-up Required","Won","Lost","Cancelled"] as const;
export const channels = ["call","meeting","email","whatsapp","video","other"] as const;
const id = z.uuid();
const text = (max=200) => z.string().trim().min(1,"This field is required").max(max);
const optionalText = (max=200) => z.string().trim().max(max).optional();
const optionalId = z.union([id,z.literal("")]).optional();
const date = z.union([z.iso.datetime({offset:true}),z.literal("")]).optional();
const money = z.number().int().min(0).max(900000000000000);
const versioned = {id,version:z.number().int().positive()};
const contact = {
 name:text(160).min(2),email:z.union([z.email(),z.literal("")]).optional(),
 phone:z.union([z.string().regex(/^\+[1-9]\d{7,14}$/,"Use international format, e.g. +919876543210"),z.literal("")]).optional(),
 kind:z.enum(["client","prospect"]).default("prospect"),segment:optionalText(100),source:optionalText(100),consent:z.boolean().default(false)
};
const contactRequired = (data:{email?:string;phone?:string}) => !!(data.email||data.phone);
export const clientInput=z.object({code:text(60),...contact,owner_id:optionalId}).strict().refine(contactRequired,"Email or phone is required");
const commands: Record<string,z.ZodType> = {
 "plan.create":z.object({name:text(100),user_limit:z.number().int().positive(),client_limit:z.number().int().positive()}).strict(),
 "saved_filter.create":z.object({name:text(80),filters:z.lazy(()=>filterInput)}).strict(),
 "master.create":z.object({kind:z.enum(["segment","tag","reason","loss_reason","product","custom_field"]),name:text(120)}).strict(),
 "master.update":z.object({...versioned,active:z.boolean()}).strict(),
 "followup.duplicate":z.object({id}).strict(),
 "interaction.correct":z.object({id,summary:text(2000),reason:text(1000)}).strict(),
 "tenant.create":z.object({name:text(160).min(2),business_type:z.enum(["MFD","CFA","CA","wealth manager","other"]),plan:text(100),user_limit:z.number().int().positive().max(100000),client_limit:z.number().int().positive().max(10000000)}).strict(),
 "tenant.update":z.object({name:text(160).min(2),status:z.enum(["trial","active","suspended","archived"]),plan:text(100),user_limit:z.number().int().positive().max(100000),client_limit:z.number().int().positive().max(10000000),version:z.number().int().positive(),renewal_at:z.union([z.iso.date(),z.literal("")]).optional()}).strict(),
 "team.create":z.object({name:text(100).min(2),branch:optionalText(100)}).strict(),
 "member.update":z.object({user_id:id,role:z.enum(["admin","manager","rm","auditor"]),team_id:optionalId,active:z.boolean(),version:z.number().int().positive()}).strict(),
 "invite.create":z.object({email:z.email(),name:text(120).min(2),role:z.enum(["admin","manager","rm","auditor"]),team_id:optionalId}).strict(),
 "invite.revoke":z.object({id}).strict(),
 "invite.accept":z.object({token:z.string().regex(/^[a-f0-9-]{72}$/)}).strict(),
 "client.create":clientInput,
 "client.update":z.object({...versioned,...contact}).strict().refine(contactRequired,"Email or phone is required"),
 "client.assign":z.object({...versioned,owner_id:id}).strict(),
 "client.archive":z.object(versioned).strict(),
 "interaction.create":z.object({...versioned,summary:text(2000),channel:z.enum([...channels,"note"]),direction:z.enum(["inbound","outbound"]),next_action:optionalText(1000)}).strict(),
 "followup.create":z.object({client_id:id,title:text(200).min(2),reason:text(120),description:optionalText(4000),channel:z.enum(channels),priority:z.enum(["low","normal","high","urgent"]),value_paise:money,due_at:date,reminder_at:date,next_action:optionalText(1000),product:optionalText(100)}).strict(),
 "followup.update":z.object({...versioned,status:z.enum(statuses),due_at:date,no_date_reason:optionalText(1000),next_action:optionalText(1000),outcome_note:optionalText(2000),loss_reason:optionalText(1000),converted_paise:money.default(0)}).strict().superRefine((d,ctx)=>{
  if(d.status==="Waiting on Client"&&!d.due_at&&!d.no_date_reason)ctx.addIssue({code:"custom",message:"Waiting requires a next date or an explicit no-date reason",path:["due_at"]});
  if(["Won","Lost"].includes(d.status)&&!d.outcome_note)ctx.addIssue({code:"custom",message:"An outcome note is required",path:["outcome_note"]});
  if(d.status==="Lost"&&!d.loss_reason)ctx.addIssue({code:"custom",message:"A loss reason is required",path:["loss_reason"]});
 }),
 "followup.archive":z.object(versioned).strict(),
 "settings.update":z.object({name:text(160).min(2),timezone:text(100),escalation_hours:z.number().int().min(1).max(720),version:z.number().int().positive()}).strict(),
 "notification.read":z.object({id}).strict(),
 "preferences.update":z.object({in_app:z.boolean()}).strict(),
 "import.clients":z.object({request_key:id,duplicates:z.enum(["reject","skip"]),rows:z.array(clientInput).min(1).max(500)}).strict()
};
export function validateCommand(action:string,data:unknown) {
 if(action==="bulk.followup.update"){
  const bulk=z.object({items:z.array(z.object(versioned).strict()).min(1).max(100),changes:z.record(z.string(),z.unknown())}).strict().parse(data);
  commands["followup.update"].parse({...bulk.changes,...bulk.items[0]});return bulk;
 }
 const schema=commands[action];
 if(!schema)throw new AppError(422,"Unknown operation");
 return schema.parse(data);
}
export const filterInput=z.object({q:z.string().trim().max(120).optional(),status:z.enum(statuses).optional(),priority:z.enum(["low","normal","high","urgent"]).optional(),bucket:z.enum(["open","overdue","today","upcoming","unplanned","completed"]).optional(),owner_id:id.optional(),client_id:id.optional()}).strict();
export class AppError extends Error {constructor(public status:number,message:string){super(message);}}
export function checkOrigin(origin:string|null,url:string) {
 if(!origin||origin!==new URL(url).origin)throw new AppError(403,"Request origin is not allowed");
}
export function csvCell(value:unknown) {
 let s=String(value??"");
 if(/^[=+\-@\t\r]/.test(s))s="'"+s;
 return '"'+s.replaceAll('"','""')+'"';
}
export function toCsv(rows:Record<string,unknown>[],columns:string[]) {
 return [columns.join(","),...rows.map(row=>columns.map(col=>csvCell(row[col])).join(","))].join("\r\n");
}
// RFC 4180 quoting; bounded by caller. Reject malformed quotes and inconsistent rows.
export function parseCsv(input:string):Record<string,string>[] {
 const all:string[][]=[];let row:string[]=[],cell="",quoted=false,closed=false;
 input=input.replace(/^\uFEFF/,"");
 for(let i=0;i<input.length;i++){
  const ch=input[i];
  if(quoted){if(ch==='"'){if(input[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
  if(ch==='"'){if(cell||closed)throw new Error("Invalid CSV quoting");quoted=true;}
  else if(ch===","||ch==="\n"||ch==="\r"){
   row.push(cell);cell="";closed=false;
   if(ch!==","){if(ch==="\r"&&input[i+1]==="\n")i++;if(row.some(Boolean))all.push(row);row=[];}
  }else{if(closed)throw new Error("Unexpected characters after quoted value");cell+=ch;}
 }
 if(quoted)throw new Error("Unclosed CSV quote");
 row.push(cell);if(row.some(Boolean))all.push(row);
 const headers=all.shift()?.map(s=>s.trim())??[];
 if(!headers.length||new Set(headers).size!==headers.length||headers.some(h=>!h||["__proto__","prototype","constructor"].includes(h)))throw new Error("CSV headers must be unique and non-empty");
 if(all.length>500)throw new Error("Import at most 500 rows per file");
 return all.map((values,index)=>{if(values.length!==headers.length)throw new Error("Column count mismatch at row "+(index+2));return Object.fromEntries(headers.map((h,i)=>[h,values[i]]));});
}
