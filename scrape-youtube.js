const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHANNEL_URL = 'https://www.youtube.com/channel/UC5VMvbqSMoqGs0nFeESrf5g';
const DOCS_BASE_PATH = path.join(__dirname, 'docs');
const CACHE_FILE_PATH = path.join(__dirname, 'scrape-cache.json');

function loadCache() {
    if (fs.existsSync(CACHE_FILE_PATH)) {
        try {
            const cacheData = fs.readFileSync(CACHE_FILE_PATH, 'utf8');
            return new Set(JSON.parse(cacheData));
        } catch (e) {
            console.warn(`Could not read or parse cache file '${CACHE_FILE_PATH}'. Starting with an empty cache.`, e);
            return new Set();
        }
    }
    return new Set();
}

function saveCache(cache) {
    try {
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(Array.from(cache)), 'utf8');
        console.log(`Cache with ${cache.size} video IDs saved to ${CACHE_FILE_PATH}`);
    } catch (e) {
        console.error(`Failed to save cache to '${CACHE_FILE_PATH}'.`, e);
    }
}

async function runCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing command: ${command}`);
                console.error(`stderr: ${stderr}`);
                reject(error);
                return;
            }
            if (stderr) {
                console.warn(`Command stderr: ${stderr}`);
            }
            resolve(stdout);
        });
    });
}

function slugify(name) {
    return name.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove non-alphanumeric characters except spaces and hyphens
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with a single hyphen
        .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
        .replace(/^_/, ''); // Remove leading underscores
}

function escapeDoubleQuotes(text) {
    return text.replace(/"/g, '\"');
}

async function scrapeYouTubeChannel(maxVideos = Infinity) {

    const processedVideoIds = loadCache();
    console.log(`Loaded ${processedVideoIds.size} video IDs from cache.`);
    let videoCount = 0;
    let playlistPosition = 1; // Initialize playlist position counter

    console.log(`Scraping playlists from channel: ${CHANNEL_URL}`);

    // Create base directory if it doesn't exist
    if (!fs.existsSync(DOCS_BASE_PATH)) {
        fs.mkdirSync(DOCS_BASE_PATH, { recursive: true });
    }

    try {
        // Get all playlists from the channel
        const playlistsJson = await runCommand(`yt-dlp --flat-playlist --dump-json --print-json "${CHANNEL_URL}/playlists"`);
        const playlists = playlistsJson.split('\n').filter(Boolean).map(JSON.parse);

        for (const playlist of playlists) {

            if (!playlist.id || !playlist.title) {
                console.warn('Skipping invalid playlist entry:', playlist);
                continue;
            }

            const playlistDirName = slugify(playlist.title);
            const playlistDirPath = path.join(DOCS_BASE_PATH, playlistDirName);

            console.log(`Processing playlist: ${playlist.title} (${playlist.id})`);

            if (!fs.existsSync(playlistDirPath)) {
                fs.mkdirSync(playlistDirPath, { recursive: true });
            }

            // Create _category_.json for sidebar ordering
            const categoryJsonContent = JSON.stringify({
                position: playlistPosition,
                label: playlist.title,
            }, null, 2);
            fs.writeFileSync(path.join(playlistDirPath, '_category_.json'), categoryJsonContent);
            playlistPosition++;

            // Get videos from each playlist
            const videosJson = await runCommand(`yt-dlp --flat-playlist --dump-json --print-json "${playlist.url}"`);
            const videos = videosJson.split('\n').filter(Boolean).map(JSON.parse);

            let videoListMarkdown = '## Videos in this Playlist\n\n';
            const processedVideosForPlaylist = [];

            for (const video of videos) {
                if (videoCount >= maxVideos) {
                    console.log(`Reached video limit of ${maxVideos}. Stopping.`);
                    break; // Exit video loop
                }

                let videoTitle = video.title; // Use playlist video title by default

                // Fetch full video info for description (always, to get accurate title for index.md)
                let fullVideoInfo;
                try {
                    const videoInfoJson = await runCommand(`yt-dlp --dump-json --print-json "https://www.youtube.com/watch?v=${video.id}"`);
                    fullVideoInfo = JSON.parse(videoInfoJson.split('\n').filter(Boolean)[0]);
                    videoTitle = fullVideoInfo.title || video.title; // Update title with more accurate one
                } catch (infoError) {
                    console.error(`    Could not fetch full info for video ${video.id}: ${infoError.message}. Using basic info.`);
                    fullVideoInfo = video; // Fallback to basic info if full fetch fails
                }

                const fileSafeVideoId = video.id.startsWith('_') ? video.id.substring(1) : video.id;

                if (processedVideoIds.has(video.id)) {
                    console.log(`    Skipping already processed video: ${videoTitle} (${video.id})`);
                } else {
                    console.log(`  Processing new video: ${videoTitle} (${video.id})`);

                    const videoDescription = (fullVideoInfo.description || 'No description available.')
                        .replace(/\n\n/g, '[DOUBLE_NEWLINE_PLACEHOLDER]') // Temporarily replace double newlines
                        .replace(/\n/g, '  \n') // Replace single newlines with markdown line breaks
                        .replace(/\[DOUBLE_NEWLINE_PLACEHOLDER\]/g, '\n\n'); // Restore double newlines
                    const videoEmbedUrl = `https://www.youtube.com/embed/${video.id}`;
                    const videoFilePath = path.join(playlistDirPath, fileSafeVideoId + '.md');

                    const markdownContent = `---
id: ${video.id}
title: "${escapeDoubleQuotes(videoTitle)}"
sidebar_label: "${escapeDoubleQuotes(videoTitle)}"
---

<div class="video-float-container">
  <iframe
    width="560"
    height="315"
    src="${videoEmbedUrl}"
    title="YouTube video player"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerpolicy="strict-origin-when-cross-origin"
    allowfullscreen
  ></iframe>
</div>

## ${videoTitle}

${videoDescription}
`;

                    fs.writeFileSync(videoFilePath, markdownContent);
                    console.log(`    Generated: ${videoFilePath}`);
                    processedVideoIds.add(video.id); // Add to cache after successful processing
                }

                processedVideosForPlaylist.push({ title: videoTitle, playlistSlug: playlistDirName, videoId: fileSafeVideoId });
                videoCount++;
            }

            processedVideosForPlaylist.forEach(v => {
                videoListMarkdown += `- [${v.title}](/agape/${v.playlistSlug}/${v.videoId})\n`;
            });

            const playlistIndexContent = `---
id: ${playlist.id}
title: "${playlist.title}"
sidebar_label: "${playlist.title}"
---

# ${playlist.title}

This is the landing page for the playlist "${playlist.title}".

${videoListMarkdown}
`;
            fs.writeFileSync(path.join(playlistDirPath, 'index.md'), playlistIndexContent);
            console.log(`  Updated playlist index: ${playlist.title}`);

            if (videoCount >= maxVideos) {
                break; // Exit playlist loop if overall video limit is reached
            }
        }
    } catch (error) {
        console.error('An error occurred during scraping:', error);
    } finally {
        saveCache(processedVideoIds);
    }
    console.log('Scraping complete!');
}

const n = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;
scrapeYouTubeChannel(n);