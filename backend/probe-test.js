import Ffmpeg from "fluent-ffmpeg";
const filePath = "abc.mp4";

Ffmpeg.ffprobe(filePath,(err,metada) =>{
    if(err){
        console.error("ffprobe error",err);
        return;
    }

    console.log("typeof birate",typeof metada.format?.bit_rate);
    console.log("birate value",metada.format?.bit_rate);
})
