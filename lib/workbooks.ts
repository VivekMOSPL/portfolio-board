import ExcelJS from "exceljs";
import {AppError,csvCell} from "./domain";

// Check the ZIP central directory before decompression. Reject ZIP64, encrypted files,
// oversized expansion and malformed archives. The workbook is then parsed by ExcelJS.
export function checkWorkbookArchive(data:Buffer) {
 if(data.length>512*1024||data.length<22)throw new AppError(422,"XLSX must be at most 512 KB.");
 let end=-1;
 for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(data.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw new AppError(422,"Invalid XLSX archive");
 const entries=data.readUInt16LE(end+10),offset=data.readUInt32LE(end+16),size=data.readUInt32LE(end+12);
 if(data.readUInt16LE(end+4)!==0||data.readUInt16LE(end+6)!==0||entries===65535||entries>200||offset+size>end)throw new AppError(422,"Unsupported XLSX archive");
 let cursor=offset,total=0;
 for(let i=0;i<entries;i++){
  if(cursor+46>data.length||data.readUInt32LE(cursor)!==0x02014b50)throw new AppError(422,"Invalid XLSX directory");
  if(data.readUInt16LE(cursor+8)&1)throw new AppError(422,"Encrypted workbooks are not supported");
  const expanded=data.readUInt32LE(cursor+24);total+=expanded;
  if(expanded===0xffffffff||total>8*1024*1024)throw new AppError(422,"Expanded workbook exceeds 8 MB");
  cursor+=46+data.readUInt16LE(cursor+28)+data.readUInt16LE(cursor+30)+data.readUInt16LE(cursor+32);
  if(cursor>offset+size)throw new AppError(422,"Invalid XLSX directory size");
 }
 if(cursor!==offset+size)throw new AppError(422,"Invalid XLSX directory size");
}
export async function workbookRows(data:Buffer):Promise<Record<string,string>[]> {
 checkWorkbookArchive(data);
 const book=new ExcelJS.Workbook();
 await book.xlsx.load(data as unknown as Parameters<typeof book.xlsx.load>[0]);
 const sheet=book.worksheets[0];if(!sheet)throw new AppError(422,"Workbook has no worksheet");
 if(sheet.rowCount>501||sheet.columnCount>40)throw new AppError(422,"Use up to 500 data rows and 40 columns");
 const read=(cell:ExcelJS.Cell)=>{
  if(cell.type===ExcelJS.ValueType.Formula)throw new AppError(422,"Formulas are not accepted in imports. Paste values first.");
  if(cell.value instanceof Date)return cell.value.toISOString();
  if(typeof cell.value==="object"&&cell.value!==null)throw new AppError(422,"Use plain text or numeric cells");
  return String(cell.value??"").trim();
 };
 const headers:string[]=[];for(let col=1;col<=sheet.columnCount;col++)headers.push(read(sheet.getCell(1,col)));
 if(!headers.length||new Set(headers).size!==headers.length||headers.some(h=>!h||["__proto__","prototype","constructor"].includes(h)))throw new AppError(422,"Headers must be unique and non-empty");
 const rows:Record<string,string>[]=[];
 for(let row=2;row<=sheet.rowCount;row++){const values=headers.map((_,i)=>read(sheet.getCell(row,i+1)));if(values.some(Boolean))rows.push(Object.fromEntries(headers.map((h,i)=>[h,values[i]])));}
 return rows;
}
export async function workbookExport(rows:Record<string,unknown>[],columns:string[]) {
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet("Follow-ups");
 sheet.addRow(columns);
 for(const row of rows)sheet.addRow(columns.map(key=>{
  const value=row[key];
  // Store strings as strings, never formulas. Prefix risky CSV-style values for portability.
  return typeof value==="number"?value:csvCell(value).slice(1,-1).replaceAll('""','"');
 }));
 sheet.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};
 sheet.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF172536"}};
 sheet.columns.forEach(col=>{col.width=24;});
 return Buffer.from(await book.xlsx.writeBuffer());
}
