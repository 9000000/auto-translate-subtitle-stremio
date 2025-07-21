const axios = require("axios");
const connection = require("./connection");
const fs = require("fs").promises;

const opensubtitlesbaseurl = "https://opensubtitles-v3.strem.io/subtitles/";

const downloadSubtitles = async (
  subtitles,
  imdbid,
  season = null,
  episode = null,
  oldisocode
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
    try {
      console.log(url);
      const response = await axios.get(url, { responseType: "arraybuffer" });

      let filePath = null;
      if (episode) {
        filePath = `${uniqueTempFolder}/${imdbid}-subtitle_${episode}-${
          i + 1
        }.srt`;
      } else {
        filePath = `${uniqueTempFolder}/${imdbid}-subtitle-${i + 1}.srt`;
      }
      console.log(filePath);
      await fs.writeFile(filePath, response.data);
      console.log(`Subtitle downloaded and saved: ${filePath}`);
      filepaths.push(filePath);
    } catch (error) {
      console.error(`Subtitle download error: ${error.message}`);
      throw error;
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
    if (response.data.subtitles.length > 0) {
      // Prioritize newisocode (targetLanguage)
      const targetLangSubtitle = response.data.subtitles.find(
        (subtitle) => subtitle.lang === newisocode
      );

      if (targetLangSubtitle) {
        return [{ url: targetLangSubtitle.url, lang: targetLangSubtitle.lang }];
      } else {
        // If targetLanguage subtitle not found, return the first available subtitle
        const firstAvailableSubtitle = response.data.subtitles[0];
        return [{ url: firstAvailableSubtitle.url, lang: firstAvailableSubtitle.lang }];
      }
    } else {
      return null;
    }
  } catch (error) {
    console.error("Subtitle URL error:", error);
    throw error;
  }
};

module.exports = { getsubtitles, downloadSubtitles };
