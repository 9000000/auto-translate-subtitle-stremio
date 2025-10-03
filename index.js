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
const bodyParser = require('body-parser');

require("dotenv").config();

function generateSubtitleUrl(
  targetLanguage,
  imdbid,
  season,
  episode,
  provider,
  baseUrl = process.env.BASE_URL
) {
  return `${baseUrl}/subtitles/${provider}/${targetLanguage}/${imdbid}/season${season}/${imdbid}-translated-${episode}-1.srt`;
}

function getConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'config.json'));
    return JSON.parse(raw);
  } catch (e) {
    return {
      provider: 'Google Translate',
      apikey: '',
      base_url: '',
      model_name: '',
      translateto: [],
      ai_translation: true,
      save_cache: true,
      char_limit: 2000,
      quality: 'fast',
      translate_mode: 'full'
    };
  }
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
  logo: "./subtitles/logo.webp",
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
      dependencies: [
        {
          key: "provider",
          value: ["Google API", "Gemini API", "ChatGPT API", "DeepSeek API"],
        },
      ],
    },
    {
      key: "base_url",
      title: "API Base URL",
      type: "text",
      required: false,
      default: "https://api.openai.com/v1/responses",
      dependencies: [
        {
          key: "provider",
          value: ["ChatGPT API"],
        },
      ],
    },
    {
      key: "model_name",
      title: "Model Name",
      type: "text",
      required: false,
      default: "gpt-4o-mini",
      dependencies: [
        {
          key: "provider",
          value: ["Gemini API", "ChatGPT API", "DeepSeek API"],
        },
      ],
    },
    {
      key: "translateto",
      title: "Translate to",
      type: "select",
      required: true,
      default: "English",
      options: baseLanguages,
    },
  ],
  description:
    "This addon takes subtitles from OpenSubtitlesV3 then translates into desired language using Google Translate (Free), Google Cloud Translation API, Gemini AI, ChatGPT (OpenAI Compatible), or DeepSeek API. Bug report: geanpn@gmail.com",
  types: ["series", "movie"],
  catalogs: [],
  resources: ["subtitles"],
});

