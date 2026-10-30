# App playback, metadata remuxing, HTTPS/HLS audio and Demucs PCM input.
# ffmpeg CLI requires avfilter, but only these small audio filters are built.
# Keep JPEG/PNG/WebP/BMP for embedded artwork; all video codecs are excluded.
set(AUDIO_DECODERS
    aac aac_fixed aac_latm ac3 alac ape atrac1 atrac3 atrac3p atrac9
    cook dca dsd_lsbf dsd_msbf dsd_lsbf_planar dsd_msbf_planar dst
    eac3 flac mp1 mp1float mp2 mp2float mp3 mp3float mp3adu mp3adufloat
    mp3on4 mp3on4float opus vorbis tta wavpack wmalossless wmapro
    wmav1 wmav2 wmavoice mjpeg png webp bmp)
# Include every PCM and ADPCM variant instead of guessing an audio bit depth.
file(STRINGS "${SOURCE_PATH}/libavcodec/Makefile" PCM_CONFIGS
    REGEX "CONFIG_(PCM_|ADPCM_)[A-Z0-9_]+_DECODER")
foreach(LINE IN LISTS PCM_CONFIGS)
    if(LINE MATCHES "CONFIG_((PCM_|ADPCM_)[A-Z0-9_]+)_DECODER")
        string(TOLOWER "${CMAKE_MATCH_1}" DECODER)
        list(APPEND AUDIO_DECODERS "${DECODER}")
    endif()
endforeach()
list(REMOVE_DUPLICATES AUDIO_DECODERS)
list(JOIN AUDIO_DECODERS "," AUDIO_DECODERS)

string(APPEND OPTIONS
    " --disable-everything --disable-debug --disable-doc"
    " --disable-avdevice --disable-swscale --disable-hwaccels"
    " --disable-d3d11va --disable-d3d12va --disable-dxva2 --disable-mediafoundation"
    " --enable-decoder=${AUDIO_DECODERS}"
    " --enable-encoder=aac,alac,flac,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le"
    " --enable-demuxer=aac,aiff,ape,asf,au,dsf,iff,flac,flv,hls,mov,mp3,mpegts,ogg,wav,wv,tta,matroska,image2,image2pipe,jpeg_pipe,png_pipe,webp_pipe,bmp_pipe"
    " --enable-muxer=adts,aiff,flac,ipod,mov,mp3,ogg,opus,wav,matroska,webm,pcm_f32le,pcm_s16le,hash,null,image2,image2pipe"
    " --enable-parser=aac,aac_latm,ac3,dca,flac,mpegaudio,opus,vorbis,mjpeg,png"
    " --enable-bsf=aac_adtstoasc,extract_extradata,mp3_header_decompress"
    " --enable-protocol=file,pipe,http,https,httpproxy,tcp,tls,crypto,data"
    " --enable-filter=abuffer,abuffersink,aformat,anull,aresample,atrim,asetpts"
    " --disable-ffplay --disable-ffprobe --enable-ffmpeg")
