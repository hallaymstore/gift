'use strict';

// Factory promotional video editor: a user-supplied short MP4 with an
// unobtrusive Telegram paper-plane brand and the user's own bot handle.
// Never downloads music or creates content that was not uploaded by the user.
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const sharp=require('sharp');
const {downloadTelegramMedia}=require('./shorts-studio');

const MAX_INPUT_BYTES=19*1024*1024;
const MAX_OUTPUT_BYTES=12*1024*1024;
const MAX_DURATION=60;
const PLACEMENTS=new Set(['top','bottom','tl','tr','bl','br']);
let active=false;

function safeHandle(value){
  const u=String(value||'').trim().replace(/^@/,'');
  if(!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(u))
    throw new Error('Bot username noto‘g‘ri');
  return u;
}
function escapeXml(str){
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function safeTitle(str){
  return String(str||'').replace(/[\r\n\t]/g,' ').trim().slice(0,50);
}
function layout(width,height,placement){
  const margin=Math.max(20,Math.round(width*0.04));
  const pillWidth=Math.min(Math.round(width*.87),Math.max(270,Math.round(width*.61)));
  const pillHeight=Math.round(Math.min(height*.115,Math.max(65,height*.08)));
  const pos=PLACEMENTS.has(placement)?placement:'bottom';
  const x=pos==='tl'||pos==='bl'?margin:
    pos==='tr'||pos==='br'?width-margin-pillWidth:
    Math.round((width-pillWidth)/2);
  const y=pos==='top'||pos==='tl'||pos==='tr'?margin:
    height-margin-pillHeight;
  return {x,y,pillWidth,pillHeight,margin};
}
function overlaySvg({username,title,width,height,placement}){
  const u=safeHandle(username);
  const label='@'+u;
  const desc=safeTitle(title);
  const {x,y,pillWidth,pillHeight}=layout(width,height,placement);
  const icon=Math.min(pillHeight-14,73);
  const iconX=x+Math.round(pillHeight*.19),iconY=y+Math.round((pillHeight-icon)/2);
  const textX=iconX+icon+Math.round(pillHeight*.16);
  const maxTextWidth=x+pillWidth-24-textX;
  const chars=Array.from(label).length;
  const fontSize=Math.max(18,Math.min(Math.round(pillHeight*.38),Math.floor(maxTextWidth/Math.max(4,chars*.57))));
  const titleSize=Math.round(Math.max(13,Math.min(pillHeight*.19,21)));
  const labelY=y+(desc?pillHeight*.50:pillHeight*.62);
  const secondY=y+pillHeight*.79;
  // Stylised Telegram paper-plane icon, authored vector paths.
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'">',
    '<rect width="'+pillWidth+'" height="'+pillHeight+'" x="'+x+'" y="'+y+'" rx="'+Math.min(28,Math.floor(pillHeight*.29))+'" fill="#0B1727" fill-opacity=".84" stroke="#86D4FF" stroke-opacity=".46" stroke-width="2"/>',
    '<g transform="translate('+iconX+' '+iconY+') scale('+(icon/64)+')">',
    '<circle cx="32" cy="32" r="31" fill="#28A8EA"/>',
    '<path d="M12.5 30.8L50.8 16.2C53.2 15.4 55.2 17 54.6 19.9L48.3 50.2C47.8 52.4 45.9 53.1 44.1 51.8L34.2 44.5L29.1 49.3C28.3 50.1 26.7 49.6 26.5 48.4L25.4 37.4L44.5 23.2L21.3 35.5L13.5 33.1C11.7 32.6 11.5 31.2 12.5 30.8Z" fill="#FFFFFF"/>',
    '</g>',
    '<g font-family="DejaVu Sans, Arial, sans-serif" text-anchor="start">',
    '<text x="'+textX+'" y="'+Math.round(labelY)+'" fill="#FFFFFF" font-size="'+fontSize+'" font-weight="800">'+escapeXml(label)+'</text>',
    (desc?'<text x="'+textX+'" y="'+Math.round(secondY)+'" fill="#B6DAF2" font-size="'+titleSize+'" font-weight="600">'+escapeXml(desc.length>30?desc.slice(0,29)+'…':desc)+'</text>':''),
    '</g></svg>'
  ].join('');
}
function ffmpegBinary(){
  try{const p=require('ffmpeg-static');if(p&&fs.existsSync(p))return p;}catch(_){}
  return process.env.FFMPEG_PATH||'ffmpeg';
}
async function renderFfmpeg(args,timeoutMs=105000){
  return new Promise((resolve,reject)=>{
    const child=spawn(ffmpegBinary(),args,{stdio:['ignore','ignore','pipe']});
    let errText='',done=false;
    const timer=setTimeout(()=>{child.kill('SIGKILL');settle(new Error('Video montaj vaqti oshdi. Qisqaroq video yuboring.'));},timeoutMs);
    function settle(err){
      if(done)return;
      done=true;clearTimeout(timer);
      if(err)reject(err);else resolve();
    }
    child.stderr.on('data',chunk=>{errText=(errText+String(chunk)).slice(-1800);});
    child.on('error',e=>settle(new Error('FFmpeg ishga tushmadi: '+e.message)));
    child.on('close',code=>code===0?settle():settle(new Error('Video montaj: '+errText.slice(-350))));
  });
}
async function createPromoVideo({telegram,fileId,size,duration,width,height,username,title,placement,deliver}){
  if(!fileId)throw new Error('Video fayl identifikatori topilmadi');
  if(Number(size)>MAX_INPUT_BYTES)
    throw new Error('Video 19 MB dan katta. Qisqartirib qayta yuboring.');
  if(Number(duration)>MAX_DURATION)
    throw new Error('Video 60 soniyadan uzun. Qisqa video yuboring.');
  if(active)throw new Error('Video montaj band. Boshqa video tugagach qayta yuboring.');
  if(typeof deliver!=='function')throw new Error('Video yuborish callback mavjud emas');
  const handle=safeHandle(username);
  const place=PLACEMENTS.has(placement)?placement:'bottom';
  const srcWidth=Number(width)||720,srcHeight=Number(height)||1280;
  const isLandscape=srcWidth>srcHeight*1.12;
  const square=srcWidth/srcHeight>.88&&srcWidth/srcHeight<1.12;
  const W=isLandscape?960:540;
  const H=isLandscape?540:(square?540:960);
  const seconds=Math.max(1,Math.min(MAX_DURATION,Math.ceil(Number(duration)||30)));
  active=true;
  let dir='';
  try{
    dir=await fsp.mkdtemp(path.join(os.tmpdir(),'factory-promo-'));
    const input=path.join(dir,'original.mp4');
    const output=path.join(dir,'promo.mp4');
    const overlay=path.join(dir,'overlay.png');
    const overlaySource=overlaySvg({username:handle,title,width:W,height:H,placement:place});
    await sharp(Buffer.from(overlaySource)).png({compressionLevel:5}).toFile(overlay);
    const link=await telegram.getFileLink(fileId);
    await downloadTelegramMedia(link,input,MAX_INPUT_BYTES);
    const filters='[0:v]fps=15,scale='+W+':'+H+':force_original_aspect_ratio=decrease:flags=fast_bilinear,'+
      'pad='+W+':'+H+':(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[base];'+
      '[base][1:v]overlay=0:0:shortest=1,format=yuv420p[v]';
    const args=[
      '-hide_banner','-loglevel','error','-y','-i',input,
      '-loop','1','-framerate','15','-i',overlay,
      '-t',String(seconds),'-filter_complex_threads',String(Number(process.env.PROMO_FFMPEG_THREADS||2)),
      '-filter_complex',filters,'-map','[v]','-map','0:a:0?',
      '-r','15','-threads',String(Number(process.env.PROMO_FFMPEG_THREADS||2)),'-c:v','libx264','-preset','ultrafast',
      '-b:v','700k','-maxrate','850k','-bufsize','1600k',
      '-pix_fmt','yuv420p','-c:a','aac','-b:a','72k','-movflags','+faststart',
      output
    ];
    await renderFfmpeg(args,Math.min(300000,Math.max(105000,seconds*6000)));
    const stat=await fsp.stat(output);
    if(stat.size<1024||stat.size>MAX_OUTPUT_BYTES)
      throw new Error('Tayyor video hajmi 12 MB chegarasiga mos emas.');
    await deliver({output,width:W,height:H,bytes:stat.size,username:handle});
    return {bytes:stat.size,width:W,height:H};
  }finally{
    active=false;
    if(dir)await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}

module.exports={MAX_INPUT_BYTES,MAX_DURATION,PLACEMENTS,safeHandle,overlaySvg,createPromoVideo};