builder.defineSubtitlesHandler(async function (args) {
  console.log("Subtitle request received:", args);
  const { id, config, stream } = args;

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
  if (id.startsWith("dcool-")) {
    imdbid = "tt5994346";
  } else if (id !== null && id.startsWith("tt")) {
    const parts = id.split(":");
    if (parts.length >= 1) {
      imdbid = parts[0];
    } else {
      console.log("Invalid ID format.");
    }
  }

  if (imdbid === null) {
    console.log("Invalid ID format.");
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

    if (existingSubtitle.length > 0) {
      const subtitleUrl = generateSubtitleUrl(
        targetLanguage,
        imdbid,
        season,
        episode,
        config.provider
      );

      const fs = require('fs').promises;
      const subtitlePath = subtitleUrl.replace(`${process.env.BASE_URL}/`, '');

      try {
        await fs.access(subtitlePath);
        console.log("Subtitle found in database and file exists:", subtitleUrl);

        const fileContent = await fs.readFile(subtitlePath, 'utf-8');
        const isPlaceholder = fileContent.includes("Translating subtitles") || 
                             fileContent.includes("No subtitles found") ||
                             fileContent.includes("Translation failed");
        
        if (isPlaceholder) {
          console.log("Subtitle is still a placeholder, checking translation status...");
          const isInQueue = await connection.checkForTranslation(
            imdbid,
            season,
            episode,
            targetLanguage
          );
          
          if (isInQueue !== false) {
            return Promise.resolve({
              subtitles: [
                {
                  id: `${imdbid}-${targetLanguage}-subtitle`,
                  url: subtitleUrl,
                  lang: targetLanguage,
                  label: `${languageDisplayName} (Translating...)`,
                },
              ],
            });
          }
        }
        
        return Promise.resolve({
          subtitles: [
            {
              id: `${imdbid}-${targetLanguage}-subtitle`,
              url: subtitleUrl,
              lang: targetLanguage,
              label: `${languageDisplayName} (Translated)`,
            },
          ],
        });
      } catch (fileError) {
        console.log("Subtitle in DB but file not found, will re-fetch:", fileError.message);
      }
    }

    const subs = await opensubtitles.getsubtitles(
      type,
      imdbid,
      season,
      episode,
      targetLanguage
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
            id: `${imdbid}-${targetLanguage}-subtitle`,
            url: generateSubtitleUrl(
              targetLanguage,
              imdbid,
              season,
              episode,
              config.provider
            ),
            lang: targetLanguage,
            label: `${languageDisplayName} (No subtitles found)`,
          },
        ],
      });
    }

    const foundSubtitle = subs[0];
    const mappedFoundSubtitleLang = isoCodeMapping[foundSubtitle.lang] || foundSubtitle.lang;

    if (mappedFoundSubtitleLang === targetLanguage) {
      console.log(
        "Desired language subtitle found on OpenSubtitles, returning it directly."
      );
      await connection.addsubtitle(
        imdbid,
        type,
        season,
        episode,
        foundSubtitle.url.replace(`${process.env.BASE_URL}/`, ""),
        targetLanguage
      );
      return Promise.resolve({
        subtitles: [
          {
            id: `${imdbid}-${targetLanguage}-subtitle`,
            url: generateSubtitleUrl(
              targetLanguage,
              imdbid,
              season,
              episode,
              config.provider
            ),
            lang: targetLanguage,
            label: `${languageDisplayName} (Translated)`,
          },
        ],
      });
    }

    console.log(
      "Subtitles found on OpenSubtitles, but not in target language. Translating..."
    );

    const isInQueue = await connection.checkForTranslation(
      imdbid,
      season,
      episode,
      targetLanguage
    );
    
    if (isInQueue !== false) {
      console.log("Translation already in progress");
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
            id: `${imdbid}-${targetLanguage}-subtitle`,
            url: generateSubtitleUrl(
              targetLanguage,
              imdbid,
              season,
              episode,
              config.provider
            ),
            lang: targetLanguage,
            label: `${languageDisplayName} (Translating...)`,
          },
        ],
      });
    }

    await createOrUpdateMessageSub(
      "Translating subtitles. Please wait 1 minute and try again.",
      imdbid,
      season,
      episode,
      targetLanguage,
      config.provider
    );

    // Default model names for different providers
    let defaultModelName = "gpt-4o-mini";
    if (config.provider === "DeepSeek API") {
      defaultModelName = "deepseek-chat";
    } else if (config.provider === "Gemini API") {
      defaultModelName = "gemini-1.5-flash";
    }

    translationQueue.push({
      subs: [foundSubtitle],
      imdbid: imdbid,
      season: season,
      episode: episode,
      oldisocode: targetLanguage,
      provider: config.provider,
      apikey: config.apikey ?? null,
      base_url: config.base_url ?? (config.provider === "DeepSeek API" ? "https://api.deepseek.com" : "https://api.openai.com/v1/responses"),
      model_name: config.model_name ?? defaultModelName,
    });

    console.log(
      "Subtitles queued for translation",
      generateSubtitleUrl(
        targetLanguage,
        imdbid,
        season,
        episode,
        config.provider
      )
    );

    await connection.addsubtitle(
      imdbid,
      type,
      season,
      episode,
      generateSubtitleUrl(
        targetLanguage,
        imdbid,
        season,
        episode,
        config.provider
      ).replace(`${process.env.BASE_URL}/`, ""),
      targetLanguage
    );

    return Promise.resolve({
      subtitles: [
        {
          id: `${imdbid}-${targetLanguage}-subtitle`,
          url: generateSubtitleUrl(
            targetLanguage,
            imdbid,
            season,
            episode,
            config.provider
          ),
          lang: targetLanguage,
          label: `${languageDisplayName} (Translating...)`,
        },
      ],
    });
  } catch (error) {
    console.error("Error processing subtitles:", error);
    return Promise.resolve({ subtitles: [] });
  }
});

function parseId(id) {
  if (id.startsWith("tt")) {
    const match = id.match(/tt(\d+):(\d+):(\d+)/);
    if (match) {
      const [, , season, episode] = match;
      return {
        type: "series",
        season: Number(season),
        episode: Number(episode),
      };
    } else {
      return { type: "movie", season: 1, episode: 1 };
    }
  } else if (id.startsWith("dcool-")) {
    const match = id.match(/dcool-(.+)::(.+)-episode-(\d+)/);
    if (match) {
      const [, , title, episode] = match;
      return {
        type: "series",
        title: title,
        episode: Number(episode),
        season: 1,
      };
    }
  }
  return { type: "unknown", season: 0, episode: 0 };
}

if (process.env.PUBLISH_IN_STREMIO_STORE == "TRUE") {
  publishToCentral(`http://${process.env.ADDRESS}/manifest.json`);
}

const port = process.env.PORT || 3000;
const address = process.env.ADDRESS || "0.0.0.0";

