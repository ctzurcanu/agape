
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

function sanitizeFilename(name) {
    return name.replace(/[^a-z0-9-]/gi, '_').toLowerCase();
}

async function scrapeYouTubeChannel() {
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

            const playlistDirName = sanitizeFilename(playlist.title);
            const playlistDirPath = path.join(DOCS_BASE_PATH, playlistDirName);

            console.log(`Processing playlist: ${playlist.title} (${playlist.id})`);

            if (!fs.existsSync(playlistDirPath)) {
                fs.mkdirSync(playlistDirPath, { recursive: true });
            }

            // Get videos from each playlist
            const videosJson = await runCommand(`yt-dlp --flat-playlist --dump-json --print-json "${playlist.url}"`);
            const videos = videosJson.split('\n').filter(Boolean).map(JSON.parse);

            for (const video of videos) {
                if (!video.id || !video.title) {
                    console.warn('Skipping invalid video entry in playlist:', video);
                    continue;
                }

                const videoFileName = sanitizeFilename(video.title) + '.md';
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

                const videoDescription = fullVideoInfo.description || 'No description available.';
                const videoEmbedUrl = `https://www.youtube.com/embed/${video.id}`;

                const markdownContent = `---
id: ${video.id}
title: ${fullVideoInfo.title || video.title}
sidebar_label: ${fullVideoInfo.title || video.title}
---

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

## Description

${videoDescription}
`;

                fs.writeFileSync(videoFilePath, markdownContent);
                console.log(`    Generated: ${videoFilePath}`);
            }
        }
        console.log('Scraping complete!');
    } catch (error) {
        console.error('An error occurred during scraping:', error);
    }
}

scrapeYouTubeChannel();
