'use strict';
const https=require('https');
function getJson(url){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{timeout:8500,headers:{'User-Agent':'HALLAYM-MusicBot/1.0'}},res=>{
      let body='';
      res.on('data',chunk=>{body+=chunk;if(body.length>1500000)req.destroy(new Error('response too large'));});
      res.on('end',()=>{try{if(res.statusCode!==200)throw new Error('Music catalog HTTP '+res.statusCode);resolve(JSON.parse(body));}catch(e){reject(e);}});
    });
    req.on('timeout',()=>req.destroy(new Error('Music catalog timeout')));
    req.on('error',reject);
  });
}
async function searchExternalMusic(query,limit=16){
  const q=String(query||'').trim().slice(0,110);
  if(q.length<2)return [];
  const u='https://itunes.apple.com/search?media=music&entity=song&limit='+Math.min(30,Math.max(4,limit))+'&term='+encodeURIComponent(q);
  const data=await getJson(u);
  return (data.results||[]).filter(x=>x.kind==='song'&&x.trackViewUrl)
    .map(x=>({title:String(x.trackName||'').slice(0,110),artist:String(x.artistName||'').slice(0,90),
      album:String(x.collectionName||'').slice(0,110),url:x.trackViewUrl,
      durationMs:Number(x.trackTimeMillis||0),id:String(x.trackId||'')}))
    .filter(x=>x.title&&x.url).slice(0,limit);
}
function formatExternalMusic(items,query,offset=0){
  const subset=items.slice(offset,offset+8);
  const lines=subset.map((x,i)=>{
    const secs=Math.round(x.durationMs/1000);
    const time=secs?(Math.floor(secs/60)+':'+String(secs%60).padStart(2,'0')):'';
    return (offset+i+1)+'. 🎵 '+x.artist+' — '+x.title+(time?' ('+time+')':'')+'\n'+x.url;
  });
  return '🌐 INTERNETDAGI MUSIQALAR\n🔎 '+query+'\n\n'+lines.join('\n\n')+
    '\n\nℹ️ Rasmiy katalog havolalari. Audio fayl botga yuklanmaydi.';
}
module.exports={searchExternalMusic,formatExternalMusic};
