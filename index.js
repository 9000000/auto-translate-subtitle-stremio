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
const express = require("express");
const path = require("path");
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
        
        const fileContent = await fs.readFile
