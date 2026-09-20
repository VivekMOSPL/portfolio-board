import {test} from "node:test";
import assert from "node:assert/strict";
import {checkOrigin,validateCommand,parseCsv,toCsv} from "../lib/domain";
const id="11111111-1111-4111-8111-111111111111";
test("server rejects missing contact and scope injection",()=>{
 assert.throws(()=>validateCommand("client.create",{code:"A",name:"Person"}),/Email or phone/);
 assert.throws(()=>validateCommand("client.create",{code:"A",name:"Person",email:"x@example.test",tenant_id:id}),/Unrecognized/);
 assert.throws(()=>validateCommand("client.create",{code:"A",name:"Person",phone:"9876543210"}),/international/);
});
test("server enforces outcome and next-date rules",()=>{
 assert.throws(()=>validateCommand("followup.update",{id,version:1,status:"Waiting on Client"}),/next date/);
 assert.throws(()=>validateCommand("followup.update",{id,version:1,status:"Lost",outcome_note:"No"}),/loss reason/);
 assert.throws(()=>validateCommand("followup.update",{id,version:1,status:"Won"}),/outcome note/);
 assert.doesNotThrow(()=>validateCommand("followup.update",{id,version:1,status:"Waiting on Client",no_date_reason:"Client will confirm availability"}));
});
test("server rejects forged origins, unknown commands and negative amounts",()=>{
 assert.throws(()=>checkOrigin("https://evil.test","https://board.test/api/command"),/origin/);
 assert.throws(()=>checkOrigin(null,"https://board.test"),/origin/);
 assert.doesNotThrow(()=>checkOrigin("https://board.test","https://board.test/api"));
 assert.throws(()=>validateCommand("sql.execute",{}),/Unknown/);
 assert.throws(()=>validateCommand("followup.create",{client_id:id,title:"Call",reason:"Review",channel:"call",priority:"normal",value_paise:-1}));
});
test("CSV handles escaped quotes, newlines and rejects corrupt files",()=>{
 assert.deepEqual(parseCsv('code,name,email\r\nA,"Client, One",a@example.test\r\nB,"Two ""quoted""\nlines",b@example.test'),[
 {code:"A",name:"Client, One",email:"a@example.test"},{code:"B",name:'Two "quoted"\nlines',email:"b@example.test"}]);
 assert.throws(()=>parseCsv('code,name\nA,"bad'),/Unclosed/);
 assert.throws(()=>parseCsv("code,code\nA,B"),/unique/);
 assert.throws(()=>parseCsv("code,name\nA"),/Column count/);
 assert.throws(()=>parseCsv("__proto__,name\nA,B"),/unique/);
});
test("CSV exports neutralize spreadsheet formula injection",()=>{
 assert.equal(toCsv([{name:'=HYPERLINK("bad")'}],["name"]),'name\r\n"\'=HYPERLINK(""bad"")"');
});
