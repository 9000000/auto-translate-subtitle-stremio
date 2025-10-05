const fs = require("fs").promises;

function generateSubtitlePath(provider, oldisocode, imdbid, season, episode) {
  // Robustly check for a series. A series must have numeric season/episode.
  // This handles cases where season/episode might be null, undefined, or the string "null".
  const isSeries =
    typeof season === "number" &&
    typeof episode === "number";

  if (isSeries) {
    // Series path
    return `subtitles/${provider}/${oldisocode}/${imdbid}/season${season}/${imdbid}-translated-${episode}-1.srt`;
  } else {
    // Movie path
    return `subtitles/${provider}/${oldisocode}/${imdbid}/${imdbid}-translated-1.srt`;
  }
}

async function createOrUpdateMessageSub(
  placeholderText,
  imdbid,
  season = null,
  episode = null,
  oldisocode,
  provider
) {
  try {
    const newSubtitleFilePath = generateSubtitlePath(
      provider,
      oldisocode,
      imdbid,
      season,
      episode
    );

    const placeholderSub = [
      "1",
      "00:00:01,000 --> 00:10:50,000",
      placeholderText,
      "",
    ].join("\n");

    const dir = newSubtitleFilePath.substring(
      0,
      newSubtitleFilePath.lastIndexOf("/")
    );
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(newSubtitleFilePath, placeholderSub);
  } catch (error) {
    console.error("Error creating or updating placeholder subtitle:", error);
    throw error;
  }
}

module.exports = { createOrUpdateMessageSub, generateSubtitlePath };
