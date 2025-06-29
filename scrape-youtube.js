const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHANNEL_URL = 'https://www.youtube.com/channel/UC5VMvbqSMoqGs0nFeESrf5g';
const DOCS_BASE_PATH = path.join(__dirname, 'docs');

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
        .replace(/-+/g, '-'); // Replace multiple hyphens with a single hyphen
}

async function scrapeYouTubeChannel(maxVideos = Infinity) {
    let videoCount = 0;
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

            // Get videos from each playlist
            const videosJson = await runCommand(`yt-dlp --flat-playlist --dump-json --print-json "${playlist.url}"`);
            const videos = videosJson.split('\n').filter(Boolean).map(JSON.parse);

            let videoListMarkdown = '## Videos in this Playlist\n\n';
            const processedVideos = [];

            for (const video of videos) {
                if (videoCount >= maxVideos) {
                    console.log(`Reached video limit of ${maxVideos}. Stopping.`);
                    break; // Exit video loop
                }

                const videoFileName = video.id + '.md';
                const videoFilePath = path.join(playlistDirPath, videoFileName);

                console.log(`  Processing video: ${video.title} (${video.id})`);

                // Fetch full video info for description
                let fullVideoInfo;
                try {
                    const videoInfoJson = await runCommand(`yt-dlp --dump-json --print-json "https://www.youtube.com/watch?v=${video.id}"`);
                    fullVideoInfo = JSON.parse(videoInfoJson.split('\n').filter(Boolean)[0]);
                } catch (infoError) {
                    console.error(`    Could not fetch full info for video ${video.id}: ${infoError.message}. Using basic info.`);
                    fullVideoInfo = video; // Fallback to basic info if full fetch fails
                }

                const videoDescription = (fullVideoInfo.description || 'No description available.')
                    .replace(/\n\n/g, '[DOUBLE_NEWLINE_PLACEHOLDER]') // Temporarily replace double newlines
                    .replace(/\n/g, '  \n') // Replace single newlines with markdown line breaks
                    .replace(/\[DOUBLE_NEWLINE_PLACEHOLDER\]/g, '\n\n'); // Restore double newlines
                const videoEmbedUrl = `https://www.youtube.com/embed/${video.id}`;

                const markdownContent = `---
id: ${video.id}
title: "${fullVideoInfo.title || video.title}"
sidebar_label: "${fullVideoInfo.title || video.title}"
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

## ${fullVideoInfo.title || video.title}

${videoDescription}
`;

                fs.writeFileSync(videoFilePath, markdownContent);
                console.log(`    Generated: ${videoFilePath}`);
                processedVideos.push({ title: fullVideoInfo.title || video.title, playlistSlug: playlistDirName, videoId: video.id });
                videoCount++;
            }

            processedVideos.forEach(v => {
                videoListMarkdown += `- [${v.title}](/${v.playlistSlug}/${v.videoId})
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
            if (videoCount >= maxVideos) {
                break; // Exit playlist loop if overall video limit is reached
            }
        }
        console.log('Scraping complete!');
    } catch (error) {
        console.error('An error occurred during scraping:', error);
    }
}

const n = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;
scrapeYouTubeChannel(n);