const express = require("express");
const path = require("path");
const fs = require("fs");

// Đảm bảo các thư mục cần thiết tồn tại
const requiredDirs = ['subtitles', 'debug', 'data'];
requiredDirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`✓ Created directory: ${dir}`);
  }
});

app.use(bodyParser.urlencoded({ extended: true }));

// Serve configuration page
app.get('/configure', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Stremio Subtitle Translator - Configuration</title>
        <style>
          body { font-family: Arial; padding: 2em; }
          label { font-weight: bold; }
          input, select { margin-bottom: 1em; width: 300px; padding: 5px; }
          .field { margin-bottom: 12px; }
        </style>
      </head>
      <body>
        <h2>Addon Configuration</h2>
        <form method="POST" action="/save-config">
          <div class="field">
            <label>Provider:</label>
            <select name="provider">
              <option>Google Translate</option>
              <option>Google API</option>
              <option>Gemini API</option>
              <option>ChatGPT API</option>
              <option>DeepSeek API</option>
            </select>
          </div>
          <div class="field">
            <label>API Key:</label>
            <input type="text" name="apikey" placeholder="Optional (required for some providers)" />
          </div>
          <div class="field">
            <label>API Base URL:</label>
            <input type="text" name="base_url" placeholder="https://api.openai.com/v1/responses"/>
          </div>
          <div class="field">
            <label>Model Name:</label>
            <input type="text" name="model_name" placeholder="gpt-4o-mini, deepseek-chat, gemini-1.5-flash"/>
          </div>
          <div class="field">
            <label>Target Languages:</label>
            <select name="translateto[]" multiple>
              <option>English</option>
              <option>Vietnamese</option>
              <option>Chinese</option>
              <option>French</option>
              <option>German</option>
            </select>
          </div>
          <div class="field">
            <label><input type="checkbox" name="ai_translation" checked /> Sử dụng AI để dịch phụ đề</label>
          </div>
          <div class="field">
            <label><input type="checkbox" name="save_cache" checked /> Lưu cache bản dịch để tối ưu hiệu suất</label>
          </div>
          <div class="field">
            <label>Character Limit per session:</label>
            <input type="number" name="char_limit" value="2000" min="100" />
          </div>
          <div class="field">
            <label>Quality:</label>
            <select name="quality">
              <option value="fast">Nhanh</option>
              <option value="accurate">Chính xác</option>
            </select>
          </div>
          <div class="field">
            <label>Translation Mode:</label>
            <select name="translate_mode">
              <option value="full">Dịch toàn bộ file</option>
              <option value="keyword">Chỉ dịch dòng chứa keyword</option>
            </select>
          </div>
          <div class="field">
            <button type="submit">Lưu cấu hình</button>
          </div>
        </form>
        <hr />
        <a href="/history">Xem lịch sử bản dịch</a>
        <a href="/statistics">Thống kê sử dụng</a>
      </body>
    </html>
  `);
});

app.post('/save-config', (req, res) => {
  const configData = {
    provider      : req.body.provider || '',
    apikey        : req.body.apikey || '',
    base_url      : req.body.base_url || '',
    model_name    : req.body.model_name || '',
    translateto   : req.body['translateto[]'] 
                      ? (Array.isArray(req.body['translateto[]']) ? req.body['translateto[]'] : [req.body['translateto[]']]) 
                      : [],
    ai_translation: req.body.ai_translation ? true : false,
    save_cache    : req.body.save_cache ? true : false,
    char_limit    : req.body.char_limit ? parseInt(req.body.char_limit) : 2000,
    quality       : req.body.quality || 'fast',
    translate_mode: req.body.translate_mode || 'full'
  };

  fs.writeFile(path.join(__dirname, 'config.json'), JSON.stringify(configData, null, 2), err => {
    if (err) {
      return res.send('Có lỗi khi lưu cấu hình: ' + err.message);
    }
    res.send('<html><body><h3>Đã lưu cấu hình thành công!</h3><a href="/configure">Quay lại cấu hình</a></body></html>');
  });
});


serveHTTP(builder.getInterface(), {
  cacheMaxAge: 10,
  port: port,
  address: address,
  static: "/subtitles",
})
  .then(() => {
    console.log(`Server started: http://${address}:${port}`);
    console.log(`Configuration page: http://${address}:${port}/configure`);
    console.log(`Manifest available: http://${address}:${port}/manifest.json`);
  })
  .catch((error) => {
    console.error("Server startup error:", error);
  });
