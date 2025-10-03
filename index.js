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
  relativePath
) {
  const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';
  return `${baseUrl}/${relativePath}`;
}

function generateSubtitleRelativePath(
  targetLanguage,
  imdbid,
  type,
  season,
  episode,
  provider
) {
  if (type === 'movie') {
    return `subtitles/${provider}/${targetLanguage}/${imdbid}/${imdbid}-translated-1.srt`;
  }
  return `subtitles/${provider}/${targetLanguage}/${imdbid}/season${season}/${imdbid}-translated-${episode}-1.srt`;
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
      type: "select",
      required: false,
      options: [
        "gpt-4o-mini",
        "gpt-4o",
        "gpt-4-turbo",
        "gpt-3.5-turbo",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
        "deepseek-chat",
        "deepseek-coder"
      ],
      default: "gpt-4o-mini"
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

  const { type, imdbid, season, episode } = parseId(id);

  if (type === 'unknown') {
    console.log("Invalid ID format:", id);
    return Promise.resolve({ subtitles: [] });
  }

  try {
    const subtitleRelativePath = generateSubtitleRelativePath(
        targetLanguage,
        imdbid,
        type,
        season,
        episode,
        config.provider
      );

    const subtitleUrl = generateSubtitleUrl(subtitleRelativePath);
    const subtitlePath = path.join(__dirname, subtitleRelativePath);

    if (fs.existsSync(subtitlePath)) {
        console.log("Subtitle file exists locally:", subtitleRelativePath);
        const fileContent = fs.readFileSync(subtitlePath, 'utf-8');
        const isPlaceholder = fileContent.includes("Translating subtitles") ||
                             fileContent.includes("No subtitles found") ||
                             fileContent.includes("Translation failed");

        if (isPlaceholder) {
            const isInQueue = await connection.checkForTranslation(
                imdbid,
                season,
                episode,
                targetLanguage
            );

            if (isInQueue) {
                return Promise.resolve({
                    subtitles: [
                        {
                            id: `${imdbid}-${targetLanguage}-translating`,
                            url: subtitleUrl,
                            lang: `${languageDisplayName} (Translating...)`,
                        },
                    ],
                });
            }
            console.log("Placeholder found but job not in queue. Re-initiating translation.");
        } else {
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
    const mappedFoundSubtitleLang = isoCodeMapping[foundSubtitle.lang] || foundSubtitle.lang;

    // Optimization: If the subtitle is already in the target language, just download and serve it.
    if (mappedFoundSubtitleLang === targetLanguage) {
        console.log("Desired language subtitle found on OpenSubtitles, using it directly.");

        const downloadedFilePaths = await opensubtitles.downloadSubtitles([foundSubtitle], imdbid, season, episode, targetLanguage);
        const tempPath = downloadedFilePaths[0];

        const destDir = path.dirname(subtitlePath);
        await fs.promises.mkdir(destDir, { recursive: true });

        await fs.promises.rename(tempPath, subtitlePath);
        console.log(`Moved subtitle from ${tempPath} to ${subtitlePath}`);

        await connection.addsubtitle(imdbid, type, season, episode, subtitleRelativePath, targetLanguage);

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

    translationQueue.push({
      subs: [foundSubtitle],
      imdbid: imdbid,
      season: season,
      episode: episode,
      oldisocode: targetLanguage,
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
    if (parts.length === 3 && parts[0].startsWith('tt')) {
        return { type: 'series', imdbid: parts[0], season: Number(parts[1]), episode: Number(parts[2]) };
    }
    if (parts.length === 1 && parts[0].startsWith('tt')) {
        return { type: 'movie', imdbid: parts[0], season: null, episode: null };
    }
    return { type: 'unknown', imdbid: null, season: null, episode: null };
}

const port = process.env.PORT || 3000;
const address = process.env.ADDRESS || "0.0.0.0";

serveHTTP(builder.getInterface(), {
  port: port,
  address: address,
  static: "/subtitles",
})
  .then(({ url }) => {
    const displayAddress = address === '0.0.0.0' ? 'localhost' : address;
    const serverUrl = `http://${displayAddress}:${port}`;
    console.log(`Server started: ${serverUrl}`);
    console.log(`Manifest available: ${serverUrl}/manifest.json`);
    if (process.env.PUBLISH_IN_STREMIO_STORE == "TRUE") {
        publishToCentral(`${serverUrl}/manifest.json`);
    }
  })
  .catch((error) => {
    console.error("Server startup error:", error);
  });