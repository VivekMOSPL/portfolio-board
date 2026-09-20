import {test} from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {checkWorkbookArchive,workbookRows,workbookExport} from "../lib/workbooks";
test("XLSX round trip preserves typed data without executing formulas",async()=>{
 const buffer=await workbookExport([{code:"A",name:"Client One",email:"one@example.test"}],["code","name","email"]);
 assert.deepEqual(await workbookRows(buffer),[{code:"A",name:"Client One",email:"one@example.test"}]);
});
test("XLSX formula cells are rejected before importing",async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet("Clients");
 sheet.addRow(["code","name"]);sheet.addRow(["A",{formula:'HYPERLINK("https://example.test")',result:"Bad"}]);
 await assert.rejects(workbookRows(Buffer.from(await book.xlsx.writeBuffer())),/Formulas/);
});
test("XLSX rejects invalid and oversized archives",()=>{
 assert.throws(()=>checkWorkbookArchive(Buffer.from("not a workbook")));
 assert.throws(()=>checkWorkbookArchive(Buffer.alloc(600*1024)),/512 KB/);
});
