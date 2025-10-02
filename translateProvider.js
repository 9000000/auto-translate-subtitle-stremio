const axios = require("axios");
const { Translate } = require("@google-cloud/translate").v2;
const fs = require("fs").promises;
const OpenAI = require("openai");

var count = 0;

// Direct Google Translate (unofficial API) - No library needed
async function translateGoogleFree(texts, targetLanguage) {
  const textToTranslate = texts.join(" ||| ");
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLanguage}&dt=t&q=${encodeURIComponent(textToTranslate)}`;
  
  try {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    // Parse response: [[["translated", "original", ...], ...], ...]
    let translatedText = '';
    if (response.data && response.data[0]) {
      response.data[0].forEach(element => {
        if (element && element[0]) {
          translatedText += element[0];
        }
      });
    }
    
    // Split by separator
    const resultArray = translatedText.split('|||').map(t => t.trim());
    
    // Handle mismatch
    if (texts.length !== resultArray.length && resultArray.length > 0) {
      console.log('Google Free: Text count mismatch', texts.length, resultArray.length);
      const diff = texts.length - resultArray.length;
      if (diff > 0) {
        const splitted = resultArray[0].split(' ');
        if (splitted.length === diff + 1) {
          return [...splitted, ...resultArray.slice(1)];
        }
      }
    }
    
    return resultArray;
  } catch (error) {
    console.error('Google Free API error:', error.message);
    throw error;
  }
}

async function translateTextWithRetry(
  texts,
  targetLanguage,
  provider,
  apikey,
  base_url,
  model_name,
  attempt = 1,
  maxRetries = 3
) {
  try {
    let result = null;
    let resultArray = [];

    switch (provider) {
      case "Google Translate": {
        // Use direct API instead of google-translate-api-browser
        resultArray = await translateGoogleFree(texts, targetLanguage);
        break;
      }
      case "Google API": {
        // Official Google Cloud Translation API
        const translate = new Translate({
          key: apikey,
        });

        // Parallel translation for speed
        const translationPromises = texts.map(text => 
          translate.translate(text, targetLanguage)
        );

        const translations = await Promise.all(translationPromises);
        resultArray = translations.map(([translation]) => translation);
        
        console.log(`Google API translated ${resultArray.length} subtitle texts`);
        break;
      }
      case "ChatGPT API": {
        const openai = new OpenAI({
          apiKey: apikey,
          baseURL: base_url,
        });
        const jsonInput = {
          texts: texts.map((text, index) => ({ index, text })),
        };

        const prompt = `You are a professional movie subtitle translator.\nTranslate each subtitle text in the "texts" array of the following JSON object into the specified language "${targetLanguage}".\n\nThe output must be a JSON object with the same structure as the input. The "texts" array should contain the translated texts corresponding to their original indices.\n\n**Strict Requirements:**\n- Strictly preserve line breaks and original formatting for each subtitle.\n- Do not combine or split texts during translation.\n- The number of elements in the output array must exactly match the input array.\n- Ensure the final JSON is valid and retains the complete structure.\n\nInput:\n${JSON.stringify(
          jsonInput
        )}\n`;

        const completion = await openai.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: model_name,
          response_format: { type: "json_object" },
          temperature: 0.3,
        });

        const translatedJson = JSON.parse(
          completion.choices[0].message.content
        );

        resultArray = translatedJson.texts
          .sort((a, b) => a.index - b.index)
          .map((item) => item.text);

        break;
      }
      case "DeepSeek API": {
        const openai = new OpenAI({
          apiKey: apikey,
          baseURL: "https://api.deepseek.com",
        });
        const jsonInput = {
          texts: texts.map((text, index) => ({ index, text })),
        };

        const prompt = `You are a professional movie subtitle translator.\nTranslate each subtitle text in the "texts" array of the following JSON object into the specified language "${targetLanguage}".\n\nThe output must be a JSON object with the same structure as the input. The "texts" array should contain the translated texts corresponding to their original indices.\n\n**Strict Requirements:**\n- Strictly preserve line breaks and original formatting for each subtitle.\n- Do not combine or split texts during translation.\n- The number of elements in the output array must exactly match the input array.\n- Ensure the final JSON is valid and retains the complete structure.\n\nInput:\n${JSON.stringify(
          jsonInput
        )}\n`;

        const completion = await openai.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          model: model_name || "deepseek-chat",
          response_format: { type: "json_object" },
          temperature: 0.3,
        });

        const translatedJson = JSON.parse(
          completion.choices[0].message.content
        );

        resultArray = translatedJson.texts
          .sort((a, b) => a.index - b.index)
          .map((item) => item.text);

        break;
      }
      default:
        throw new Error("Provider not found");
    }

    // Validate result count
    if (texts.length != resultArray.length) {
      console.log(
        `Attempt ${attempt}/${maxRetries} failed. Text count mismatch:`,
        texts.length,
        resultArray.length
      );
      
      // Log for debugging
      await fs.writeFile(
        `debug/errorTranslate${count}.json`,
        JSON.stringify(
          {
            attempt,
            provider,
            texts,
            translatedText: resultArray,
          },
          null,
          2
        )
      );

      if (attempt >= maxRetries) {
        throw new Error(
          `Max retries (${maxRetries}) reached. Text count mismatch.`
        );
      }

      // Retry with exponential backoff
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      return translateTextWithRetry(
        texts,
        targetLanguage,
        provider,
        apikey,
        base_url,
        model_name,
        attempt + 1,
        maxRetries
      );
    }

    count++;
    return Array.isArray(texts) ? resultArray : result.text;
  } catch (error) {
    // Non-retryable errors
    const nonRetryableErrors = [
      'Insufficient Balance',
      'invalid_api_key',
      'authentication',
      'unauthorized',
      'quota_exceeded',
      'API key not valid',
      'INVALID_ARGUMENT'
    ];
    
    const errorMessage = error.message?.toLowerCase() || '';
    const shouldNotRetry = nonRetryableErrors.some(err => 
      errorMessage.includes(err.toLowerCase())
    );
    
    if (shouldNotRetry) {
      console.error(`Non-retryable error for ${provider}:`, error.message);
      throw new Error(`${provider} Error: ${error.message}. Please check your API key and account balance.`);
    }
    
    if (attempt >= maxRetries) {
      throw error;
    }

    console.error(`Attempt ${attempt}/${maxRetries} failed with error:`, error.message);
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    return translateTextWithRetry(
      texts,
      targetLanguage,
      provider,
      apikey,
      base_url,
      model_name,
      attempt + 1,
      maxRetries
    );
  }
}

async function translateText(
  texts,
  targetLanguage,
  provider,
  apikey,
  base_url,
  model_name
) {
  return translateTextWithRetry(
    texts,
    targetLanguage,
    provider,
    apikey,
    base_url,
    model_name
  );
}

module.exports = { translateText };
