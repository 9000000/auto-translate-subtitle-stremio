const googleLanguages = require("./langs/translateGoogleFree.lang.json");
const googleApiLanguages = require("./langs/translateGoogleApi.lang.json");
const geminiLanguages = require("./langs/translateGemini.lang.json");
const chatgptLanguages = require("./langs/translateChatGpt.lang.json");
const deepseekLanguages = require("./langs/translateDeepSeek.lang.json");
const opensubtitlesLanguages = require("./langs/opensubtitles.lang.json");

function getValueFromKey(key) {
  return opensubtitlesLanguages[key];
}

function getKeyFromValue(value, provider) {
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
      throw new Error("Provider not found");
  }

  for (let key in langMap) {
    if (langMap[key] === value) {
      return key;
    }
  }
  return null;
}

function getAllValues() {
  return Object.values(opensubtitlesLanguages);
}

module.exports = {
  getAllValues,
  getKeyFromValue,
  getValueFromKey,
};
