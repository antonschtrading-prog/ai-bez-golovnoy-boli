'use strict';
// Local preparation server. No public listener or account creation endpoint.
const http=require('node:http');
const {Store}=require('./store.cjs');
const {handler}=require('./api.cjs');
const store=new Store(process.env.COURSE_DB||'course.sqlite');
const server=http.createServer(handler({store,origins:(process.env.COURSE_ORIGINS||'http://127.0.0.1:8080').split(','),botToken:process.env.TELEGRAM_BOT_TOKEN}));
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(Number(process.env.PORT||8787),'127.0.0.1',()=>console.log('Preparation API listening on loopback; authentication must be provisioned separately.'));
process.on('SIGTERM',()=>server.close(()=>{store.close();process.exit(0)}));
