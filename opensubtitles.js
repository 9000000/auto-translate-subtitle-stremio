const axios = require("axios");
const connection = require("./connection");
const fs = require("fs").promises;

const opensubtitlesbaseurl = "https://opensubtitles-v3.strem.io/subtitles/";

const isoCodeMapping = require("./langs/iso_code_mapping.json");

// Trong file opensubtitles.js
const downloadSubtitles = async (
  subtitles,
  imdbid,
  season = null,
  episode = null,
  oldisocode,
  maxRetries = 3
) => {
  let uniqueTempFolder = null;
  if (season && episode) {
    await fs.mkdir(`subtitles/${oldisocode}/${imdbid}/season${season}`, {
      recursive: true,
    });
    uniqueTempFolder = `subtitles/${oldisocode}/${imdbid}/season${season}`;
  } else {
    await fs.mkdir(`subtitles/${oldisocode}/${imdbid}`, { recursive: true });
    uniqueTempFolder = `subtitles/${oldisocode}/${imdbid}`;
  }

  let filepaths = [];

  for (let i = 0; i < subtitles.length; i++) {
    const url = subtitles[i].url;
    let retries = 0;
    let success = false;

    while (retries < maxRetries && !success) {
      try {
        console.log(`Downloading subtitle (attempt ${retries + 1}/${maxRetries}): ${url}`);
        
        const response = await axios.get(url, { 
          responseType: "arraybuffer",
          timeout: 30000, // 30 seconds timeout
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        let filePath = null;
        if (episode) {
          filePath = `${uniqueTempFolder}/${imdbid}-subtitle_${episode}-${i + 1}.srt`;
        } else {
          filePath = `${uniqueTempFolder}/${imdbid}-subtitle-${i + 1}.srt`;
        }
        
        await fs.writeFile(filePath, response.data);
        console.log(`Subtitle downloaded and saved: ${filePath}`);
        filepaths.push(filePath);
        success = true;

      } catch (error) {
        retries++;
        console.error(`Subtitle download error (attempt ${retries}/${maxRetries}):`, error.message);
        
        if (retries < maxRetries) {
          // Wait before retry (exponential backoff)
          const waitTime = Math.min(1000 * Math.pow(2, retries), 10000);
          console.log(`Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          throw new Error(`Failed to download subtitle after ${maxRetries} attempts: ${error.message}`);
        }
      }
    }
  }
  return filepaths;
};

const getsubtitles = async (
  type,
  imdbid,
  season = null,
  episode = null,
  newisocode
) => {
  let url = opensubtitlesbaseurl;

  if (type === "series") {
    url = url.concat(type, "/", imdbid, ":", season, ":", episode, ".json");
  } else {
    url = url.concat(type, "/", imdbid, ".json");
  }

  try {
    const response = await axios.get(url);
    

    if (response.data.subtitles.length === 0) {
      return null;
    }

    const subtitles = response.data.subtitles;

    // Helper to find subtitle by language
    const findSubtitle = (langCode) => {
      return subtitles.find((subtitle) => {
        const mappedLang = isoCodeMapping[subtitle.lang] || subtitle.lang;
        
        return mappedLang === langCode;
      });
    };

    // 1. Prioritize newisocode (targetLanguage)
    const targetLangSubtitle = findSubtitle(newisocode);
    
    if (targetLangSubtitle !== undefined && targetLangSubtitle !== null) {
      return [{ url: targetLangSubtitle.url, lang: targetLangSubtitle.lang }];
    }

    // 2. If targetLanguage subtitle not found, try to find an English subtitle
    const englishSubtitle = findSubtitle('en');
    if (englishSubtitle) {
      
      return [{ url: englishSubtitle.url, lang: englishSubtitle.lang }];
    }

    // 3. If no English subtitle found, return the first available subtitle of any language
    
    
    return [{ url: firstAvailableSubtitle.url, lang: firstAvailableSubtitle.lang }];

  } catch (error) {
    console.error("Subtitle URL error:", error);
    throw error;
  }
};

module.exports = { getsubtitles, downloadSubtitles };
