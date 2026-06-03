#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { toolConnect } from './tools/connect';
import { toolStatus } from './tools/status';
import { toolGetChats } from './tools/get_chats';
import { toolGetMessages } from './tools/get_messages';
import { toolSearchChat } from './tools/search_chat';
import { toolSendMessage } from './tools/send_message';
import { whatsappClient } from './whatsapp';
const server=new Server({name:'whatsapp-claude-connector',version:'0.1.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'whatsapp_connect',description:'Connect to WhatsApp. QR on first run, restores session after.',inputSchema:{type:'object',properties:{},required:[]}},{name:'whatsapp_status',description:'Check connection status and active number.',inputSchema:type:'object',properties:{},required:[]}},{name:'whatsapp_get_chats',description:'List recent chats.',inputSchema:type:'object',properties:{limit:{type:'number'}},required:[]}},{name:'whatsapp_search_chat',description:'Search chats by name or phone.',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}},{name:'whatsapp_get_messages',description:'Get messages from a chat.',inputSchema:{type:'object',properties:{chatId:type:'string'},limit:type:'number'}},required:['chatId']}},{name:'whatsapp_send_message',description:'Send a text message.',inputSchema:{type:'object',properties:{ chatId:type:'string'},text:{type:'string'}},required:['chatId','text']}}]}));
server.setRequestHandler(CallToolRequestSchema,async req=>{try{const{name,arguments:a={}}=req.params;let r:unknown;switch(name){case'whatsapp_connect':r=await toolConnect();break;case'whatsapp_status':r=toolStatus();break;case'whatsapp_get_chats':r=toolGetChats(a as any);break;case'whatsapp_search_chat':r=toolSearchChat(a as any);break;case'whatsapp_get_messages':r=toolGetMessages(a as any);break;case.whatsapp_send_message':r=await toolSendMessage(a as any);break;default:return{content:[{type:'text',text:`Unknown: ${name}`}],isError:true};}return{content:[{type:'text',text:JSON.stringify(r,null,2)}]};}catch(e){return{content:[{type:'text',text:`Error: ${e instanceof Error?e.message:String(e)}`}],isError:true};}});
const L=path.join(os.homedir(),'.whatsapp-claude','error.log');
function le(t:string,e:unknown):void{const m=`[${new Date().toISOString()}] ${t}: ${e}\n`;process.stderr.write(m);try{fs.appendFileSync(L,m);}catch{}}
process.on('uncaughtException',e=>le('uncaught',e));
process.on('unhandledRejection',e=>le('unhandled',e));
async function main(){process.stdin.resume();whatsappClient.loadStore();const t=new StdioServerTransport();await server.connect(t);process.stderr.write('WhatsApp Claude Connector v0.1.7 running\n');const cf=path.join(os.homedir(),'.whatsapp-claude','session','creds.json');if(fs.existsSync(cf)){whatsappClient.connect().catch(e=>process.stderr.write(`Auto-connect failed: ${e}\n`));}}
main().catch(e=>{process.stderr.write(`Fatal: ${e}\n`);process.exit(1);});
