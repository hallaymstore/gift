'use strict';

// The bot may be an administrator of the DESTINATION while lacking read access
// to a public SOURCE. MTProto can fetch accessible, unprotected source media;
// upload as the authorized bot instead of having the MTProto user post there.
// All downloaded content lives only in RAM and is discarded after the send.
const {Input}=require('telegraf');
const MAX_UPLOAD_BYTES=45*1024*1024;

async function uploadSourceMedia({client,telegram,chatId,message,kind,caption}){
  if(message?.noforwards||message?.noForwards||
     message?.chat?.noforwards||message?.chat?.noForwards)
    throw new Error('Manbada nusxalash cheklangan (protected content)');
  const document=message?.media?.document;
  const size=Number(document?.size||message?.file?.size||0);
  if(size>MAX_UPLOAD_BYTES)
    throw new Error('Media '+Math.ceil(size/1024/1024)+' MB. Bot API orqali qayta yuklash uchun 45 MB dan kichik bo‘lishi kerak.');
  if(!message?.media)throw new Error('Media topilmadi');
  const data=await client.downloadMedia(message,{});
  if(!Buffer.isBuffer(data)||!data.length)throw new Error('MTProto mediadan fayl olinmadi');
  if(data.length>MAX_UPLOAD_BYTES)throw new Error('Fayl hajmi 45 MB dan katta');
  const text=String(caption||'').slice(0,1024);
  const mime=String(document?.mimeType||'');
  const attr=(document?.attributes||[]);
  const audioAttr=attr.find(a=>a.className==='DocumentAttributeAudio');
  const videoAttr=attr.find(a=>a.className==='DocumentAttributeVideo');
  const nameAttr=attr.find(a=>a.className==='DocumentAttributeFilename');
  const originalName=String(nameAttr?.fileName||'').slice(0,100);
  let sent;
  if(kind==='photo'){
    sent=await telegram.sendPhoto(chatId,Input.fromBuffer(data,'photo.jpg'),{caption:text});
  }else if(kind==='video'){
    if(/^video\/mp4/i.test(mime))
      sent=await telegram.sendVideo(chatId,Input.fromBuffer(data,'video.mp4'),{
        caption:text,supports_streaming:true,
        ...(videoAttr?.duration?{duration:Math.ceil(videoAttr.duration)}:{})
      });
    else sent=await telegram.sendDocument(chatId,Input.fromBuffer(data,originalName||'video.bin'),{caption:text});
  }else if(kind==='audio'){
    if(audioAttr?.voice){
      sent=await telegram.sendVoice(chatId,Input.fromBuffer(data,'voice.ogg'),{caption:text});
    }else if(/^audio\/(mpeg|mp3|mp4|x-m4a)/i.test(mime)){
      sent=await telegram.sendAudio(chatId,Input.fromBuffer(data,originalName||'audio.mp3'),{
        caption:text,
        ...(audioAttr?.title?{title:String(audioAttr.title).slice(0,100)}:{}),
        ...(audioAttr?.performer?{performer:String(audioAttr.performer).slice(0,100)}:{})
      });
    }else sent=await telegram.sendDocument(chatId,Input.fromBuffer(data,originalName||'audio.bin'),{caption:text});
  }else if(kind==='sticker'){
    // Sticker messages do not support captions.
    sent=await telegram.sendSticker(chatId,Input.fromBuffer(data,originalName||'sticker.webp'));
  }else if(kind==='animation'){
    sent=await telegram.sendAnimation(chatId,Input.fromBuffer(data,originalName||'animation.mp4'),{caption:text});
  }else{
    sent=await telegram.sendDocument(chatId,Input.fromBuffer(data,originalName||'file.bin'),{caption:text});
  }
  return sent;
}
module.exports={uploadSourceMedia,MAX_UPLOAD_BYTES};
