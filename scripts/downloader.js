// Function to start previewing a beatmap
function startpreview(box) {
    // Set initial volume
    let volume = 1;

    // Check for window.gamesettings and adjust volume accordingly
    if (window.gamesettings) {
        volume = (window.gamesettings.mastervolume / 100) * (window.gamesettings.musicvolume / 100);
        volume = Math.min(1, Math.max(0, volume));
    }

    function clearAudioTimers(audio) {
        if (!audio) return;
        if (audio._fadeIn) { clearInterval(audio._fadeIn); audio._fadeIn = null; }
        if (audio._fadeOut) { clearInterval(audio._fadeOut); audio._fadeOut = null; }
        if (audio._softstop) { clearInterval(audio._softstop); audio._softstop = null; }
    }
    function removeAudio(audio) {
        clearAudioTimers(audio);
        try { audio.pause(); } catch (e) {}
        try { audio.remove(); } catch (e) {
            if (audio.parentNode) audio.parentNode.removeChild(audio);
        }
    }

    // Stop any currently playing audio (crossfade old previews out).
    // Collect first: getElementsByTagName is live, mutating while
    // iterating would skip elements and stack overlapping previews.
    var olds = Array.prototype.slice.call(document.getElementsByTagName("audio"));
    for (let i = 0; i < olds.length; ++i) {
        let old = olds[i];
        if (old.softstop) {
            try { old.softstop(); } catch (e) {}
        } else {
            removeAudio(old);
        }
    }

    // Create audio element and source for the preview
    const audio = document.createElement("audio");
    const source = document.createElement("source");
    source.src = getPreviewUrl(box.sid);
    source.type = "audio/mpeg";
    audio.appendChild(source);
    audio.preload = "auto";

    // Set initial volume to 0 and start playing
    audio.volume = 0;
    try {
        var playPromise = audio.play();
        if (playPromise && playPromise.catch) playPromise.catch(function (e) {
            // autoplay policy / network error: drop silently, don't stack
            removeAudio(audio);
        });
    } catch (e) {
        removeAudio(audio);
        return audio;
    }
    document.body.appendChild(audio);

    // Function to gradually increase volume
    const fadeIn = setInterval(() => {
        if (!audio.isConnected) { clearInterval(fadeIn); audio._fadeIn = null; return; }
        if (audio.volume < volume) {
            audio.volume = Math.min(volume, audio.volume + 0.05 * volume);
        } else {
            clearInterval(fadeIn);
            audio._fadeIn = null;
        }
    }, 30);
    audio._fadeIn = fadeIn;

    // Function to gradually decrease volume and remove audio
    const fadeOut = setInterval(() => {
        if (!audio.isConnected) { clearInterval(fadeOut); audio._fadeOut = null; return; }
        try {
            if (audio.currentTime > 9.3) { // Assuming preview is 10 seconds long
                audio.volume = Math.max(0, audio.volume - 0.05 * volume);
            }
            if (audio.volume === 0 && audio.currentTime > 9.3) {
                clearInterval(fadeOut);
                audio._fadeOut = null;
                removeAudio(audio);
            }
        } catch (e) { /* ignore */ }
    }, 30);
    audio._fadeOut = fadeOut;

    // Soft stop function for the audio element
    audio.softstop = function () {
        if (audio._softstop) return;
        clearAudioTimers(audio);
        const fadeOutInterval = setInterval(() => {
            try {
                audio.volume = Math.max(0, audio.volume - 0.1 * Math.max(volume, 0.01));
                if (audio.volume === 0) {
                    clearInterval(fadeOutInterval);
                    audio._softstop = null;
                    removeAudio(audio);
                }
            } catch (e) {
                clearInterval(fadeOutInterval);
                audio._softstop = null;
                removeAudio(audio);
            }
        }, 10);
        audio._softstop = fadeOutInterval;
        // hard fallback: never leave a preview playing
        setTimeout(function () {
            if (audio.isConnected) removeAudio(audio);
        }, 2000);
    };
    return audio
}
function startdownload(box, onDone) {
    // Lazy full .osz fetch. Preview audio is separate (startpreview).
    // If already have blob, fire callback immediately.
    if (box.oszblob) {
        if (typeof onDone === "function") {
            try { onDone(box.oszblob); } catch (e) { console.error(e); }
        }
        return;
    }
    // If already downloading, queue callback and return (no duplicate fetch).
    if (box.downloading) {
        if (typeof onDone === "function") {
            if (!box._pendingDownloads) box._pendingDownloads = [];
            box._pendingDownloads.push(onDone);
        }
        return;
    }

    const url = getDownloadUrl(box.sid);
    box.downloading = true;
    box.classList.add("downloading");

    const container = document.createElement("div");
    container.className = "download-progress";
    const title = document.createElement("div");
    title.className = "title";
    title.innerText = box.setdata.title;
    const bar = document.createElement("progress");
    bar.max = 1;
    bar.value = 0;

    container.appendChild(title);
    container.appendChild(bar);

    const statuslines = document.getElementById("statuslines");
    if (statuslines) {
        statuslines.insertBefore(container, statuslines.children[3]);
    } else {
        console.error("statuslines element not found");
    }

    box.download_starttime = new Date().getTime();

    fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const contentLength = response.headers.get('content-length');
            if (!contentLength) {
                throw new Error("Content-Length header is missing");
            }

            const total = parseInt(contentLength, 10);
            let loaded = 0;
            bar.max = total;

            const reader = response.body.getReader();
            const chunks = [];

            function read() {
                return reader.read().then(({ done, value }) => {
                    if (done) {
                        return;
                    }

                    loaded += value.length;
                    bar.value = loaded;

                    chunks.push(value);
                    return read();
                });
            }

            return read().then(() => {
                return new Blob(chunks);
            });
        })
        .then(blob => {
            box.oszblob = blob;
            box.downloading = false;
            bar.className = "finished";
            box.classList.remove("downloading");
            var cbs = box._pendingDownloads || [];
            box._pendingDownloads = null;
            if (typeof onDone === "function") {
                try { onDone(blob); } catch (e) { console.error(e); }
            }
            for (var i = 0; i < cbs.length; ++i) {
                try { cbs[i](blob); } catch (e) { console.error(e); }
            }
        })
        .catch(error => {
            console.error("Download failed:", error.message);
            box.downloading = false;
            box._pendingDownloads = null;
            box.classList.remove("downloading");
            try {
                title.innerText = "Download failed — retry later";
                bar.className = "failed";
                if (typeof showErrorToast === "function")
                    showErrorToast("Beatmap download failed. Please retry later.");
            } catch (e) { /* ignore */ }
        });
}
