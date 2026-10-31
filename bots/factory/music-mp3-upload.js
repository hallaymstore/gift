'use strict';
// Jamendo permits downloading only tracks with audiodownload_allowed=true.
// Upload the downloaded MP3 bytes ourselves: Telegram often cannot fetch
// Jamendo's redirecting audio URL directly.
const https=require('node:https');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');

const MAX_MP3_BYTES=45*1024*1024;
const MAX_REDIRECTS=6;
const MAX_PARALLEL_DOWNLOADS=3;
let activeDownloads=0;

function checkedUrl(value){
  let u;
  try{u=new URL(value);}catch(_){throw new Error('MP3 havolasi noto‘g‘ri');}
  if(u.protocol!=='https:' || !/(^|\.)jamendo\.(?:com|net)$/i.test(u.hostname))
    throw new Error('Audio URL faqat Jamendo serveridan bo‘lishi kerak');
  return u;
}
function requestStream(url,redirects=0){
  return new Promise((resolve,reject)=>{
    let u;
    try{u=checkedUrl(url);}catch(e){return reject(e);}
    const req=https.get(u,{headers:{
      'User-Agent':'HALLAYM-MusicBot/1.0',
      'Accept':'audio/mpeg,audio/*;q=0.9,*/*;q=0.5'
    }},res=>{
      if([301,302,303,307,308].includes(res.statusCode)){
        const next=res.headers.location;
        res.resume();
        if(!next||redirects>=MAX_REDIRECTS)return reject(new Error('Audio manba ko‘p yo‘naltirmoqda'));
        let redirectUrl;
        try{redirectUrl=new URL(next,u).href;}catch(e){return reject(e);}
        return resolve(requestStream(redirectUrl,redirects+1));
      }
      if(res.statusCode!==200){
        res.resume();
        return reject(new Error('Jamendo audio HTTP '+res.statusCode));
      }
      const length=Number(res.headers['content-length']||0);
      if(length>MAX_MP3_BYTES){
        res.destroy();
        return reject(new Error('MP3 hajmi 45 MB dan katta'));
      }
      res.setTimeout(45000,()=>res.destroy(new Error('MP3 yuklash vaqti tugadi')));
      resolve(res);
    });
    req.setTimeout(20000,()=>req.destroy(new Error('Jamendo ulanish vaqti tugadi')));
    req.on('error',reject);
  });
}

async function downloadLicensedMp3(track){
  if(activeDownloads>=MAX_PARALLEL_DOWNLOADS)
    throw new Error('Hozir ko‘p qo‘shiq yuklanmoqda. Birozdan keyin qayta urining');
  if(!track||!/^[1-9]\d*$/.test(String(track.id||'')))
    throw new Error('Qo‘shiq katalog identifikatori yaroqsiz');
  checkedUrl(track.url);
  activeDownloads++;
  let dir=null;
  try{
    dir=await fsp.mkdtemp(path.join(os.tmpdir(),'factory-mp3-'));
    const filePath=path.join(dir,'music.mp3');
    const res=await requestStream(track.url);
    let size=0;
    const checker=new Transform({
      transform(chunk,enc,callback){
        size+=chunk.length;
        if(size>MAX_MP3_BYTES)return callback(new Error('MP3 hajmi 45 MB dan katta'));
        callback(null,chunk);
      }
    });
    await pipeline(res,checker,fs.createWriteStream(filePath,{flags:'wx'}));
    if(size<512)throw new Error('Audio fayli bo‘sh yoki juda kichik');
    const fd=await fsp.open(filePath,'r');
    let first;
    try{
      const buffer=Buffer.alloc(3);
      await fd.read(buffer,0,3,0);
      first=buffer;
    }finally{await fd.close();}
    // Standard MP3 starts with ID3 or MPEG frame sync.
    if(first.toString('ascii')!=='ID3' && !(first[0]===0xff && (first[1]&0xe0)===0xe0))
      throw new Error('Jamendo MP3 o‘rniga boshqa format qaytardi');
    return {
      filePath,size,
      cleanup:async()=>{await fsp.rm(dir,{recursive:true,force:true});activeDownloads=Math.max(0,activeDownloads-1);}
    };
  }catch(e){
    if(dir)await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{});
    activeDownloads=Math.max(0,activeDownloads-1);
    throw e;
  }
}
module.exports={downloadLicensedMp3,MAX_MP3_BYTES};
