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

// Create Express app for custom routes
const app = express();

// Serve configuration page
app.get('/configure', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Stremio Subtitle Translator - Configuration</title>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100">
    <div id="root"></div>
    <script>
        const { createElement: e, useState } = React;
        
        const baseLanguages = ${JSON.stringify(baseLanguages)};
        
        function ConfigurationApp() {
            const [provider, setProvider] = useState('Google Translate');
            const [apiKey, setApiKey] = useState('');
            const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1/responses');
            const [modelName, setModelName] = useState('gpt-4o-mini');
            const [targetLanguage, setTargetLanguage] = useState('English');
            const [installUrl, setInstallUrl] = useState('');
            
            const providers = [
                'Google Translate',
                'Google API',
                'Gemini API',
                'ChatGPT API',
                'DeepSeek API'
            ];
            
            const needsApiKey = ['Google API', 'Gemini API', 'ChatGPT API', 'DeepSeek API'].includes(provider);
            const needsBaseUrl = provider === 'ChatGPT API';
            const needsModelName = ['Gemini API', 'ChatGPT API', 'DeepSeek API'].includes(provider);
            
            const handleProviderChange = (e) => {
                const newProvider = e.target.value;
                setProvider(newProvider);
                
                // Set default values based on provider
                if (newProvider === 'DeepSeek API') {
                    setModelName('deepseek-chat');
                    setBaseUrl('https://api.deepseek.com');
                } else if (newProvider === 'Gemini API') {
                    setModelName('gemini-1.5-flash');
                } else if (newProvider === 'ChatGPT API') {
                    setModelName('gpt-4o-mini');
                    setBaseUrl('https://api.openai.com/v1/responses');
                }
            };
            
            const generateInstallUrl = () => {
                const config = {
                    provider: provider,
                    translateto: targetLanguage
                };
                
                if (needsApiKey && apiKey) {
                    config.apikey = apiKey;
                }
                
                if (needsBaseUrl && baseUrl) {
                    config.base_url = baseUrl;
                }
                
                if (needsModelName && modelName) {
                    config.model_name = modelName;
                }
                
                const configStr = btoa(JSON.stringify(config));
                const url = window.location.origin + '/' + configStr + '/manifest.json';
                setInstallUrl(url);
            };
            
            const copyToClipboard = () => {
                navigator.clipboard.writeText(installUrl);
                alert('URL copied to clipboard!');
            };
            
            return e('div', { className: 'container mx-auto px-4 py-8 max-w-2xl' },
                e('div', { className: 'bg-white rounded-lg shadow-lg p-6' },
                    e('h1', { className: 'text-3xl font-bold text-gray-800 mb-2' }, 
                        'Stremio Subtitle Translator'
                    ),
                    e('p', { className: 'text-gray-600 mb-6' },
                        'Configure your subtitle translation settings'
                    ),
                    
                    // Provider Selection
                    e('div', { className: 'mb-4' },
                        e('label', { className: 'block text-sm font-medium text-gray-700 mb-2' }, 
                            'Translation Provider *'
                        ),
                        e('select', {
                            className: 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500',
                            value: provider,
                            onChange: handleProviderChange
                        }, providers.map(p => e('option', { key: p, value: p }, p)))
                    ),
                    
                    // API Key (conditional)
                    needsApiKey && e('div', { className: 'mb-4' },
                        e('label', { className: 'block text-sm font-medium text-gray-700 mb-2' }, 
                            'API Key *'
                        ),
                        e('input', {
                            type: 'password',
                            className: 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500',
                            value: apiKey,
                            onChange: (e) => setApiKey(e.target.value),
                            placeholder: 'Enter your API key'
                        }),
                        e('p', { className: 'text-xs text-gray-500 mt-1' },
                            provider === 'Google API' ? 'Get your key from Google Cloud Console' :
                            provider === 'Gemini API' ? 'Get your free key from https://aistudio.google.com/apikey' :
                            provider === 'ChatGPT API' ? 'Get your key from OpenAI Platform' :
                            provider === 'DeepSeek API' ? 'Get your key from https://platform.deepseek.com' : ''
                        )
                    ),
                    
                    // Base URL (conditional)
                    needsBaseUrl && e('div', { className: 'mb-4' },
                        e('label', { className: 'block text-sm font-medium text-gray-700 mb-2' }, 
                            'API Base URL'
                        ),
                        e('input', {
                            type: 'text',
                            className: 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500',
                            value: baseUrl,
                            onChange: (e) => setBaseUrl(e.target.value),
                            placeholder: 'https://api.openai.com/v1/responses'
                        }),
                        e('p', { className: 'text-xs text-gray-500 mt-1' },
                            'For OpenAI compatible APIs (OpenRouter, Gemini via OpenAI, etc.)'
                        )
                    ),
                    
                    // Model Name (conditional)
                    needsModelName && e('div', { className: 'mb-4' },
                        e('label', { className: 'block text-sm font-medium text-gray-700 mb-2' }, 
                            'Model Name'
                        ),
                        e('input', {
                            type: 'text',
                            className: 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500',
                            value: modelName,
                            onChange: (e) => setModelName(e.target.value),
                            placeholder: provider === 'DeepSeek API' ? 'deepseek-chat' : 
                                       provider === 'Gemini API' ? 'gemini-1.5-flash' : 
                                       'gpt-4o-mini'
                        })
                    ),
                    
                    // Target Language
                    e('div', { className: 'mb-6' },
                        e('label', { className: 'block text-sm font-medium text-gray-700 mb-2' }, 
                            'Translate To *'
                        ),
                        e('select', {
                            className: 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500',
                            value: targetLanguage,
                            onChange: (e) => setTargetLanguage(e.target.value)
                        }, baseLanguages.map(lang => e('option', { key: lang, value: lang }, lang)))
                    ),
                    
                    // Generate Button
                    e('button', {
                        className: 'w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 font-medium transition-colors',
                        onClick: generateInstallUrl
                    }, 'Generate Install URL'),
                    
                    // Install URL Display
                    installUrl && e('div', { className: 'mt-6 p-4 bg-gray-50 rounded-md' },
                        e('label', { className: 'block text-sm font-medium text-gray-700 mb-2' }, 
                            'Installation URL'
                        ),
                        e('div', { className: 'flex gap-2' },
                            e('input', {
                                type: 'text',
                                className: 'flex-1 px-3 py-2 border border-gray-300 rounded-md bg-white',
                                value: installUrl,
                                readOnly: true
                            }),
                            e('button', {
                                className: 'px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500',
                                onClick: copyToClipboard
                            }, 'Copy')
                        ),
                        e('p', { className: 'text-sm text-gray-600 mt-3' },
                            'Copy this URL and paste it in Stremio > Addons > Community Addons to install.'
                        ),
                        e('a', {
                            href: installUrl,
                            className: 'inline-block mt-3 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-center',
                            target: '_blank'
                        }, 'Open in Stremio')
                    ),
                    
                    // Info Box
                    e('div', { className: 'mt-6 p-4 bg-blue-50 border-l-4 border-blue-500 rounded' },
                        e('h3', { className: 'font-semibold text-blue-900 mb-2' }, 
                            'Provider Recommendations:'
                        ),
                        e('ul', { className: 'text-sm text-blue-800 space-y-1' },
                            e('li', null, '• Google Translate: Free, no API key needed (may be slow)'),
                            e('li', null, '• Gemini API: FREE with 1500 requests/day (Recommended!)'),
                            e('li', null, '• DeepSeek API: Very affordable, high quality'),
                            e('li', null, '• ChatGPT API: Good quality, requires paid OpenAI account'),
                            e('li', null, '• Google API: Professional, $20/month with 500K chars free')
                        )
                    )
                )
            );
        }
        
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(React.createElement(ConfigurationApp));
    </script>
</body>
</html>
  `);
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
