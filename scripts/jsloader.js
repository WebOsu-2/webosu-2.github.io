function loadScript(i,e,a){let s=document.createElement("script");if(document.head.appendChild(s),e&&(s.onload=e),a)for(let i in a)s.setAttribute(i,a[i]);s.src=i}window.beatmaplistLoadedCallback=function(){window.setTimeout((function(){function i(){window.aaaaa||(window.aaaaa=0),window.aaaaa+=1,4==window.aaaaa&&(loadScript("scripts/lib/require.js",(function(){require.config({paths:{underscore:"lib/underscore",sound:"lib/sound"},shim:{underscore:{exports:"_"}}})}),{"data-main":"scripts/initgame"}),window.localforage&&localforage.getItem("likedsidset",(function(i,e){if(i)console.error("failed loading liked list");else{e&&e.size?window.liked_sid_set=e:window.liked_sid_set=new Set;for(let i=0;i<window.liked_sid_set_callbacks.length;++i)window.liked_sid_set_callbacks[i]();window.liked_sid_set_callbacks=[]}})))}loadScript("scripts/lib/zip.js",(function(){window.zip.workerScriptsPath="scripts/lib/",loadScript("scripts/lib/zip-fs.js",i)})),loadScript("scripts/lib/pixi.min.js",i),loadScript("scripts/lib/mp3parse.min.js",i),loadScript("scripts/lib/localforage.min.js",i)}),0)};