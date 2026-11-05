import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
const schema=z.object({apiUrl:z.string().url().refine(value=>new URL(value).protocol==='https:'),siteId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/),token:z.string().min(32).max(256),backupKey:z.string().regex(/^[a-f0-9]{64}$/),companyId:z.string().uuid(),companyName:z.string(),wallName:z.string()}).strict();
export type CloudConnectionConfig=z.infer<typeof schema>;
export const connectionConfigPath=resolve(process.env.DATA_DIR ?? './data','cloud-connection.json');
export function loadConnectionConfig():CloudConnectionConfig|null {
  if(!existsSync(connectionConfigPath)) return null;
  return schema.parse(JSON.parse(readFileSync(connectionConfigPath,'utf8')));
}
export function saveConnectionConfig(value:CloudConnectionConfig){
  const data=schema.parse(value);
  mkdirSync(dirname(connectionConfigPath),{recursive:true});
  const temporary=connectionConfigPath+'.'+randomUUID()+'.tmp';
  try {writeFileSync(temporary,JSON.stringify(data)+'\n',{mode:0o600,flag:'wx',flush:true});renameSync(temporary,connectionConfigPath);}finally{if(existsSync(temporary)) unlinkSync(temporary);}
}
