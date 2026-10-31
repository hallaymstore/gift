'use strict';
const https=require('https');
function getJson(url){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{timeout:12000,headers:{'User-Agent':'HALLAYM-MusicBot/1.0'}},res=>{
      let body='';
      res.on('data',chunk=>{body+=chunk;if(body.length>1500000)req.destroy(new Error('response too large'));});
      res.on('end',()=>{try{if(res.statusCode!==200)throw new Error('Music catalog HTTP '+res.statusCode);resolve(JSON.parse(body));}catch(e){reject(e);}});
    });
    req.on('timeout',()=>req.destroy(new Error('Music catalog timeout')));
    req.on('error',reject);
  });
}
async function searchExternalMusic(query,limit=24){
  const q=String(query||'').trim().slice(0,100);
  if(q.length<2)return [];
  const clientId=String(process.env.JAMENDO_CLIENT_ID||'').trim();
  if(!clientId)throw new Error('JAMENDO_CLIENT_ID Render environmentda sozlanmagan');
  const u='https://api.jamendo.com/v3.0/tracks/?client_id='+encodeURIComponent(clientId)+
    '&format=json&limit='+Math.min(limit,30)+'&search='+encodeURIComponent(q)+
    '&audioformat=mp32&audiodlformat=mp32&include=licenses';
  const data=await getJson(u);
  if(data.headers?.status!=='success')throw new Error(String(data.headers?.error_message||'Music catalog error'));
  return (data.results||[])
    .filter(x=>x.audiodownload_allowed===true&&/^https:\/\//i.test(String(x.audiodownload||'')))
    .map(x=>({title:String(x.name||'').slice(0,110),artist:String(x.artist_name||'').slice(0,90),
      album:String(x.album_name||'').slice(0,100),url:String(x.audiodownload),
      durationMs:Number(x.duration||0)*1000,id:String(x.id||''),license:String(x.license_ccurl||'')}))
    .slice(0,limit);
}
function formatExternalMusic(items,query,offset=0){
  return '🎵 MP3 QIDIRUV\n🔎 '+query+'\n\n'+items.slice(offset,offset+8)
    .map((x,i)=>(offset+i+1)+'. '+x.artist+' — '+x.title).join('\n')+
    '\n\n👇 Kerakli qo‘shiq raqamini bosing. Natijalar Jamendo katalogidagi yuklab olishga ruxsat berilgan MP3lardir.';
}
module.exports={searchExternalMusic,formatExternalMusic};
