const {
  addonBuilder,
  serveHTTP,
  publishToCentral,
} = require("stremio-addon-sdk");
const opensubtitles = require("./opensubtitles");
const connection = require("./connection");
const languages = require("./languages");
const { createOrUpdateMessageSub } = require("./subtitles");
const translationQueue = require("./queues/translationQueue");
const baseLanguages = require("./langs/base.lang.json");
const isoCodeMapping = require("./langs/iso_code_mapping.json");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

// Đảm bảo các thư mục cần thiết tồn tại
const requiredDirs = ['subtitles', 'debug', 'data'];
requiredDirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`✓ Created directory: ${dir}`);
  }
});

function generateSubtitleUrl(
  targetLanguage,
  imdbid,
  season,
  episode,
  provider,
  baseUrl = process.env.BASE_URL
) {
  // This function needs to be adjusted to work without a custom express server.
  // The SDK serves files from a static path. We will construct a relative path.
  const relativePath = `subtitles/${provider}/${targetLanguage}/${imdbid}/season${season}/${imdbid}-translated-${episode}-1.srt`;
  // The full URL will be constructed by Stremio based on the addon's URL + the relative path.
  return relativePath;
}

function getLanguageDisplayName(isoCode, provider) {
  const googleLanguages = require("./langs/translateGoogleFree.lang.json");
  const googleApiLanguages = require("./langs/translateGoogleApi.lang.json");
  const geminiLanguages = require("./langs/translateGemini.lang.json");
  const chatgptLanguages = require("./langs/translateChatGpt.lang.json");
  const deepseekLanguages = require("./langs/translateDeepSeek.lang.json");

  let langMap;
  switch (provider) {
    case "Google Translate":
      langMap = googleLanguages;
      break;
    case "Google API":
      langMap = googleApiLanguages;
      break;
    case "Gemini API":
      langMap = geminiLanguages;
      break;
    case "ChatGPT API":
      langMap = chatgptLanguages;
      break;
    case "DeepSeek API":
      langMap = deepseekLanguages;
      break;
    default:
      return "Unknown";
  }

  return langMap[isoCode] || isoCode;
}

const builder = new addonBuilder({
  id: "org.autotranslate.geanpn",
  version: "1.0.7",
  name: "Auto Subtitle Translate by geanpn",
  logo: "/logo.webp", // Served from static path
  configurable: true,
  behaviorHints: {
    configurable: true,
    configurationRequired: true,
  },
  config: [
    {
      key: "provider",
      title: "Provider",
      type: "select",
      required: true,
      options: ["Google Translate", "Google API", "Gemini API", "ChatGPT API", "DeepSeek API"],
    },
    {
      key: "apikey",
      title: "API Key",
      type: "text",
      required: false,
    },
    {
      key: "base_url",
      title: "API Base URL (for ChatGPT/Deepseek compatible)",
      type: "text",
      required: false,
    },
    {
      key: "model_name",
      title: "Model Name",
      type: "text",
      required: false,
    },
    {
      key: "translateto",
      title: "Translate to",
      type: "select",
      required: true,
      default: "English",
      options: baseLanguages,
    },
    {
      key: "ai_translation",
      title: "Use AI for translation",
      type: "boolean",
      default: true,
    },
    {
      key: "save_cache",
      title: "Save translated subtitles to cache",
      type: "boolean",
      default: true,
    },
    {
      key: "char_limit",
      title: "Character limit per session",
      type: "number",
      default: 2000,
    },
    {
      key: "quality",
      title: "Quality",
      type: "select",
      options: ["fast", "accurate"],
      default: "fast",
    },
    {
      key: "translate_mode",
      title: "Translation Mode",
      type: "select",
      options: ["full", "keyword"],
      default: "full",
    },
  ],
  description:
    "This addon translates subtitles from OpenSubtitles using various services.",
  types: ["series", "movie"],
  catalogs: [],
  resources: ["subtitles"],
});

builder.defineSubtitlesHandler(async function (args) {
  console.log("Subtitle request received:", args);
  const { id, config } = args;

  const targetLanguage = languages.getKeyFromValue(
    config.translateto,
    config.provider
  );

  if (!targetLanguage) {
    console.log("Unsupported language:", config.translateto);
    return Promise.resolve({ subtitles: [] });
  }

  const languageDisplayName = getLanguageDisplayName(targetLanguage, config.provider);

  let imdbid = null;
  if (id.startsWith("tt")) {
    imdbid = id.split(":")[0];
  } else {
    console.log("Invalid ID format:", id);
    return Promise.resolve({ subtitles: [] });
  }

  const { type, season = null, episode = null } = parseId(id);

  try {
    const existingSubtitle = await connection.getsubtitles(
      imdbid,
      season,
      episode,
      targetLanguage
    );

    const subtitleUrl = generateSubtitleUrl(
        targetLanguage,
        imdbid,
        season,
        episode,
        config.provider
      );

    if (existingSubtitle.length > 0) {
      const subtitlePath = path.join(__dirname, subtitleUrl);

      if (fs.existsSync(subtitlePath)) {
        console.log("Subtitle found in database and file exists:", subtitleUrl);
         const fileContent = fs.readFileSync(subtitlePath, 'utf-8');
         const isPlaceholder = fileContent.includes("Translating subtitles") ||
                              fileContent.includes("No subtitles found") ||
                              fileContent.includes("Translation failed");

        if (isPlaceholder) {
            // If the file is just a placeholder, let the user know it's being translated.
            return Promise.resolve({
                subtitles: [
                    {
                        id: `${imdbid}-${targetLanguage}-translating`,
                        url: subtitleUrl,
                        lang: `${languageDisplayName} (Translating...)`,
                    },
                ],
            });
        } else {
            // If the file is not a placeholder, it's a valid, translated subtitle.
            return Promise.resolve({
              subtitles: [
                {
                  id: `${imdbid}-${targetLanguage}-subtitle`,
                  url: subtitleUrl,
                  lang: languageDisplayName,
                },
              ],
            });
        }
      }
    }

    const subs = await opensubtitles.getsubtitles(
      type,
      imdbid,
      season,
      episode
    );

    if (!subs || subs.length === 0) {
      await createOrUpdateMessageSub(
        "No subtitles found on OpenSubtitles",
        imdbid,
        season,
        episode,
        targetLanguage,
        config.provider
      );
      return Promise.resolve({
        subtitles: [
          {
            id: `${imdbid}-${targetLanguage}-no-subs`,
            url: subtitleUrl,
            lang: `${languageDisplayName} (Not Found)`,
          },
        ],
      });
    }

    const foundSubtitle = subs[0];

    // Add to translation queue
    translationQueue.push({
      subs: [foundSubtitle],
      imdbid: imdbid,
      season: season,
      episode: episode,
      oldisocode: targetLanguage, // This should be the target language
      provider: config.provider,
      apikey: config.apikey || null,
      base_url: config.base_url || null,
      model_name: config.model_name || null,
    });

    await createOrUpdateMessageSub(
      "Translating subtitles. Please wait 1 minute and try again.",
      imdbid,
      season,
      episode,
      targetLanguage,
      config.provider
    );

    return Promise.resolve({
      subtitles: [
        {
          id: `${imdbid}-${targetLanguage}-translating`,
          url: subtitleUrl,
          lang: `${languageDisplayName} (Translating...)`,
        },
      ],
    });
  } catch (error) {
    console.error("Error processing subtitles:", error);
    return Promise.resolve({ subtitles: [] });
  }
});

function parseId(id) {
    const parts = id.split(':');
    if (parts.length === 3) {
        return { type: 'series', season: Number(parts[1]), episode: Number(parts[2]) };
    }
    return { type: 'movie', season: null, episode: null };
}

const port = process.env.PORT || 3000;
const address = process.env.ADDRESS || "0.0.0.0";

serveHTTP(builder.getInterface(), {
  port: port,
  address: address,
  static: "/subtitles",
})
  .then(({ url }) => {
    console.log(`Server started at: ${url}`);
    console.log(`Manifest available at: ${url}/manifest.json`);
    if (process.env.PUBLISH_IN_STREMIO_STORE == "TRUE") {
        publishToCentral(`${url}/manifest.json`);
    }
  })
  .catch((error) => {
    console.error("Server startup error:", error);
  });